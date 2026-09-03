// Product clustering and scoring for the Market Signal research engine.
//
// Honesty constraint: nothing in this file may compute or imply units sold,
// revenue, or a sell-through rate for competitor products — that data does
// not exist in any API this app has access to (see the capability audit).
// This file only ever produces supply-side signal: price distribution,
// competition density, seller quality. Verified Sales metrics (real
// transaction data) are computed separately in lib/verifiedSales.ts from
// this app's own order history.

const STOPWORDS = new Set([
  "for", "with", "and", "the", "new", "genuine", "oem", "aftermarket", "set",
  "kit", "pair", "pack", "of", "to", "fit", "fits", "fitting", "suit", "suits",
  "au", "aus", "australia", "free", "shipping", "post", "postage",
]);

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w))
    .sort()
    .join(" ");
}

function tokenSet(title: string): Set<string> {
  return new Set(normalizeTitle(title).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const t of a) if (b.has(t)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export type SearchResultItem = {
  itemId: string;
  title: string;
  price: number | null;
  currency: string | null;
  sellerUsername: string | null;
  sellerFeedbackScore: number | null;
  sellerFeedbackPct: number | null;
  condition: string | null;
  itemLocation: string | null;
  itemWebUrl: string | null;
  imageUrl: string | null;
  brand?: string | null;
  mpn?: string | null;
  gtin?: string | null;
};

export type ProductCluster = {
  titleNormalized: string;
  displayTitle: string;
  brand: string | null;
  mpn: string | null;
  gtin: string | null;
  confidence: number;
  method: "identifier_match" | "title_similarity";
  items: SearchResultItem[];
};

// Groups raw search results into product candidates. Identifier-based
// matches (GTIN, then MPN+brand) are high confidence; everything else falls
// back to normalized-title token overlap, which is inherently weaker and
// scored accordingly — this is disclosed in cluster_confidence, not hidden.
export function clusterProducts(items: SearchResultItem[]): ProductCluster[] {
  const clusters: ProductCluster[] = [];

  for (const item of items) {
    const gtin = item.gtin?.trim() || null;
    const mpn = item.mpn?.trim() || null;
    const brand = item.brand?.trim() || null;

    let target: ProductCluster | undefined;

    if (gtin) {
      target = clusters.find((c) => c.gtin === gtin);
      if (target) {
        target.items.push(item);
        continue;
      }
    }
    if (mpn && brand) {
      target = clusters.find((c) => c.mpn === mpn && c.brand === brand);
      if (target) {
        target.items.push(item);
        continue;
      }
    }

    if (!gtin && !(mpn && brand)) {
      const tokens = tokenSet(item.title);
      let best: { cluster: ProductCluster; score: number } | null = null;
      for (const c of clusters) {
        if (c.method !== "title_similarity") continue;
        const score = jaccard(tokens, tokenSet(c.displayTitle));
        if (score >= 0.6 && (!best || score > best.score)) best = { cluster: c, score };
      }
      if (best) {
        best.cluster.items.push(item);
        continue;
      }
    }

    clusters.push({
      titleNormalized: normalizeTitle(item.title),
      displayTitle: item.title,
      brand,
      mpn,
      gtin,
      confidence: gtin ? 0.95 : mpn && brand ? 0.85 : 0.35,
      method: gtin || (mpn && brand) ? "identifier_match" : "title_similarity",
      items: [item],
    });
  }

  return clusters;
}

export type MarketSignalMetrics = {
  avgPrice: number | null;
  medianPrice: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  uniqueSellers: number;
  activeListingCount: number;
  avgSellerFeedbackPct: number | null;
  marketSignalScore: number; // 0-100, supply-side only — never revenue
};

// Transparent, revenue-free score. Rewards: price stability (low variance),
// competition that isn't oversaturated, and seller quality. Punishes:
// single-seller monopolies (nothing to compete against fairly) and huge
// listing counts (saturated). This is NOT a proxy for sales volume.
export function scoreMarketSignal(cluster: ProductCluster): MarketSignalMetrics {
  const prices = cluster.items.map((i) => i.price).filter((p): p is number => typeof p === "number" && p > 0);
  const sellers = new Set(cluster.items.map((i) => i.sellerUsername).filter(Boolean));
  const feedbackPcts = cluster.items.map((i) => i.sellerFeedbackPct).filter((f): f is number => typeof f === "number");

  const avgPrice = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  const sorted = [...prices].sort((a, b) => a - b);
  const medianPrice = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
  const minPrice = sorted.length ? sorted[0] : null;
  const maxPrice = sorted.length ? sorted[sorted.length - 1] : null;
  const avgSellerFeedbackPct = feedbackPcts.length ? feedbackPcts.reduce((a, b) => a + b, 0) / feedbackPcts.length : null;

  const priceVariance =
    avgPrice && prices.length > 1
      ? Math.sqrt(prices.reduce((sum, p) => sum + (p - avgPrice) ** 2, 0) / prices.length) / avgPrice
      : 0;
  const priceStabilityScore = Math.max(0, 1 - priceVariance) * 30; // up to 30 pts

  const listingCount = cluster.items.length;
  const competitionScore = listingCount <= 1 ? 5 : Math.max(0, 30 - Math.log2(listingCount) * 8); // fewer listings, more room — up to 30 pts

  const sellerCountScore = sellers.size >= 2 ? 20 : 5; // real competition to benchmark against — up to 20 pts

  const feedbackScore = avgSellerFeedbackPct !== null ? (avgSellerFeedbackPct / 100) * 20 : 10; // up to 20 pts

  const marketSignalScore = Math.round(priceStabilityScore + competitionScore + sellerCountScore + feedbackScore);

  return {
    avgPrice,
    medianPrice,
    minPrice,
    maxPrice,
    uniqueSellers: sellers.size,
    activeListingCount: listingCount,
    avgSellerFeedbackPct,
    marketSignalScore,
  };
}
