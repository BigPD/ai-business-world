import { NextResponse } from "next/server";
import { ebayApiFetch, getItemDetail } from "@/lib/ebay";
import { clusterProducts, scoreMarketSignal, type SearchResultItem } from "@/lib/research";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const FORMULA_VERSION = 1;
const DETAIL_ENRICH_COUNT = 3; // per keyword, fetched in parallel
const TIME_BUDGET_MS = 240_000; // leave a buffer under the 300s function cap

type BrowseItemSummary = {
  itemId: string;
  title: string;
  price?: { value?: string; currency?: string };
  seller?: { username?: string; feedbackScore?: number; feedbackPercentage?: string };
  condition?: string;
  itemLocation?: { country?: string };
  itemWebUrl?: string;
  image?: { imageUrl?: string };
};

async function enrichItem(item: SearchResultItem) {
  try {
    const detail = await getItemDetail(item.itemId);
    const aspects: Record<string, string[]> = detail.localizedAspects
      ? Object.fromEntries(detail.localizedAspects.map((a: { name: string; value: string }) => [a.name, [a.value]]))
      : {};
    item.brand = detail.brand ?? aspects["Brand"]?.[0] ?? null;
    item.mpn = detail.mpn ?? aspects["Manufacturer Part Number"]?.[0] ?? aspects["MPN"]?.[0] ?? null;
    item.gtin = detail.gtin ?? null;
  } catch {
    // non-fatal — this item just stays without identifier enrichment
  }
}

async function searchKeyword(keyword: string, categoryId: string | null): Promise<SearchResultItem[]> {
  const params = new URLSearchParams({ q: keyword, limit: "50" });
  if (categoryId) params.set("category_ids", categoryId);
  const data = await ebayApiFetch(`/buy/browse/v1/item_summary/search?${params.toString()}`, {
    asUser: false,
    headers: { "X-EBAY-C-MARKETPLACE-ID": "EBAY_AU" },
  });
  const summaries: BrowseItemSummary[] = data.itemSummaries ?? [];

  const items: SearchResultItem[] = summaries.map((s) => ({
    itemId: s.itemId,
    title: s.title,
    price: s.price?.value ? Number(s.price.value) : null,
    currency: s.price?.currency ?? "AUD",
    sellerUsername: s.seller?.username ?? null,
    sellerFeedbackScore: s.seller?.feedbackScore ?? null,
    sellerFeedbackPct: s.seller?.feedbackPercentage ? Number(s.seller.feedbackPercentage) : null,
    condition: s.condition ?? null,
    itemLocation: s.itemLocation?.country ?? null,
    itemWebUrl: s.itemWebUrl ?? null,
    imageUrl: s.image?.imageUrl ?? null,
  }));

  // Enrich only a bounded number of top-ranked results, in parallel, with
  // real detail (brand/MPN/GTIN) — fetching this for every result
  // sequentially is what blew the time budget in the first version of
  // this job (30 keywords x 5 sequential detail calls = killed at the
  // Vercel maxDuration cap with no error ever recorded).
  await Promise.all(items.slice(0, DETAIL_ENRICH_COUNT).map(enrichItem));

  return items;
}

async function findExistingProduct(db: ReturnType<typeof supabaseAdmin>, cluster: ReturnType<typeof clusterProducts>[number]) {
  if (cluster.gtin) {
    const { data } = await db.from("research_products").select("id").eq("gtin", cluster.gtin).maybeSingle();
    if (data) return data.id as string;
  }
  if (cluster.mpn && cluster.brand) {
    const { data } = await db.from("research_products").select("id").eq("mpn", cluster.mpn).eq("brand", cluster.brand).maybeSingle();
    if (data) return data.id as string;
  }
  const { data } = await db
    .from("research_products")
    .select("id")
    .eq("title_normalized", cluster.titleNormalized)
    .is("source_sku", null)
    .maybeSingle();
  return data?.id as string | undefined;
}

