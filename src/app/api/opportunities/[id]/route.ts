import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// Review action for a single draft listing idea. Posted from the dashboard
// as a plain HTML form (action=approve|reject) — no auto-publish to eBay
// happens here, this only changes the review status in our own database.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const form = await req.formData();
  const action = form.get("action");
  const status = action === "approve" ? "approved" : action === "reject" ? "rejected" : null;
  if (!status) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }
  const db = supabaseAdmin();
  await db
    .from("listing_opportunities")
    .update({ status, reviewed_at: new Date().toISOString() })
    .eq("id", params.id);
  return NextResponse.redirect(new URL("/", req.url));
}
