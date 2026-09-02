import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

async function getSummary() {
  const db = supabaseAdmin();
  const [tokenRes, listingsRes, ordersRes, opportunitiesRes, trendRes] = await Promise.all([
    db.from("ebay_tokens").select("environment, updated_at, refresh_token_expires_at"),
    db.from("store_listings").select("id", { count: "exact", head: true }),
    db.from("store_orders").select("id", { count: "exact", head: true }),
    db.from("listing_opportunities").select("id", { count: "exact", head: true }).eq("status", "draft"),
    db.from("trend_snapshots").select("keyword, opportunity_score, avg_sold_price, active_listing_count, scan_date").order("opportunity_score", { ascending: false }).limit(5),
  ]);

  return {
    connected: (tokenRes.data ?? []).some((t) => !!t.refresh_token_expires_at),
    tokens: tokenRes.data ?? [],
    listingsCount: listingsRes.count ?? 0,
    ordersCount: ordersRes.count ?? 0,
    draftOpportunities: opportunitiesRes.count ?? 0,
    topTrends: trendRes.data ?? [],
  };
}

function Card({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ background: "#161a22", borderRadius: 12, padding: "18px 22px", minWidth: 160 }}>
      <div style={{ fontSize: 12, color: "#9aa4b2", textTransform: "uppercase", letterSpacing: 0.5 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 600, marginTop: 6 }}>{value}</div>
    </div>
  );
}

export default async function Home({ searchParams }: { searchParams: { connected?: string; ebay_error?: string } }) {
  const summary = await getSummary();

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "40px 24px" }}>
      <h1 style={{ marginBottom: 4 }}>JDM Kingdom — eBay Control Center</h1>
      <p style={{ color: "#9aa4b2", marginTop: 0 }}>Store sync, trend research and listing automation.</p>

      {searchParams.connected && (
        <div style={{ background: "#12321f", border: "1px solid #1f7a41", padding: 12, borderRadius: 8, marginBottom: 16 }}>
          eBay account connected successfully.
        </div>
      )}
      {searchParams.ebay_error && (
        <div style={{ background: "#331414", border: "1px solid #7a1f1f", padding: 12, borderRadius: 8, marginBottom: 16 }}>
          eBay connection error: {searchParams.ebay_error}
        </div>
      )}

      <div style={{ marginBottom: 24 }}>
        <strong>eBay connection: </strong>
        {summary.connected ? (
          <span style={{ color: "#4ade80" }}>Connected</span>
        ) : (
          <>
            <span style={{ color: "#f87171" }}>Not connected</span>{" "}
            — <a href="/api/ebay/oauth/start" style={{ color: "#7dd3fc" }}>connect JDM Kingdom's eBay account</a>
          </>
        )}
      </div>

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 32 }}>
        <Card label="Active listings synced" value={summary.listingsCount} />
        <Card label="Orders synced (30d)" value={summary.ordersCount} />
        <Card label="Draft listing ideas" value={summary.draftOpportunities} />
      </div>

      <h2>Top trend opportunities</h2>
      {summary.topTrends.length === 0 ? (
        <p style={{ color: "#9aa4b2" }}>No trend scans recorded yet. The daily cron job populates this.</p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#9aa4b2", fontSize: 13 }}>
              <th style={{ padding: "8px 4px" }}>Keyword</th>
              <th style={{ padding: "8px 4px" }}>Avg price</th>
              <th style={{ padding: "8px 4px" }}>Active listings</th>
              <th style={{ padding: "8px 4px" }}>Opportunity score</th>
              <th style={{ padding: "8px 4px" }}>Scanned</th>
            </tr>
          </thead>
          <tbody>
            {summary.topTrends.map((t, i) => (
              <tr key={i} style={{ borderTop: "1px solid #232833" }}>
                <td style={{ padding: "8px 4px" }}>{t.keyword}</td>
                <td style={{ padding: "8px 4px" }}>{t.avg_sold_price ? `$${Number(t.avg_sold_price).toFixed(2)}` : "—"}</td>
                <td style={{ padding: "8px 4px" }}>{t.active_listing_count ?? "—"}</td>
                <td style={{ padding: "8px 4px" }}>{t.opportunity_score ?? "—"}</td>
                <td style={{ padding: "8px 4px" }}>{t.scan_date}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