// Turns raw Browse API search results into specific product candidates
// (clustered by GTIN/MPN where available, else title similarity) with a
// transparent, revenue-free Market Signal score. Never writes
// monthly_units/monthly_revenue here — that would require sold-transaction
// data this app doesn't have access to (see the capability audit).
//
// Stops processing further keywords once TIME_BUDGET_MS elapses and
// finalizes the run as completed (partial) rather than risk running past
// the function's maxDuration and getting killed silently — the next
// scheduled run picks up where coverage left off.
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const db = supabaseAdmin();
  const { data: run } = await db.from("research_runs").insert({ run_type: "market_signal_scan" }).select().single();

  try {
    const { data: keywords, error } = await db.from("trend_keywords").select("keyword, category_id").eq("active", true);
    if (error) throw new Error(error.message);

    let scanned = 0;
    let found = 0;
    let timeBudgetExceeded = false;
    const results: { keyword: string; clusters: number; ok: boolean; error?: string; skipped?: boolean }[] = [];

    for (const kw of keywords ?? []) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        timeBudgetExceeded = true;
        results.push({ keyword: kw.keyword, clusters: 0, ok: true, skipped: true });
        continue;
      }

      try {
        const items = await searchKeyword(kw.keyword, kw.category_id);
        scanned += items.length;
        const clusters = clusterProducts(items);

        for (const cluster of clusters) {
          if (cluster.items.length < 2 && cluster.method === "title_similarity") continue; // too weak a signal alone

          const metrics = scoreMarketSignal(cluster);
          const existingId = await findExistingProduct(db, cluster);

          const sample = cluster.items[0];
          const { data: product, error: upsertError } = existingId
            ? await db
                .from("research_products")
                .update({
                  display_title: cluster.displayTitle,
                  image_url: sample.imageUrl,
                  listing_url: sample.itemWebUrl,
                  updated_at: new Date().toISOString(),
                })
                .eq("id", existingId)
                .select()
                .single()
            : await db
                .from("research_products")
                .insert({
                  title_normalized: cluster.titleNormalized,
                  display_title: cluster.displayTitle,
                  brand: cluster.brand,
                  mpn: cluster.mpn,
                  gtin: cluster.gtin,
                  category_id: kw.category_id,
                  cluster_confidence: cluster.confidence,
                  cluster_method: cluster.method,
                  image_url: sample.imageUrl,
                  listing_url: sample.itemWebUrl,
                })
                .select()
                .single();
          if (upsertError || !product) continue;

          await db.from("product_evidence").insert({
            research_product_id: product.id,
            provider: "EBAY_BROWSE_MARKET_SIGNAL",
            source_type: "browse_active_listing_cluster",
            external_id: sample.itemId,
            seller_username: sample.sellerUsername,
            seller_feedback_score: sample.sellerFeedbackScore,
            seller_feedback_pct: sample.sellerFeedbackPct,
            price: sample.price,
            currency: sample.currency ?? "AUD",
            item_location: sample.itemLocation,
            listing_url: sample.itemWebUrl,
            image_url: sample.imageUrl,
            raw: { keyword: kw.keyword, cluster_size: cluster.items.length, item_ids: cluster.items.map((i) => i.itemId) },
          });

          await db.from("product_metrics").insert({
            research_product_id: product.id,
            provider: "EBAY_BROWSE_MARKET_SIGNAL",
            metric_type: "market_signal",
            period_days: 0,
            monthly_units: null,
            monthly_revenue: null,
            avg_price: metrics.avgPrice,
            median_price: metrics.medianPrice,
            min_price: metrics.minPrice,
            max_price: metrics.maxPrice,
            unique_sellers: metrics.uniqueSellers,
            active_listing_count: metrics.activeListingCount,
            evidence_count: cluster.items.length,
            confidence: cluster.confidence >= 0.85 ? "medium" : "low",
            market_signal_score: metrics.marketSignalScore,
            formula_version: FORMULA_VERSION,
            formula_notes:
              "market_signal_score (0-100, NOT revenue) = price stability (30) + competition headroom (30) + multi-seller presence (20) + seller feedback quality (20). Revenue unverified — no sold-transaction data source is connected.",
          });
          found += 1;
        }
        results.push({ keyword: kw.keyword, clusters: clusters.length, ok: true });
      } catch (err) {
        results.push({ keyword: kw.keyword, clusters: 0, ok: false, error: String(err) });
      }
    }

    await db
      .from("research_runs")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
        products_scanned: scanned,
        products_found: found,
        error: timeBudgetExceeded ? "Partial run — time budget reached, remaining keywords skipped this run." : null,
      })
      .eq("id", run?.id);

    return NextResponse.json({
      ok: true,
      keywordsScanned: (keywords ?? []).length,
      itemsScanned: scanned,
      productsFound: found,
      timeBudgetExceeded,
      elapsedMs: Date.now() - startedAt,
      results,
    });
  } catch (err) {
    await db.from("research_runs").update({ status: "failed", completed_at: new Date().toISOString(), error: String(err) }).eq("id", run?.id);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
