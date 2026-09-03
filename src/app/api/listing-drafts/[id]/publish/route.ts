import { NextRequest, NextResponse } from "next/server";
import { publishEbayOffer } from "@/lib/ebay";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The only step in the entire approval workflow that makes a listing
// live. Requires an explicit "confirm" field from the form (the Listing
// Studio page shows a full confirmation summary before this is
// reachable) and only proceeds from status='ebay_draft_created'.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const form = await req.formData();
  if (form.get("confirm") !== "yes") {
    return NextResponse.json({ error: "publish not confirmed" }, { status: 400 });
  }

  const { data: draft } = await db.from("listing_drafts").select("*").eq("saved_opportunity_id", params.id).maybeSingle();
  if (!draft) return NextResponse.json({ error: "no draft" }, { status: 404 });
  if (draft.status !== "ebay_draft_created" || !draft.ebay_offer_id) {
    await db.from("listing_drafts").update({ publish_error: "An eBay draft must exist before publishing." }).eq("id", draft.id);
    return NextResponse.redirect(new URL(`/listing-studio/${params.id}`, req.url));
  }

  try {
    const { listingId } = await publishEbayOffer(draft.ebay_offer_id);
    await db
      .from("listing_drafts")
      .update({ status: "published", ebay_item_id: listingId, publish_error: null, published_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", draft.id);
  } catch (err) {
    await db.from("listing_drafts").update({ publish_error: String(err) }).eq("id", draft.id);
  }

  return NextResponse.redirect(new URL(`/listing-studio/${params.id}`, req.url));
}
