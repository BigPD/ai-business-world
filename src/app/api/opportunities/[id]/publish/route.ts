import { NextRequest, NextResponse } from "next/server";
import { publishListing } from "@/lib/ebay";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CONDITIONS = new Set(["NEW", "USED_EXCELLENT", "USED_GOOD", "USED_ACCEPTABLE", "FOR_PARTS_OR_NOT_WORKING"]);

// Turns one approved draft into a real, live eBay listing. Requires the
// pieces a template can't invent — a real photo, quantity and condition —
// supplied via the form on the dashboard. Failures are recorded on the
// row (publish_error) rather than losing the draft, so it can be fixed
// and retried.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const form = await req.formData();
  const imageUrl = String(form.get("image_url") ?? "").trim();
  const quantity = Number(form.get("quantity") ?? 1);
  const condition = String(form.get("condition") ?? "NEW");

  if (!imageUrl || !imageUrl.startsWith("https://")) {
    await db.from("listing_opportunities").update({ publish_error: "A real https:// image URL is required." }).eq("id", params.id);
    return NextResponse.redirect(new URL("/", req.url));
  }
  if (!Number.isFinite(quantity) || quantity < 1) {
    await db.from("listing_opportunities").update({ publish_error: "Quantity must be at least 1." }).eq("id", params.id);
    return NextResponse.redirect(new URL("/", req.url));
  }
  if (!CONDITIONS.has(condition)) {
    await db.from("listing_opportunities").update({ publish_error: "Invalid condition." }).eq("id", params.id);
    return NextResponse.redirect(new URL("/", req.url));
  }

  const { data: draft, error: fetchError } = await db
    .from("listing_opportunities")
    .select("*")
    .eq("id", params.id)
    .single();
  if (fetchError || !draft) {
    return NextResponse.json({ error: "draft not found" }, { status: 404 });
  }
  if (draft.status !== "approved") {
    await db.from("listing_opportunities").update({ publish_error: "Only approved drafts can be published." }).eq("id", params.id);
    return NextResponse.redirect(new URL("/", req.url));
  }
  if (!draft.suggested_category_id) {
    await db
      .from("listing_opportunities")
      .update({ publish_error: "No eBay category set on this draft — fix it before publishing." })
      .eq("id", params.id);
    return NextResponse.redirect(new URL("/", req.url));
  }

  const sku = draft.sku ?? `JDMK-${params.id.slice(0, 8)}`;

  try {
    const result = await publishListing({
      sku,
      title: draft.suggested_title,
      description: draft.suggested_description ?? draft.suggested_title,
      imageUrls: [imageUrl],
      quantity,
      condition,
      categoryId: draft.suggested_category_id,
      price: Number(draft.suggested_price) || 0,
      currency: "AUD",
    });

    await db
      .from("listing_opportunities")
      .update({
        status: "published",
        sku,
        ebay_item_id: result.listingId,
        ebay_offer_id: result.offerId,
        publish_error: null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", params.id);
  } catch (err) {
    await db
      .from("listing_opportunities")
      .update({ sku, publish_error: String(err) })
      .eq("id", params.id);
  }

  return NextResponse.redirect(new URL("/", req.url));
}
