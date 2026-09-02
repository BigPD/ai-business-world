import { NextResponse } from "next/server";
import { ebayApiFetch } from "@/lib/ebay";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type ItemSummary = { price?: { value?: string; currency?: string } };

// Rough first-pass heuristic: prefer keywords with a healthy average sale
// price and comparatively few active competing listings. Refine once real
// snapshots are being collected daily.
function opportunityScore(avgPrice: number, activeCount: number) {
  if (!avgPrice) return 0;
  return Math.round((avgPrice / Math.log(2 + activeCount)) * 100) / 100;
}

async function scanKeyword(keyword: string, categoryId: string | null) {
  const params = new URLSearchParams({ q: keyword, limit: "50" });
  if (categoryId) params.set("category_ids", categoryId);
  const data = await ebayApiFetch(`/buy/browse/v1/item_summary/search?${params.toString()}`, {
    asUser: false,
    headers: { "X-EBAY-C-MARKETPLACE-ID": "EBAY_AU" },
  });

  const items: ItemSummary[] = data.itemSummaries ?? [];
  const prices = items
    .map((item) => Number(item.price?.value))
    .filter((price) => Number.isFinite(price) && price > 0);

  const activeListingCount: number = data.total ?? items.length;
  const avgSoldPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : 0;
  const minSoldPrice = prices.length ? Math.min(...prices) : 0;
  const maxSoldPrice = prices.length ? Math.max(...prices) : 0;

  return {
    keyword,
    category_id: categoryId,
    avg_sold_price: avgSoldPrice || null,
    min_sold_price: minSoldPrice || null,
    max_sold_price: maxSoldPrice || null,
    active_listing_count: activeListingCount,
    opportunity_score: opportunityScore(avgSoldPrice, activeListingCount),
    source: "ebay_browse_api",
    raw: { total: data.total, sampleSize: items.length },
  };
}

// Runs the JDM Kingdom trend watchlist (trend_keywords table) against
// eBay's Browse API daily and records a snapshot per keyword. This uses
// active-listing price/competition data as a proxy for demand — eBay's
// Marketplace Insights API (actual sold-item history) is gated behind a
// separate approval; swap it in here once that access is granted.
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: keywords, error } = await db
    .from("trend_keywords")
    .select("keyword, category_id")
    .eq("active", true);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  const results = [];
  for (const kw of keywords ?? []) {
    try {
      const snapshot = await scanKeyword(kw.keyword, kw.category_id);
      const { error: insertError } = await db.from("trend_snapshots").insert(snapshot);
      results.push({ keyword: kw.keyword, ok: !insertError, error: insertError?.message });
    } catch (err) {
      results.push({ keyword: kw.keyword, ok: false, error: String(err) });
    }
  }

  return NextResponse.json({ ok: true, scanned: results.length, results });
}
