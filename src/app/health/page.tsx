import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function HealthPage() {
  const db = supabaseAdmin();
  const [tokenRes, runsRes] = await Promise.all([
    db.from("ebay_tokens").select("environment, scopes, access_token_expires_at, refresh_token_expires_at, updated_at"),
    db.from("research_runs").select("*").order("started_at", { ascending: false }).limit(20),
  ]);

  const token = tokenRes.data?.[0];
  const now = Date.now();

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px 80px", fontFamily: "system-ui,sans-serif", background: "#0b0d12", color: "#e8eaed" }}>
      <style>{`
        table { width:100%; border-collapse:collapse; font-size:13px; margin-top:10px; }
        th,td { text-align:left; padding:8px 10px; border-bottom:1px solid #232833; }
        th { color:#8891a0; font-size:11px; text-transform:uppercase; }
        .card { background:#12151c; border:1px solid #232833; border-radius:12px; padding:16px; margin-bottom:24px; }
        .ok { color:#4ade80; } .bad { color:#f87171; }
        .link { color:#7dd3fc; }
      `}</style>
      <h1>API &amp; Data Health</h1>
      <p><a href="/" className="link">← Store dashboard</a> · <a href="/research" className="link">Product Research</a></p>

      <div className="card">
        <h2>eBay connection</h2>
        {token ? (
          <table>
            <tbody>
              <tr><th>Environment</th><td>{process.env.EBAY_ENV === "production" ? "production" : "sandbox"}</td></tr>
              <tr><th>Marketplace</th><td>EBAY_AU</td></tr>
              <tr>
                <th>Access token</th>
                <td className={token.access_token_expires_at && new Date(token.access_token_expires_at).getTime() > now ? "ok" : "bad"}>
                  {token.access_token_expires_at ? `expires ${new Date(token.access_token_expires_at).toLocaleString("en-AU")}` : "missing"}
                </td>
              </tr>
              <tr>
                <th>Refresh token</th>
                <td className={token.refresh_token_expires_at && new Date(token.refresh_token_expires_at).getTime() > now ? "ok" : "bad"}>
                  {token.refresh_token_expires_at ? `expires ${new Date(token.refresh_token_expires_at).toLocaleString("en-AU")}` : "missing"}
                </td>
              </tr>
              <tr><th>Granted scopes</th><td>{(token.scopes ?? []).length}</td></tr>
              <tr><th>Last token refresh</th><td>{new Date(token.updated_at).toLocaleString("en-AU")}</td></tr>
            </tbody>
          </table>
        ) : (
          <p className="bad">No eBay account connected.</p>
        )}
      </div>

      <div className="card">
        <h2>Available capabilities</h2>
        <table>
          <thead><tr><th>Capability</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td>My own listings/orders sync</td><td className="ok">Available</td></tr>
            <tr><td>Competitor active listings, price, seller (Browse API)</td><td className="ok">Available</td></tr>
            <tr><td>Category taxonomy &amp; required item specifics</td><td className="ok">Available</td></tr>
            <tr><td>Business policies / inventory publish</td><td className="ok">Available</td></tr>
            <tr><td>Competitor units sold / revenue (Marketplace Insights)</td><td className="bad">Not available — Limited Release, requires eBay approval</td></tr>
            <tr><td>Competitor watch count</td><td className="bad">Not exposed by any connected API</td></tr>
            <tr><td>Competitor GTIN/MPN/brand</td><td>Partial — only when sellers filled it in</td></tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <h2>Recent research runs</h2>
        <table>
          <thead><tr><th>Type</th><th>Status</th><th>Scanned</th><th>Found</th><th>Started</th><th>Error</th></tr></thead>
          <tbody>
            {(runsRes.data ?? []).map((r) => (
              <tr key={r.id}>
                <td>{r.run_type}</td>
                <td className={r.status === "completed" ? "ok" : r.status === "failed" ? "bad" : ""}>{r.status}</td>
                <td>{r.products_scanned}</td>
                <td>{r.products_found}</td>
                <td>{new Date(r.started_at).toLocaleString("en-AU")}</td>
                <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.error ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
