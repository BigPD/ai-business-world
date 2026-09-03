import { supabaseAdmin } from "@/lib/supabase";
import { parseFilters, confidenceMeetsMin, type Filters } from "./route-helpers";

export const dynamic = "force-dynamic";

function money(value: number | string | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n);
}

type MetricRow = {
  id: string;
  research_product_id: string;
  display_title: string;
  brand: string | null;
  mpn: string | null;
  gtin: string | null;
  cluster_confidence: number | null;
  cluster_method: string | null;
  image_url: string | null;
  listing_url: string | null;
  avg_price: number | null;
  median_price: number | null;
  min_price: number | null;
  max_price: number | null;
  unique_sellers: number | null;
  active_listing_count: number | null;
  monthly_units: number | null;
  monthly_revenue: number | null;
  confidence: string;
  market_signal_score: number | null;
  evidence_count: number;
  formula_notes: string | null;
  computed_at: string;
};

async function getData(filters: Filters) {
  const db = supabaseAdmin();

  const [marketSignalRes, verifiedRes, savedRes] = await Promise.all([
    db
      .from("latest_product_metrics")
      .select("*")
      .eq("metric_type", "market_signal")
      .order("market_signal_score", { ascending: false })
      .limit(200),
    db.from("latest_product_metrics").select("*").eq("metric_type", "verified_sales").order("monthly_revenue", { ascending: false }).limit(200),
    db.from("saved_opportunities").select("research_product_id, status"),
  ]);

  const savedStatus = new Map((savedRes.data ?? []).map((s) => [s.research_product_id, s.status]));

  let marketSignal: MetricRow[] = (marketSignalRes.data ?? []).filter((r: MetricRow) => {
    if (!confidenceMeetsMin(r.confidence, filters.min_confidence)) return false;
    if (filters.min_sale_price !== null && (r.avg_price ?? 0) < filters.min_sale_price) return false;
    if (filters.max_sale_price !== null && (r.avg_price ?? Infinity) > filters.max_sale_price) return false;
    if (filters.max_competing_sellers !== null && (r.unique_sellers ?? 0) > filters.max_competing_sellers) return false;
    if (filters.max_competing_listings !== null && (r.active_listing_count ?? 0) > filters.max_competing_listings) return false;
    return true;
  });
  if (filters.sort_order === "avg_price_desc") marketSignal = [...marketSignal].sort((a, b) => (b.avg_price ?? 0) - (a.avg_price ?? 0));
  if (filters.sort_order === "active_listing_count_asc")
    marketSignal = [...marketSignal].sort((a, b) => (a.active_listing_count ?? 0) - (b.active_listing_count ?? 0));
  marketSignal = marketSignal.slice(0, filters.results_limit);

  const verifiedAll: MetricRow[] = verifiedRes.data ?? [];
  const revenueFilterActive = filters.min_monthly_revenue !== null || filters.max_monthly_revenue !== null;
  const verified = verifiedAll.filter((r) => {
    if (filters.min_monthly_revenue !== null && (r.monthly_revenue ?? 0) < filters.min_monthly_revenue) return false;
    if (filters.max_monthly_revenue !== null && (r.monthly_revenue ?? 0) > filters.max_monthly_revenue) return false;
    return true;
  });

  return {
    marketSignal,
    verified,
    verifiedTotal: verifiedAll.length,
    revenueFilterActive,
    savedStatus,
  };
}

