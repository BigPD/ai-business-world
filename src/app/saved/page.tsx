import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

function money(value: number | string | null | undefined) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(n);
}

export default async function SavedOpportunitiesPage() {
  const db = supabaseAdmin();

  const { data: saved } = await db
    .from("saved_opportunities")
    .select("id, research_product_id, notes, created_at")
    .eq("status", "saved")
    .order("created_at", { ascending: false });

  const productIds = (saved ?? []).map((s) => s.research_product_id);
  const savedIds = (saved ?? []).map((s) => s.id);

  const [productsRes, supplierProductsRes, complianceRes, draftsRes] = await Promise.all([
    productIds.length ? db.from("research_products").select("*").in("id", productIds) : Promise.resolve({ data: [] }),
    savedIds.length ? db.from("supplier_products").select("*, suppliers(name, url, country)").in("saved_opportunity_id", savedIds) : Promise.resolve({ data: [] }),
    savedIds.length ? db.from("compliance_checks").select("*").in("saved_opportunity_id", savedIds) : Promise.resolve({ data: [] }),
    savedIds.length ? db.from("listing_drafts").select("id, saved_opportunity_id, status").in("saved_opportunity_id", savedIds) : Promise.resolve({ data: [] }),
  ]);

  const productById = new Map((productsRes.data ?? []).map((p) => [p.id, p]));
  const supplierProductByOpp = new Map((supplierProductsRes.data ?? []).map((sp) => [sp.saved_opportunity_id, sp]));
  const complianceByOpp = new Map<string, typeof complianceRes.data>();
  for (const c of complianceRes.data ?? []) {
    const arr = complianceByOpp.get(c.saved_opportunity_id) ?? [];
    arr.push(c);
    complianceByOpp.set(c.saved_opportunity_id, arr);
  }
  const draftByOpp = new Map((draftsRes.data ?? []).map((d) => [d.saved_opportunity_id, d]));

  const supplierProductIds = (supplierProductsRes.data ?? []).map((sp) => sp.id);
  const { data: profitRows } = supplierProductIds.length
    ? await db.from("profit_calculations").select("*").in("supplier_product_id", supplierProductIds).order("computed_at", { ascending: false })
    : { data: [] };
  const profitBySupplierProduct = new Map<string, typeof profitRows>();
  for (const p of profitRows ?? []) {
    const arr = profitBySupplierProduct.get(p.supplier_product_id) ?? [];
    if (!arr.find((x) => x.scenario === p.scenario)) arr.push(p); // first (most recent) per scenario
    profitBySupplierProduct.set(p.supplier_product_id, arr);
  }

  return (
    <main style={{ maxWidth: 1100, margin: "0 auto", padding: "40px 24px 80px", fontFamily: "system-ui,sans-serif", background: "#0b0d12", color: "#e8eaed" }}>
      <style>{`
        .card { background:#12151c; border:1px solid #232833; border-radius:12px; padding:18px; margin-bottom:20px; }
        .row { display:flex; gap:16px; flex-wrap:wrap; }
        .col { flex:1; min-width:260px; }
        h3 { margin:0 0 8px; font-size:15px; }
        .input { background:#0d0f14; border:1px solid #2a303c; color:#e8eaed; border-radius:8px; padding:6px 10px; font-size:12.5px; width:100%; box-sizing:border-box; }
        .field { display:flex; flex-direction:column; gap:3px; font-size:11px; color:#8891a0; margin-bottom:8px; }
        .grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px; }
        table { width:100%; border-collapse:collapse; font-size:12px; margin-top:8px; }
        th,td { text-align:left; padding:6px 8px; border-bottom:1px solid #232833; }
        .badge { display:inline-block; padding:2px 8px; border-radius:6px; font-size:10.5px; font-weight:600; margin-right:4px; margin-bottom:4px; }
        .badge-pass { background:#12321f; color:#bdf5cf; }
        .badge-warn { background:#3a2f0d; color:#ffe4b3; }
        .badge-block { background:#3a1414; color:#ffbdbd; }
        .btn { border:none; border-radius:8px; padding:8px 18px; font-size:12.5px; font-weight:600; cursor:pointer; background:#1f7a41; color:#d5ffe4; }
        .link { color:#7dd3fc; text-decoration:none; }
        img.thumb { width:64px; height:64px; object-fit:cover; border-radius:8px; background:#232833; }
      `}</style>
      <h1>Saved Opportunities</h1>
      <p><a href="/" className="link">← Store</a> · <a href="/research" className="link">Product Research</a> · <a href="/health" className="link">API &amp; Data Health</a></p>

      {(saved ?? []).length === 0 && <div className="card">No saved opportunities yet — save candidates from <a href="/research" className="link">Product Research</a>.</div>}

      {(saved ?? []).map((s) => {
        const product = productById.get(s.research_product_id);
        if (!product) return null;
        const sp = supplierProductByOpp.get(s.id);
        const compliance = complianceByOpp.get(s.id) ?? [];
        const profits = sp ? profitBySupplierProduct.get(sp.id) ?? [] : [];
        const draft = draftByOpp.get(s.id);
        const worstCompliance = compliance.some((c) => c.status === "block") ? "block" : compliance.some((c) => c.status === "warn") ? "warn" : compliance.length ? "pass" : null;

        return (
          <div className="card" key={s.id}>
            <div style={{ display: "flex", gap: 14 }}>
              {product.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={product.image_url} alt="" className="thumb" />
              ) : (
                <div className="thumb" />
              )}
              <div style={{ flex: 1 }}>
                <h3 style={{ fontSize: 16 }}>{product.display_title}</h3>
                <div style={{ fontSize: 12, color: "#8891a0" }}>
                  {product.brand && `Brand: ${product.brand} · `}
                  {product.category_name ?? product.category_id ?? "no category"}
                  {product.listing_url && <> · <a href={product.listing_url} target="_blank" rel="noreferrer" className="link">reference listing</a></>}
                </div>
              </div>
            </div>

            {worstCompliance && (
              <div style={{ marginTop: 12 }}>
                {compliance.map((c) => (
                  <span key={c.check_type} className={`badge badge-${c.status}`} title={c.notes}>
                    {c.status.toUpperCase()}: {c.check_type.replace(/_/g, " ")}
                  </span>
                ))}
              </div>
            )}

            <div className="row" style={{ marginTop: 14 }}>
              <div className="col">
                <h3>Supplier &amp; landed cost</h3>
                <form action={`/api/saved-opportunities/${s.id}/supplier`} method="post">
                  <div className="grid3">
                    <label className="field"><span>Supplier name</span><input className="input" name="supplier_name" defaultValue={sp?.suppliers?.name ?? ""} /></label>
                    <label className="field"><span>Supplier URL</span><input className="input" name="supplier_url" defaultValue={sp?.suppliers?.url ?? ""} /></label>
                    <label className="field"><span>Country</span><input className="input" name="supplier_country" defaultValue={sp?.suppliers?.country ?? ""} /></label>
                    <label className="field"><span>Supplier SKU</span><input className="input" name="supplier_sku" defaultValue={sp?.supplier_sku ?? ""} /></label>
                    <label className="field"><span>Product cost (AUD)</span><input className="input" type="number" step="0.01" name="product_cost" defaultValue={sp?.product_cost ?? ""} required /></label>
                    <label className="field"><span>Freight to AU / unit</span><input className="input" type="number" step="0.01" name="freight_to_au" defaultValue={sp?.freight_to_au ?? ""} /></label>
                    <label className="field"><span>Import duty %</span><input className="input" type="number" step="0.01" name="import_duty_pct" defaultValue={sp?.import_duty_pct ?? ""} /></label>
                    <label className="field"><span>GST treatment</span><input className="input" name="gst_treatment" defaultValue={sp?.gst_treatment ?? ""} placeholder="e.g. GST included" /></label>
                    <label className="field"><span>Min order qty</span><input className="input" type="number" name="min_order_qty" defaultValue={sp?.min_order_qty ?? ""} /></label>
                    <label className="field"><span>Available stock</span><input className="input" type="number" name="available_stock" defaultValue={sp?.available_stock ?? ""} /></label>
                    <label className="field"><span>Lead time (days)</span><input className="input" type="number" name="lead_time_days" defaultValue={sp?.lead_time_days ?? ""} /></label>
                    <label className="field"><span>Weight (kg)</span><input className="input" type="number" step="0.001" name="weight_kg" defaultValue={sp?.weight_kg ?? ""} /></label>
                    <label className="field"><span>Length (cm)</span><input className="input" type="number" step="0.1" name="package_length_cm" defaultValue={sp?.package_length_cm ?? ""} /></label>
                    <label className="field"><span>Width (cm)</span><input className="input" type="number" step="0.1" name="package_width_cm" defaultValue={sp?.package_width_cm ?? ""} /></label>
                    <label className="field"><span>Height (cm)</span><input className="input" type="number" step="0.1" name="package_height_cm" defaultValue={sp?.package_height_cm ?? ""} /></label>
                  </div>

                  <h3 style={{ marginTop: 14 }}>Fees &amp; postage (shared across scenarios)</h3>
                  <div className="grid3">
                    <label className="field"><span>Domestic postage cost</span><input className="input" type="number" step="0.01" name="domestic_postage_cost" defaultValue={profits[0]?.domestic_postage_cost ?? ""} /></label>
                    <label className="field"><span>eBay final value fee % (confirm your category's rate)</span><input className="input" type="number" step="0.01" name="ebay_final_value_fee_pct" defaultValue={profits[0]?.ebay_final_value_fee_pct ?? ""} required /></label>
                    <label className="field"><span>Promoted Listings %</span><input className="input" type="number" step="0.01" name="promoted_listings_pct" defaultValue={profits[0]?.promoted_listings_pct ?? 0} /></label>
                    <label className="field"><span>Payment processing %</span><input className="input" type="number" step="0.01" name="payment_processing_pct" defaultValue={profits[0]?.payment_processing_pct ?? 0} /></label>
                    <label className="field"><span>Return allowance %</span><input className="input" type="number" step="0.01" name="return_allowance_pct" defaultValue={profits[0]?.return_allowance_pct ?? 0} /></label>
                  </div>

                  <h3 style={{ marginTop: 14 }}>Scenarios — price &amp; expected units/month</h3>
                  <div className="grid3">
                    {(["conservative", "expected", "optimistic"] as const).map((sc) => {
                      const p = profits.find((x) => x.scenario === sc);
                      return (
                        <div key={sc}>
                          <div style={{ fontSize: 11, color: "#8891a0", marginBottom: 4, textTransform: "capitalize" }}>{sc}</div>
                          <label className="field"><span>Sale price</span><input className="input" type="number" step="0.01" name={`${sc}_price`} defaultValue={p?.expected_sale_price ?? ""} /></label>
                          <label className="field"><span>Units/month</span><input className="input" type="number" step="0.1" name={`${sc}_units`} defaultValue={p?.expected_units_per_month ?? ""} /></label>
                        </div>
                      );
                    })}
                  </div>
                  <label className="field" style={{ marginTop: 8 }}><span>Notes</span><textarea className="input" name="notes" rows={2} defaultValue={sp?.notes ?? ""} /></label>
                  <button type="submit" className="btn" style={{ marginTop: 10 }}>Save &amp; calculate profit</button>
                </form>
              </div>

              <div className="col">
                <h3>Profit scenarios</h3>
                {profits.length === 0 ? (
                  <p style={{ color: "#8891a0", fontSize: 12.5 }}>Enter cost data and save to see conservative/expected/optimistic profit.</p>
                ) : (
                  <table>
                    <thead><tr><th></th>{profits.map((p) => <th key={p.scenario} style={{ textTransform: "capitalize" }}>{p.scenario}</th>)}</tr></thead>
                    <tbody>
                      <tr><td>Sale price</td>{profits.map((p) => <td key={p.id}>{money(p.expected_sale_price)}</td>)}</tr>
                      <tr><td>Landed cost/unit</td>{profits.map((p) => <td key={p.id}>{money(p.landed_cost_per_unit)}</td>)}</tr>
                      <tr><td>Net profit/unit</td>{profits.map((p) => <td key={p.id}>{money(p.net_profit_per_unit)}</td>)}</tr>
                      <tr><td>Net margin</td>{profits.map((p) => <td key={p.id}>{p.net_margin_pct}%</td>)}</tr>
                      <tr><td>Break-even price</td>{profits.map((p) => <td key={p.id}>{money(p.break_even_price)}</td>)}</tr>
                      <tr><td>Monthly profit</td>{profits.map((p) => <td key={p.id}>{money(p.expected_monthly_profit)}</td>)}</tr>
                      <tr><td>Stock cash needed</td>{profits.map((p) => <td key={p.id}>{money(p.cash_required_initial_stock)}</td>)}</tr>
                    </tbody>
                  </table>
                )}

                <div style={{ marginTop: 16 }}>
                  {draft ? (
                    <a href={`/listing-studio/${s.id}`} className="link">Listing draft: {draft.status.replace(/_/g, " ")} — open Listing Studio →</a>
                  ) : sp && profits.length ? (
                    <a href={`/listing-studio/${s.id}`} className="btn" style={{ textDecoration: "none", display: "inline-block" }}>Open Listing Studio →</a>
                  ) : (
                    <p style={{ color: "#6b7382", fontSize: 11.5 }}>Complete sourcing + profit calculation before starting a listing draft.</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </main>
  );
}
