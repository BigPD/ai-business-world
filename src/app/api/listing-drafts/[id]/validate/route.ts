import { NextRequest, NextResponse } from "next/server";
import { getCategoryAspects } from "@/lib/ebay";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Checks a listing draft against everything that must be true before it's
// allowed to become an eBay draft: required fields, real package
// dimensions (never guessed postage), at least one properly-sourced
// image, every category-required item specific (fetched live from eBay's
// Taxonomy API), and no unresolved compliance blocks.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const errors: string[] = [];

  const { data: draft } = await db.from("listing_drafts").select("*").eq("saved_opportunity_id", params.id).maybeSingle();
  if (!draft) {
    return NextResponse.json({ error: "no draft saved yet" }, { status: 404 });
  }

  const { data: supplierProduct } = await db.from("supplier_products").select("*").eq("saved_opportunity_id", params.id).maybeSingle();
  const { data: complianceChecks } = await db.from("compliance_checks").select("*").eq("saved_opportunity_id", params.id);

  if (!draft.title || draft.title.length < 5) errors.push("Title is missing or too short.");
  if (draft.title && draft.title.length > 80) errors.push("Title exceeds eBay's 80-character limit.");
  if (!draft.category_id) errors.push("No eBay category set.");
  if (!draft.condition) errors.push("Condition is not set.");
  if (!draft.price || draft.price <= 0) errors.push("Price is missing or not greater than zero.");
  if (!draft.quantity || draft.quantity < 1) errors.push("Quantity is missing or less than 1.");
  if (!draft.description) errors.push("Description is missing.");
  if (!Array.isArray(draft.images) || draft.images.length === 0) errors.push("At least one product image (with a real source) is required.");
  if (!draft.free_shipping && !draft.domestic_postage_service) errors.push("Domestic postage service is not set (or enable free shipping).");

  if (!supplierProduct) {
    errors.push("No supplier/sourcing data on file — package weight and dimensions are unknown, so postage cannot be configured honestly.");
  } else {
    if (!supplierProduct.weight_kg) errors.push("Package weight is missing.");
    if (!supplierProduct.package_length_cm || !supplierProduct.package_width_cm || !supplierProduct.package_height_cm) {
      errors.push("Package dimensions (length/width/height) are incomplete.");
    }
  }

  const blockingCompliance = (complianceChecks ?? []).filter((c) => c.status === "block");
  if (blockingCompliance.length) {
    errors.push(`Blocked by compliance check(s): ${blockingCompliance.map((c) => c.check_type).join(", ")}.`);
  }

  if (draft.category_id) {
    try {
      const aspects = await getCategoryAspects(draft.category_id);
      const required = aspects.filter((a) => a.required);
      const provided = (draft.item_specifics as Record<string, string>) ?? {};
      for (const a of required) {
        if (!provided[a.name]) errors.push(`Missing required item specific for this category: "${a.name}".`);
      }
    } catch (err) {
      errors.push(`Could not verify required item specifics against eBay's taxonomy: ${String(err)}`);
    }
  }

  const status = errors.length === 0 ? "validated" : "draft";
  await db.from("listing_drafts").update({ status, validation_errors: errors, updated_at: new Date().toISOString() }).eq("saved_opportunity_id", params.id);

  return NextResponse.redirect(new URL(`/listing-studio/${params.id}`, req.url));
}
