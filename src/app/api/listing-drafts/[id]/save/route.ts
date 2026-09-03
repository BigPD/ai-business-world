import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const IMAGE_SLOTS = 5;
const IMAGE_SOURCES = new Set(["supplier_authorized", "manufacturer_authorized", "my_photo", "original_graphic"]);

// Saves (creates or updates) the Listing Studio draft for one saved
// opportunity. Any previous validation is invalidated by an edit — the
// seller must re-run Validate before Create eBay Draft is allowed again.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const form = await req.formData();

  const aspects: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (key.startsWith("aspect__") && typeof value === "string" && value.trim()) {
      aspects[key.replace("aspect__", "")] = value.trim();
    }
  }

  const images: { url: string; source: string }[] = [];
  for (let i = 1; i <= IMAGE_SLOTS; i++) {
    const url = String(form.get(`image_url_${i}`) ?? "").trim();
    const source = String(form.get(`image_source_${i}`) ?? "");
    if (url && IMAGE_SOURCES.has(source)) images.push({ url, source });
  }

  const price = Number(form.get("price"));
  const quantity = Number(form.get("quantity"));

  await db.from("listing_drafts").upsert(
    {
      saved_opportunity_id: params.id,
      title: String(form.get("title") ?? "").trim(),
      subtitle: String(form.get("subtitle") ?? "").trim() || null,
      category_id: String(form.get("category_id") ?? "").trim() || null,
      category_name: String(form.get("category_name") ?? "").trim() || null,
      condition: String(form.get("condition") ?? "") || null,
      condition_description: String(form.get("condition_description") ?? "").trim() || null,
      item_specifics: aspects,
      description: String(form.get("description") ?? "").trim() || null,
      price: Number.isFinite(price) && price > 0 ? price : null,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null,
      best_offer_enabled: form.get("best_offer_enabled") === "on",
      promoted_listings_pct: form.get("promoted_listings_pct") ? Number(form.get("promoted_listings_pct")) : null,
      dispatch_time_days: form.get("dispatch_time_days") ? Number(form.get("dispatch_time_days")) : null,
      domestic_postage_service: String(form.get("domestic_postage_service") ?? "").trim() || null,
      domestic_postage_cost: form.get("domestic_postage_cost") ? Number(form.get("domestic_postage_cost")) : null,
      free_shipping: form.get("free_shipping") === "on",
      warranty_details: String(form.get("warranty_details") ?? "").trim() || null,
      images,
      status: "draft",
      validation_errors: [],
      updated_at: new Date().toISOString(),
    },
    { onConflict: "saved_opportunity_id" }
  );

  return NextResponse.redirect(new URL(`/listing-studio/${params.id}`, req.url));
}
