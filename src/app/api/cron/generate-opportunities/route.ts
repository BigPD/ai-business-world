import { NextResponse } from "next/server";
import { suggestCategory } from "@/lib/ebay";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

// Turns the strongest recent trend snapshots into concrete draft listings:
// a real eBay category (via the Taxonomy API), a market-based starting
// price, and a rationale explaining why. These land as status='draft' in
// listing_opportunities for review on the dashboard — nothing publishes to
// eBay automatically. The title/description are a template starting point,
// not AI-written copy (no LLM is wired into this app).
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();

  const { data: snapshots, error } = await db
    .from("trend_snapshots")
    .select("id, keyword, avg_sold_price, active_listing_count, opportunity_score, scan_date")
    .order("scan_date", { ascending: false })
    .order("opportunity_score", { ascending: false })
    .limit(50);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  // Keep only the most recent snapshot per keyword, ranked by score.
  const latestByKeyword = new Map<string, (typeof snapshots)[number]>();
  for (const s of snapshots ?? []) {
    if (!latestByKeyword.has(s.keyword)) latestByKeyword.set(s.keyword, s);
  }
  const ranked = [...latestByKeyword.values()]
    .filter((s) => s.opportunity_score && s.avg_sold_price)
    .sort((a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0))
    .slice(0, 8);

  const results = [];
  for (const snap of ranked) {
    const { count: alreadyStocked } = await db
      .from("store_listings")
      .select("id", { count: "exact", head: true })
      .ilike("title", `%${snap.keyword}%`);

    const { count: existingOpportunityForKeyword } = await db
      .from("listing_opportunities")
      .select("id, trend_snapshot_id, suggested_title", { count: "exact", head: true })
      .ilike("suggested_title", `%${snap.keyword}%`)
      .in("status", ["draft", "approved"]);

    if (existingOpportunityForKeyword && existingOpportunityForKeyword > 0) {
      results.push({ keyword: snap.keyword, skipped: "draft already exists" });
      continue;
    }

    let category: { id: string; name: string } | null = null;
    try {
      category = await suggestCategory(snap.keyword);
    } catch (err) {
      // non-fatal — proceed without a category suggestion
    }

    const price = snap.avg_sold_price ? Math.round(Number(snap.avg_sold_price) * 100) / 100 : null;
    const stockNote =
      alreadyStocked && alreadyStocked > 0
        ? `JDM Kingdom already has ${alreadyStocked} listing(s) matching this term — this would add another angle/variant.`
        : `JDM Kingdom currently has no listings matching this term.`;

    const { error: insertError } = await db.from("listing_opportunities").insert({
      trend_snapshot_id: snap.id,
      suggested_title: `${snap.keyword} - JDM Kingdom`,
      suggested_category_id: category?.id ?? null,
      suggested_category_name: category?.name ?? null,
      suggested_price: price,
      suggested_description: `Draft description for "${snap.keyword}". Replace with real product photos, condition, fitment details and shipping info before publishing.`,
      rationale: `${snap.active_listing_count ?? "?"} active competing listings averaging $${price ?? "?"} AUD (opportunity score ${snap.opportunity_score}). ${stockNote}`,
      status: "draft",
    });

    results.push({ keyword: snap.keyword, ok: !insertError, error: insertError?.message, category: category?.name });
  }

  return NextResponse.json({ ok: true, generated: results.length, results });
}
