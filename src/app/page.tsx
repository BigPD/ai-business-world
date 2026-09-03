import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type Listing = {
  ebay_item_id: string;
  title: string;
  listing_url: string | null;
  image_url: string | null;
  price: number | string | null;
  currency: string | null;
  watch_count: number | null;
  quantity_available: number | null;
  quantity_sold: number | null;
  listed_at: string | null;
};

async function getData() {
  const db = supabaseAdmin();
  const [tokenRes, allListingsRes, ordersAllRes, draftsRes, trendRes, recentOrdersRes] = await Promise.all([
    db.from("ebay_tokens").select("environment, updated_at, refresh_token_expires_at"),
    db
      .from("store_listings")
      .select("ebay_item_id, title, listing_url, image_url, price, currency, watch_count, quantity_available, quantity_sold, listed_at"),
    db.from("store_orders").select("order_total, currency"),
    db
      .from("listing_opportunities")
      .select(
        "id, suggested_title, suggested_category_id, suggested_category_name, suggested_price, rationale, status, created_at, publish_error, ebay_item_id"
      )
      .in("status", ["draft", "approved", "published"])
      .order("created_at", { ascending: false })
      .limit(15),
    db
      .from("trend_snapshots")
      .select("keyword, opportunity_score, avg_sold_price, active_listing_count, scan_date")
      .order("opportunity_score", { ascending: false })
      .limit(8),
    db
      .from("store_orders")
      .select("ebay_order_id, buyer_username, order_total, currency, order_status, placed_at")
      .order("placed_at", { ascending: false })
      .limit(8),
  ]);

  const orders = ordersAllRes.data ?? [];
  const revenue30d = orders.reduce((sum, o) => sum + (Number(o.order_total) || 0), 0);
  const currency = orders[0]?.currency ?? "AUD";
  const listings: Listing[] = allListingsRes.data ?? [];

  const now = Date.now();
  type Flagged = Listing & { flag: string; flagKind: "warn" | "hot" | "good"; daysLive: number | null };
  const flagged: Flagged[] = [];
  for (const l of listings) {
    const daysLive = l.listed_at ? Math.floor((now - new Date(l.listed_at).getTime()) / 86_400_000) : null;
    const watch = l.watch_count ?? 0;
    const sold = l.quantity_sold ?? 0;
    if (watch >= 8 && sold === 0) {
      flagged.push({ ...l, daysLive, flagKind: "hot", flag: `${watch} watchers, zero sales — price may be blocking the sale, try a small cut` });
    } else if (daysLive !== null && daysLive > 30 && watch === 0 && sold === 0) {
      flagged.push({ ...l, daysLive, flagKind: "warn", flag: `Live ${daysLive} days with zero watchers/sales — refresh title, photos or price` });
    } else if (sold >= 2) {
      flagged.push({ ...l, daysLive, flagKind: "good", flag: `${sold} sold — strong seller, consider a small price rise or restock` });
    }
  }
  const priority = { hot: 0, warn: 1, good: 2 } as const;
  flagged.sort((a, b) => priority[a.flagKind] - priority[b.flagKind]);

  const topListings = [...listings]
    .sort((a, b) => (b.watch_count ?? 0) - (a.watch_count ?? 0))
    .slice(0, 8);

  return {
    connected: (tokenRes.data ?? []).some((t) => !!t.refresh_token_expires_at),
    listingsCount: listings.length,
    ordersCount: orders.length,
    draftOpportunities: draftsRes.data?.filter((d) => d.status === "draft").length ?? 0,
    revenue30d,
    currency,
    topTrends: trendRes.data ?? [],
    topListings,
    recentOrders: recentOrdersRes.data ?? [],
    recommendations: flagged.slice(0, 10),
    drafts: draftsRes.data ?? [],
  };
}

function money(value: number | string | null | undefined, currency = "AUD") {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency }).format(n);
}

