import { NextRequest, NextResponse } from "next/server";
import { publishListing } from "@/lib/ebay";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const CONDITIONS = new Set(["NEW", "USED_EXCELLENT", "USED_GOOD", "USED_ACCEPTABLE", "FOR_PARTS_OR_NOT_WORKING"]);

async function fail(db: ReturnType<typeof supabaseAdmin>, id: string, message: string, extra: Record<string, unknown> = {}) {
  await db.from("listing_opportunities").update({ publish_error: message, ...extra }).eq("id", id);
}

// Turns one approved draft into a real, live eBay listing. The generated
// title/price/description are only a starting point (a trend keyword, not
// a sourced product) — this form requires the seller to confirm or correct
// them, and to enter their real cost so a break-even/loss listing gets
// blocked rather than silently published.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const form = await req.formData();

  const title = String(form.get("title") ?? "").trim();
  const description = String(form.get("description") ?? "").trim();
  const price = Number(form.get("price"));
  const cost = form.get("cost") ? Number(form.get("cost")) : null;
  const imageUrl = String(form.get("image_url") ?? "").trim();
  const quantity = Number(form.get("quantity") ?? 1);
  const condition = String(form.get("condition") ?? "NEW");

  if (!title || title.length < 5) {
    await fail(db, params.id, "Enter the real product title (brand/model/fitment) — not a generic keyword phrase.");
    return NextResponse.redirect(new URL("/", req.url));
  }
  if (!Number.isFinite(price) || price <= 0) {
    await fail(db, params.id, "Enter a real selling price.");
    return NextResponse.redirect(new URL("/", req.url));
  }
  if (cost !== null && (!Number.isFinite(cost) || cost < 0)) {
    await fail(db, params.id, "Cost must be a valid number.");
    return NextResponse.redirect(new URL("/", req.url));
  }
  if (cost !== null && price <= cost) {
    await fail(
      db,
      params.id,
      `Selling price ($${price.toFixed(2)}) doesn't cover your cost ($${cost.toFixed(2)}) — this would lose money. Raise the price or source it cheaper before publishing.`
    );
    return NextResponse.redirect(new URL("/", req.url));
  }
  if (!imageUrl || !imageUrl.startsWith("https://")) {
    await fail(db, params.id, "A real https:// image URL is required.");
    return NextResponse.redirect(new URL("/", req.url));
  }
  if (!Number.isFinite(quantity) || quantity < 1) {
    await fail(db, params.id, "Quantity must be at least 1.");
    return NextResponse.redirect(new URL("/", req.url));
  }
  if (!CONDITIONS.has(condition)) {
    await fail(db, params.id, "Invalid condition.");
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
    await fail(db, params.id, "Only approved drafts can be published.");
    return NextResponse.redirect(new URL("/", req.url));
  }
  const categoryId = String(form.get("category_id") ?? draft.suggested_category_id ?? "").trim();
  if (!categoryId) {
    await fail(db, params.id, "No eBay category set — enter a category ID before publishing.");
    return NextResponse.redirect(new URL("/", req.url));
  }

  const sku = draft.sku ?? `JDMK-${params.id.slice(0, 8)}`;

  try {
    const result = await publishListing({
      sku,
      title,
      description: description || title,
      imageUrls: [imageUrl],
      quantity,
      condition,
      categoryId,
      price,
      currency: "AUD",
    });

    await db
      .from("listing_opportunities")
      .update({
        status: "published",
        sku,
        suggested_title: title,
        suggested_price: price,
        suggested_description: description || title,
        suggested_category_id: categoryId,
        ebay_item_id: result.listingId,
        ebay_offer_id: result.offerId,
        publish_error: null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", params.id);
  } catch (err) {
    await fail(db, params.id, String(err), { sku });
  }

  return NextResponse.redirect(new URL("/", req.url));
}