export default async function ResearchPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const db = supabaseAdmin();
  const { data: storedRow } = await db.from("research_filters").select("filters").eq("name", "default").maybeSingle();
  const filters = parseFilters(searchParams, (storedRow?.filters as Partial<Filters>) ?? {});

  // Persist whatever filters were used — "store my selected filters so they persist".
  await db.from("research_filters").update({ filters, updated_at: new Date().toISOString() }).eq("name", "default");

  const data = await getData(filters);

  return (
    <main className="page">
      <style>{`
        .page { max-width: 1180px; margin: 0 auto; padding: 40px 24px 80px; font-family: system-ui,-apple-system,sans-serif; background:#0b0d12; color:#e8eaed; }
        .title { font-size: 26px; font-weight: 700; margin: 0 0 4px; }
        .subtitle { color: #9aa4b2; font-size: 13.5px; margin: 0 0 20px; }
        nav.tabs { display:flex; gap:16px; margin-bottom:24px; font-size:13px; }
        nav.tabs a { color:#7dd3fc; text-decoration:none; }
        .filters { background:#12151c; border:1px solid #232833; border-radius:12px; padding:16px; margin-bottom:28px; display:flex; flex-wrap:wrap; gap:12px; align-items:end; }
        .field { display:flex; flex-direction:column; gap:4px; font-size:11px; color:#8891a0; }
        .input { background:#0d0f14; border:1px solid #2a303c; color:#e8eaed; border-radius:8px; padding:6px 10px; font-size:12.5px; width:130px; }
        .btn { border:none; border-radius:8px; padding:7px 16px; font-size:12.5px; font-weight:600; cursor:pointer; background:#1f7a41; color:#d5ffe4; }
        section { margin-bottom:36px; }
        .section-title { font-size:16px; font-weight:600; margin:0 0 6px; }
        .notice { background:#241c0d; border:1px solid #7a5a1f; color:#ffe4b3; padding:10px 14px; border-radius:8px; font-size:12.5px; margin-bottom:14px; }
        .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:14px; }
        .card { background:#12151c; border:1px solid #232833; border-radius:12px; padding:14px; }
        .card img { width:100%; height:120px; object-fit:cover; border-radius:8px; background:#232833; margin-bottom:10px; }
        .card-title { font-size:13px; font-weight:600; margin-bottom:6px; line-height:1.3; }
        .badge { display:inline-block; padding:2px 8px; border-radius:6px; font-size:10.5px; font-weight:600; background:#232833; color:#c3cad6; margin-right:4px; }
        .badge-verified { background:#1f7a41; color:#d5ffe4; }
        .badge-unverified { background:#3a1414; color:#ffbdbd; }
        .metric-row { display:flex; justify-content:space-between; font-size:12px; color:#b7bfca; margin-top:4px; }
        .score { font-size:22px; font-weight:700; }
        .formula { font-size:10.5px; color:#6b7382; margin-top:8px; }
        .card-actions { display:flex; gap:6px; margin-top:10px; }
        .btn-small { font-size:11px; padding:4px 10px; border-radius:6px; border:none; cursor:pointer; }
        .btn-save { background:#1f7a41; color:#d5ffe4; }
        .btn-reject { background:#3a1414; color:#ffd5d5; }
        .link { color:#7dd3fc; text-decoration:none; font-size:11px; }
        .empty { color:#8891a0; font-size:13px; padding:20px; }
      `}</style>

      <h1 className="title">Product Research</h1>
      <p className="subtitle">Verified Sales (real transaction evidence) vs. Market Signal (competition/pricing only — never treated as proof of sales).</p>
      <nav className="tabs">
        <a href="/">← Store dashboard</a>
        <a href="/health">API &amp; Data Health</a>
      </nav>

      <form className="filters" method="get">
        <div className="field">
          <span>Min monthly revenue (verified only)</span>
          <input className="input" type="number" name="min_monthly_revenue" defaultValue={filters.min_monthly_revenue ?? ""} placeholder="10000" />
        </div>
        <div className="field">
          <span>Max monthly revenue</span>
          <input className="input" type="number" name="max_monthly_revenue" defaultValue={filters.max_monthly_revenue ?? ""} />
        </div>
        <div className="field">
          <span>Min sale price</span>
          <input className="input" type="number" name="min_sale_price" defaultValue={filters.min_sale_price ?? ""} />
        </div>
        <div className="field">
          <span>Max sale price</span>
          <input className="input" type="number" name="max_sale_price" defaultValue={filters.max_sale_price ?? ""} />
        </div>
        <div className="field">
          <span>Max competing sellers</span>
          <input className="input" type="number" name="max_competing_sellers" defaultValue={filters.max_competing_sellers ?? ""} />
        </div>
        <div className="field">
          <span>Max competing listings</span>
          <input className="input" type="number" name="max_competing_listings" defaultValue={filters.max_competing_listings ?? ""} />
        </div>
        <div className="field">
          <span>Min confidence</span>
          <select className="input" name="min_confidence" defaultValue={filters.min_confidence}>
            <option value="none">Any</option>
            <option value="low">Low+</option>
            <option value="medium">Medium+</option>
            <option value="high">High+</option>
            <option value="verified">Verified only</option>
          </select>
        </div>
        <div className="field">
          <span>Sort</span>
          <select className="input" name="sort_order" defaultValue={filters.sort_order}>
            <option value="market_signal_score_desc">Market signal score</option>
            <option value="avg_price_desc">Avg price</option>
            <option value="active_listing_count_asc">Least competition</option>
          </select>
        </div>
        <div className="field">
          <span>Results limit</span>
          <input className="input" type="number" name="results_limit" defaultValue={filters.results_limit} />
        </div>
        <button type="submit" className="btn">Apply &amp; save</button>
      </form>

      <section>
        <h2 className="section-title">Verified Sales Research ({data.verified.length} of {data.verifiedTotal})</h2>
        {!data.revenueFilterActive && <div className="notice">No revenue filter applied — showing all verified-sales products.</div>}
        {data.verifiedTotal === 0 ? (
          <div className="notice">
            Verified competitor revenue filtering requires an approved sold-history data source (Marketplace Insights, a
            legitimate research export, or another approved provider) — none is connected yet. What you see below, once
            populated, is real revenue from JDM Kingdom&apos;s own completed orders only.
          </div>
        ) : null}
        {data.verified.length === 0 ? (
          <div className="empty">No products meet these filters. Run <code>/api/cron/store-sales-metrics</code> to populate real sales data from your own orders.</div>
        ) : (
          <div className="grid">
            {data.verified.map((r) => (
              <ProductCard key={r.id} r={r} saved={data.savedStatus.get(r.research_product_id)} verified />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="section-title">Market Signal Research ({data.marketSignal.length})</h2>
        <div className="notice">
          Market signal only. Competitor sales data unavailable — revenue unverified. Scores reflect price stability,
          competition density and seller quality, not sales volume.
        </div>
        {data.marketSignal.length === 0 ? (
          <div className="empty">
            No products yet. Run <code>/api/cron/research-scan</code> (scheduled nightly) to populate this from live eBay
            search data.
          </div>
        ) : (
          <div className="grid">
            {data.marketSignal.map((r) => (
              <ProductCard key={r.id} r={r} saved={data.savedStatus.get(r.research_product_id)} verified={false} />
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function ProductCard({ r, saved, verified }: { r: MetricRow; saved?: string; verified: boolean }) {
  return (
    <div className="card">
      {r.image_url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={r.image_url} alt="" />
      ) : (
        <div style={{ height: 120, background: "#232833", borderRadius: 8, marginBottom: 10 }} />
      )}
      <div className="card-title">{r.display_title}</div>
      <div>
        {verified ? <span className="badge badge-verified">Verified sales</span> : <span className="badge badge-unverified">Revenue unverified</span>}
        <span className="badge">{r.confidence}</span>
        {r.brand && <span className="badge">{r.brand}</span>}
        {r.mpn && <span className="badge">MPN {r.mpn}</span>}
      </div>
      {verified ? (
        <>
          <div className="metric-row"><span>Monthly units</span><span>{r.monthly_units ?? "—"}</span></div>
          <div className="metric-row"><span>Monthly revenue</span><span>{money(r.monthly_revenue)}</span></div>
          <div className="metric-row"><span>Avg price</span><span>{money(r.avg_price)}</span></div>
        </>
      ) : (
        <>
          <div className="score">Signal {r.market_signal_score ?? "—"}/100</div>
          <div className="metric-row"><span>Avg price</span><span>{money(r.avg_price)}</span></div>
          <div className="metric-row"><span>Sellers</span><span>{r.unique_sellers ?? "—"}</span></div>
          <div className="metric-row"><span>Active listings</span><span>{r.active_listing_count ?? "—"}</span></div>
        </>
      )}
      <div className="formula">{r.formula_notes}</div>
      <div className="formula">Updated {new Date(r.computed_at).toLocaleString("en-AU")} · {r.evidence_count} evidence record(s) · method: {r.cluster_method}</div>
      <div className="card-actions">
        {r.listing_url && <a href={r.listing_url} target="_blank" rel="noreferrer" className="link">View on eBay</a>}
        {saved === "saved" ? (
          <span className="badge badge-verified">Saved</span>
        ) : saved === "rejected" ? (
          <span className="badge">Rejected</span>
        ) : (
          <>
            <form action={`/api/research/opportunities/${r.research_product_id}`} method="post">
              <input type="hidden" name="status" value="saved" />
              <button type="submit" className="btn-small btn-save">Save</button>
            </form>
            <form action={`/api/research/opportunities/${r.research_product_id}`} method="post">
              <input type="hidden" name="status" value="rejected" />
              <button type="submit" className="btn-small btn-reject">Reject</button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