function ebaySearchUrl(keyword: string) {
  return `https://www.ebay.com.au/sch/i.html?_nkw=${encodeURIComponent(keyword)}`;
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

export default async function Home({ searchParams }: { searchParams: { connected?: string; ebay_error?: string } }) {
  const data = await getData();

  return (
    <main className="page">
      <style>{`
        .page { max-width: 1080px; margin: 0 auto; padding: 40px 24px 80px; }
        .header-row { display: flex; justify-content: space-between; align-items: flex-end; flex-wrap: wrap; gap: 12px; margin-bottom: 20px; }
        .title { font-size: 28px; font-weight: 700; margin: 0; letter-spacing: -0.01em; }
        .subtitle { color: #9aa4b2; margin: 4px 0 0; font-size: 14px; }
        .banner { padding: 12px 16px; border-radius: 10px; margin-bottom: 18px; font-size: 14px; }
        .banner-ok { background: #12321f; border: 1px solid #1f7a41; color: #bdf5cf; }
        .banner-err { background: #331414; border: 1px solid #7a1f1f; color: #ffcccc; }
        .connection-row { display: flex; align-items: center; gap: 8px; margin-bottom: 28px; font-size: 14px; }
        .pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
        .pill-on { background: rgba(74,222,128,0.12); color: #4ade80; }
        .pill-off { background: rgba(248,113,113,0.12); color: #f87171; }
        .link { color: #7dd3fc; text-decoration: none; }
        .link:hover { text-decoration: underline; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; margin-bottom: 36px; }
        .stat { background: linear-gradient(180deg,#171b24,#12151c); border: 1px solid #232833; border-radius: 14px; padding: 18px 20px; }
        .stat-label { font-size: 11px; color: #8891a0; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 8px; }
        .stat-value { font-size: 26px; font-weight: 700; }
        section { margin-bottom: 40px; }
        .section-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 14px; }
        .section-title { font-size: 17px; font-weight: 600; margin: 0; }
        .section-note { color: #8891a0; font-size: 12px; }
        .card-table { background: #12151c; border: 1px solid #232833; border-radius: 14px; overflow: hidden; }
        table { width: 100%; border-collapse: collapse; font-size: 13.5px; }
        th { text-align: left; color: #8891a0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; padding: 12px 16px; border-bottom: 1px solid #232833; }
        td { padding: 12px 16px; border-bottom: 1px solid #1b1f28; vertical-align: middle; }
        tr:last-child td { border-bottom: none; }
        tbody tr:hover { background: #161a22; }
        .listing-cell { display: flex; align-items: center; gap: 10px; }
        .thumb { width: 40px; height: 40px; border-radius: 6px; object-fit: cover; background: #232833; flex-shrink: 0; }
        .item-title { color: #e8eaed; text-decoration: none; max-width: 380px; display: inline-block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
        .item-title:hover { color: #7dd3fc; text-decoration: underline; }
        .muted { color: #8891a0; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; background: #232833; color: #c3cad6; }
        .flag-hot { color: #fbbf24; }
        .flag-warn { color: #f87171; }
        .flag-good { color: #4ade80; }
        .empty { color: #8891a0; padding: 24px 16px; font-size: 13.5px; }
        .draft-card { padding: 16px; border-bottom: 1px solid #1b1f28; }
        .draft-card:last-child { border-bottom: none; }
        .draft-top { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
        .draft-title { font-weight: 600; font-size: 14px; }
        .draft-meta { color: #8891a0; font-size: 12px; margin-top: 4px; }
        .draft-rationale { color: #b7bfca; font-size: 12.5px; margin-top: 8px; }
        .draft-actions { margin-top: 10px; display: flex; gap: 8px; }
        .btn { border: none; border-radius: 8px; padding: 6px 14px; font-size: 12.5px; font-weight: 600; cursor: pointer; }
        .btn-approve { background: #1f7a41; color: #d5ffe4; }
        .btn-reject { background: #3a1414; color: #ffd5d5; }
        .publish-form { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
        .input { background: #0d0f14; border: 1px solid #2a303c; color: #e8eaed; border-radius: 8px; padding: 6px 10px; font-size: 12.5px; }
        .input-narrow { width: 90px; }
        .disclaimer { color: #6b7382; font-size: 11.5px; margin-top: 10px; }
      `}</style>

      <div className="header-row">
        <div>
          <h1 className="title">JDM Kingdom — eBay Control Center</h1>
          <p className="subtitle">Store sync, trend research and listing automation.</p>
        </div>
        <div className="connection-row">
          <span>eBay:</span>
          {data.connected ? (
            <span className="pill pill-on">● Connected</span>
          ) : (
            <>
              <span className="pill pill-off">● Not connected</span>
              <a href="/api/ebay/oauth/start" className="link">connect account</a>
            </>
          )}
        </div>
      </div>

      {searchParams.connected && <div className="banner banner-ok">eBay account connected successfully.</div>}
      {searchParams.ebay_error && <div className="banner banner-err">eBay connection error: {searchParams.ebay_error}</div>}

      <div className="stats">
        <Stat label="Active listings" value={data.listingsCount} />
        <Stat label="Orders (30d)" value={data.ordersCount} />
        <Stat label="Revenue (30d)" value={money(data.revenue30d, data.currency)} />
        <Stat label="Draft ad ideas" value={data.draftOpportunities} />
      </div>

      <section>
        <div className="section-head">
          <h2 className="section-title">Ads to optimize</h2>
          <span className="section-note">Generated from your real listing performance — no action taken automatically</span>
        </div>
        <div className="card-table">
          {data.recommendations.length === 0 ? (
            <div className="empty">No listings currently flagged — nothing stands out as underperforming or overperforming yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Price</th>
                  <th>Watchers</th>
                  <th>Sold</th>
                  <th>Recommendation</th>
                </tr>
              </thead>
              <tbody>
                {data.recommendations.map((l) => (
                  <tr key={l.ebay_item_id}>
                    <td>
                      <div className="listing-cell">
                        {l.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.image_url} alt="" className="thumb" />
                        ) : (
                          <div className="thumb" />
                        )}
                        <a href={l.listing_url ?? "#"} target="_blank" rel="noreferrer" className="item-title" title={l.title}>
                          {l.title}
                        </a>
                      </div>
                    </td>
                    <td>{money(l.price, l.currency ?? "AUD")}</td>
                    <td>{l.watch_count ?? 0}</td>
                    <td>{l.quantity_sold ?? 0}</td>
                    <td className={`flag-${l.flagKind}`}>{l.flag}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2 className="section-title">Draft ad ideas from trending searches</h2>
          <span className="section-note">Real eBay category + market price, template copy — review before publishing</span>
        </div>
        <div className="card-table">
          {data.drafts.length === 0 ? (
            <div className="empty">
              No drafts generated yet. Trigger <code>/api/cron/generate-opportunities</code> after a few days of trend
              scans to build these from real demand data.
            </div>
          ) : (
            <>
              {data.drafts.map((d) => (
                <div className="draft-card" key={d.id}>
                  <div className="draft-top">
                    <div className="draft-title">
                      {d.suggested_title}{" "}
                      {d.status === "published" && <span className="badge" style={{ background: "#1f7a41", color: "#d5ffe4" }}>Published</span>}
                      {d.status === "approved" && <span className="badge">Approved — ready to publish</span>}
                    </div>
                    <div>{money(d.suggested_price)}</div>
                  </div>
                  <div className="draft-meta">Category: {d.suggested_category_name ?? "not matched"}{d.suggested_category_id ? ` (#${d.suggested_category_id})` : ""}</div>
                  <div className="draft-rationale">{d.rationale}</div>
                  {d.publish_error && <div className="draft-rationale flag-warn">Publish failed: {d.publish_error}</div>}

                  {d.status === "draft" && (
                    <div className="draft-actions">
                      <form action={`/api/opportunities/${d.id}`} method="post">
                        <input type="hidden" name="action" value="approve" />
                        <button type="submit" className="btn btn-approve">Approve</button>
                      </form>
                      <form action={`/api/opportunities/${d.id}`} method="post">
                        <input type="hidden" name="action" value="reject" />
                        <button type="submit" className="btn btn-reject">Reject</button>
                      </form>
                    </div>
                  )}

                  {d.status === "approved" && (
                    <form action={`/api/opportunities/${d.id}/publish`} method="post" className="publish-form">
                      <input name="image_url" placeholder="Real product photo URL (https://...)" className="input" required />
                      <input name="quantity" type="number" min={1} defaultValue={1} className="input input-narrow" />
                      <select name="condition" className="input input-narrow" defaultValue="NEW">
                        <option value="NEW">New</option>
                        <option value="USED_EXCELLENT">Used — Excellent</option>
                        <option value="USED_GOOD">Used — Good</option>
                        <option value="USED_ACCEPTABLE">Used — Acceptable</option>
                        <option value="FOR_PARTS_OR_NOT_WORKING">For parts / not working</option>
                      </select>
                      <button type="submit" className="btn btn-approve">Publish to eBay</button>
                    </form>
                  )}

                  {d.status === "published" && d.ebay_item_id && (
                    <a href={`https://www.ebay.com.au/itm/${d.ebay_item_id}`} target="_blank" rel="noreferrer" className="link">
                      View live listing →
                    </a>
                  )}
                </div>
              ))}
              <div className="disclaimer" style={{ padding: "0 16px 16px" }}>
                Publishing creates a real, live eBay listing under your account — check the details before submitting.
              </div>
            </>
          )}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2 className="section-title">Top listings by watchers</h2>
          <span className="section-note">Click a title to open it on eBay</span>
        </div>
        <div className="card-table">
          {data.topListings.length === 0 ? (
            <div className="empty">No listings synced yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Price</th>
                  <th>Watchers</th>
                  <th>Qty available</th>
                  <th>Qty sold</th>
                </tr>
              </thead>
              <tbody>
                {data.topListings.map((l) => (
                  <tr key={l.ebay_item_id}>
                    <td>
                      <div className="listing-cell">
                        {l.image_url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={l.image_url} alt="" className="thumb" />
                        ) : (
                          <div className="thumb" />
                        )}
                        <a href={l.listing_url ?? "#"} target="_blank" rel="noreferrer" className="item-title" title={l.title}>
                          {l.title}
                        </a>
                      </div>
                    </td>
                    <td>{money(l.price, l.currency ?? "AUD")}</td>
                    <td>{l.watch_count ?? "—"}</td>
                    <td>{l.quantity_available ?? "—"}</td>
                    <td>{l.quantity_sold ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2 className="section-title">Recent orders</h2>
        </div>
        <div className="card-table">
          {data.recentOrders.length === 0 ? (
            <div className="empty">No orders synced yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Order</th>
                  <th>Buyer</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th>Placed</th>
                </tr>
              </thead>
              <tbody>
                {data.recentOrders.map((o) => (
                  <tr key={o.ebay_order_id}>
                    <td className="muted">{o.ebay_order_id}</td>
                    <td>{o.buyer_username ?? "—"}</td>
                    <td>{money(o.order_total, o.currency ?? "AUD")}</td>
                    <td><span className="badge">{o.order_status ?? "—"}</span></td>
                    <td className="muted">{o.placed_at ? new Date(o.placed_at).toLocaleDateString("en-AU") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <section>
        <div className="section-head">
          <h2 className="section-title">Top trend opportunities</h2>
          <span className="section-note">Click a keyword to see it live on eBay</span>
        </div>
        <div className="card-table">
          {data.topTrends.length === 0 ? (
            <div className="empty">No trend scans recorded yet. The daily cron job populates this.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Keyword</th>
                  <th>Avg price</th>
                  <th>Active listings</th>
                  <th>Opportunity score</th>
                  <th>Scanned</th>
                </tr>
              </thead>
              <tbody>
                {data.topTrends.map((t, i) => (
                  <tr key={i}>
                    <td>
                      <a href={ebaySearchUrl(t.keyword)} target="_blank" rel="noreferrer" className="link">
                        {t.keyword}
                      </a>
                    </td>
                    <td>{t.avg_sold_price ? money(t.avg_sold_price) : "—"}</td>
                    <td>{t.active_listing_count ?? "—"}</td>
                    <td>{t.opportunity_score ?? "—"}</td>
                    <td className="muted">{t.scan_date}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </main>
  );
}
