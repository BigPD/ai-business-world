import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Save or reject a research candidate. This only records a review decision
// — it does not create a listing draft or touch eBay. That's a distinct,
// later step (Listing Studio, Phase 2) requiring its own supplier/profit
// gate before anything can be marked ready to list.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const form = await req.formData();
  const status = String(form.get("status") ?? "");
  if (status !== "saved" && status !== "rejected") {
    return NextResponse.json({ error: "invalid status" }, { status: 400 });
  }
  const db = supabaseAdmin();
  await db
    .from("saved_opportunities")
    .upsert(
      { research_product_id: params.id, status, updated_at: new Date().toISOString() },
      { onConflict: "research_product_id" }
    );
  return NextResponse.redirect(new URL("/research", req.url));
}
