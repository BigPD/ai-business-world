export type Filters = {
  min_monthly_revenue: number | null;
  max_monthly_revenue: number | null;
  min_sale_price: number | null;
  max_sale_price: number | null;
  max_competing_sellers: number | null;
  max_competing_listings: number | null;
  min_confidence: "none" | "low" | "medium" | "high" | "verified";
  results_limit: number;
  sort_order: "market_signal_score_desc" | "avg_price_desc" | "active_listing_count_asc";
};

export const DEFAULT_FILTERS: Filters = {
  min_monthly_revenue: 10000,
  max_monthly_revenue: null,
  min_sale_price: null,
  max_sale_price: null,
  max_competing_sellers: null,
  max_competing_listings: null,
  min_confidence: "low",
  results_limit: 50,
  sort_order: "market_signal_score_desc",
};

const CONFIDENCE_RANK = { none: 0, low: 1, medium: 2, high: 3, verified: 4 };

export function parseFilters(searchParams: Record<string, string | string[] | undefined>, stored: Partial<Filters>): Filters {
  const num = (key: string, fallback: number | null): number | null => {
    const v = searchParams[key];
    if (typeof v !== "string" || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  const str = <T extends string>(key: string, fallback: T): T => {
    const v = searchParams[key];
    return typeof v === "string" && v ? (v as T) : fallback;
  };

  return {
    min_monthly_revenue: num("min_monthly_revenue", stored.min_monthly_revenue ?? DEFAULT_FILTERS.min_monthly_revenue),
    max_monthly_revenue: num("max_monthly_revenue", stored.max_monthly_revenue ?? DEFAULT_FILTERS.max_monthly_revenue),
    min_sale_price: num("min_sale_price", stored.min_sale_price ?? DEFAULT_FILTERS.min_sale_price),
    max_sale_price: num("max_sale_price", stored.max_sale_price ?? DEFAULT_FILTERS.max_sale_price),
    max_competing_sellers: num("max_competing_sellers", stored.max_competing_sellers ?? DEFAULT_FILTERS.max_competing_sellers),
    max_competing_listings: num("max_competing_listings", stored.max_competing_listings ?? DEFAULT_FILTERS.max_competing_listings),
    min_confidence: str("min_confidence", (stored.min_confidence as Filters["min_confidence"]) ?? DEFAULT_FILTERS.min_confidence),
    results_limit: num("results_limit", stored.results_limit ?? DEFAULT_FILTERS.results_limit) ?? 50,
    sort_order: str("sort_order", (stored.sort_order as Filters["sort_order"]) ?? DEFAULT_FILTERS.sort_order),
  };
}

export function confidenceMeetsMin(value: string, min: Filters["min_confidence"]): boolean {
  return (CONFIDENCE_RANK[value as keyof typeof CONFIDENCE_RANK] ?? 0) >= CONFIDENCE_RANK[min];
}
