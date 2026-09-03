import { NextRequest, NextResponse } from "next/server";
import { createEbayOffer } from "@/lib/ebay";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Creates the inventory item + offer on eBay — an unpublished draft,
// visible in Seller Hub, not live. Only allowed once status='validated'.
// Publishing is a separate, explicit step (see publish/route.ts).
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const { data: draft } = await db.from("listing_drafts").select("*").eq("saved_opportunity_id", params.id).maybeSingle();
  if (!draft) return NextResponse.json({ error: "no draft" }, { status: 404 });
  if (draft.status !== "validated") {
    await db.from("listing_drafts").update({ publish_error: "Draft must pass Validate before creating an eBay draft." }).eq("id", draft.id);
    return NextResponse.redirect(new URL(`/listing-studio/${params.id}`, req.url));
  }

  const { data: supplierProduct } = await db.from("supplier_products").select("*").eq("saved_opportunity_id", params.id).maybeSingle();
  const sku = draft.sku ?? `JDMK-${params.id.slice(0, 8)}`;

  try {
    const aspects: Record<string, string[]> = {};
    for (const [k, v] of Object.entries((draft.item_specifics as Record<string, string>) ?? {})) {
      aspects[k] = [v];
    }

    const { offerId } = await createEbayOffer({
      sku,
      title: draft.title,
      subtitle: draft.subtitle ?? undefined,
      description: draft.description ?? draft.title,
      imageUrls: (draft.images as { url: string }[]).map((i) => i.url),
      quantity: draft.quantity ?? 1,
      condition: draft.condition ?? "NEW",
      conditionDescription: draft.condition_description ?? undefined,
      categoryId: draft.category_id!,
      price: Number(draft.price),
      currency: "AUD",
      aspects,
      bestOfferEnabled: draft.best_offer_enabled,
      packageWeightKg: supplierProduct?.weight_kg ?? null,
      packageDimensionsCm:
        supplierProduct?.package_length_cm && supplierProduct?.package_width_cm && supplierProduct?.package_height_cm
          ? { length: supplierProduct.package_length_cm, width: supplierProduct.package_width_cm, height: supplierProduct.package_height_cm }
          : null,
    });

    await db
      .from("listing_drafts")
      .update({ status: "ebay_draft_created", sku, ebay_offer_id: offerId, publish_error: null, updated_at: new Date().toISOString() })
      .eq("id", draft.id);
  } catch (err) {
    await db.from("listing_drafts").update({ sku, publish_error: String(err) }).eq("id", draft.id);
  }

  return NextResponse.redirect(new URL(`/listing-studio/${params.id}`, req.url));
}
