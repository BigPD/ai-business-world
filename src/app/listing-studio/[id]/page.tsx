import { supabaseAdmin } from "@/lib/supabase";
import { getCategoryAspects } from "@/lib/ebay";

export const dynamic = "force-dynamic";

export default async function ListingStudioPage({ params }: { params: { id: string } }) {
  const db = supabaseAdmin();

  const { data: opp } = await db
    .from("saved_opportunities")
    .select("id, research_product_id, research_products(*)")
    .eq("id", params.id)
    .single();
  if (!opp) {
    return <main style={{ padding: 40, color: "#e8eaed", background: "#0b0d12" }}>Opportunity not found.</main>;
  }
  const product = (opp as unknown as { research_products: any }).research_products;

  const [draftRes, supplierRes, complianceRes] = await Promise.all([
    db.from("listing_drafts").select("*").eq("saved_opportunity_id", params.id).maybeSingle(),
    db.from("supplier_products").select("*").eq("saved_opportunity_id", params.id).maybeSingle(),
    db.from("compliance_checks").select("*").eq("saved_opportunity_id", params.id),
  ]);
  const draft = draftRes.data;
  const supplierProduct = supplierRes.data;
  const compliance = complianceRes.data ?? [];
  const hasBlock = compliance.some((c) => c.status === "block");

  const categoryId = draft?.category_id ?? product?.category_id ?? "";
  let aspects: { name: string; required: boolean }[] = [];
  if (categoryId) {
    try {
      aspects = await getCategoryAspects(categoryId);
    } catch {
      aspects = [];
    }
  }
  const currentSpecifics = (draft?.item_specifics as Record<string, string>) ?? {};
  const images: { url: string; source: string }[] = (draft?.images as { url: string; source: string }[]) ?? [];

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "40px 24px 100px", fontFamily: "system-ui,sans-serif", background: "#0b0d12", color: "#e8eaed" }}>
      <style>{`
        .input, textarea.input, select.input { background:#0d0f14; border:1px solid #2a303c; color:#e8eaed; border-radius:8px; padding:7px 10px; font-size:13px; width:100%; box-sizing:border-box; font-family:inherit; }
        .field { display:flex; flex-direction:column; gap:4px; font-size:11.5px; color:#8891a0; margin-bottom:10px; }
        .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .card { background:#12151c; border:1px solid #232833; border-radius:12px; padding:18px; margin-bottom:20px; }
        .btn { border:none; border-radius:8px; padding:9px 20px; font-size:13px; font-weight:600; cursor:pointer; }
        .btn-primary { background:#1f7a41; color:#d5ffe4; }
        .btn-danger { background:#7a1f1f; color:#ffd5d5; }
        .link { color:#7dd3fc; }
        .badge { display:inline-block; padding:2px 8px; border-radius:6px; font-size:10.5px; font-weight:600; margin-right:4px; }
        .badge-block { background:#3a1414; color:#ffbdbd; }
        .badge-warn { background:#3a2f0d; color:#ffe4b3; }
        .error-list { background:#331414; border:1px solid #7a1f1f; border-radius:8px; padding:12px 16px; font-size:12.5px; margin-bottom:16px; }
        .step { font-size:11px; text-transform:uppercase; letter-spacing:0.5px; color:#8891a0; margin-bottom:4px; }
        .required { color:#f87171; }
      `}</style>

      <p><a href="/saved" className="link">← Saved Opportunities</a></p>
      <h1 style={{ fontSize: 22 }}>Listing Studio</h1>
      <p style={{ color: "#8891a0", fontSize: 13 }}>{product?.display_title}</p>

      {hasBlock && (
        <div className="error-list">
          <strong>Blocked by compliance:</strong>
          <ul>{compliance.filter((c) => c.status === "block").map((c) => <li key={c.check_type}>{c.notes}</li>)}</ul>
        </div>
      )}

      {draft?.status === "published" ? (
        <div className="card">
          <div className="step">Published</div>
          <p>This listing is live on eBay.</p>
          {draft.ebay_item_id && (
            <a href={`https://www.ebay.com.au/itm/${draft.ebay_item_id}`} target="_blank" rel="noreferrer" className="link">
              View live listing →
            </a>
          )}
        </div>
      ) : (
        <>
          <div className="card">
            <div className="step">Step 1 — Draft details</div>
            {draft?.validation_errors && (draft.validation_errors as string[]).length > 0 && draft.status !== "validated" && (
              <div className="error-list">
                <strong>Not ready yet:</strong>
                <ul>{(draft.validation_errors as string[]).map((e, i) => <li key={i}>{e}</li>)}</ul>
              </div>
            )}
            <form action={`/api/listing-drafts/${params.id}/save`} method="post">
              <label className="field"><span>Title (max 80 chars) <span className="required">*</span></span>
                <input className="input" name="title" maxLength={80} defaultValue={draft?.title ?? product?.display_title ?? ""} required />
              </label>
              <label className="field"><span>Subtitle (optional)</span><input className="input" name="subtitle" defaultValue={draft?.subtitle ?? ""} /></label>
              <div className="grid2">
                <label className="field"><span>Category ID <span className="required">*</span></span><input className="input" name="category_id" defaultValue={categoryId} required /></label>
                <label className="field"><span>Category name</span><input className="input" name="category_name" defaultValue={draft?.category_name ?? product?.category_name ?? ""} /></label>
              </div>
              <div className="grid2">
                <label className="field"><span>Condition <span className="required">*</span></span>
                  <select className="input" name="condition" defaultValue={draft?.condition ?? "NEW"}>
                    <option value="NEW">New</option>
                    <option value="USED_EXCELLENT">Used — Excellent</option>
                    <option value="USED_GOOD">Used — Good</option>
                    <option value="USED_ACCEPTABLE">Used — Acceptable</option>
                    <option value="FOR_PARTS_OR_NOT_WORKING">For parts / not working</option>
                  </select>
                </label>
                <label className="field"><span>Condition description</span><input className="input" name="condition_description" defaultValue={draft?.condition_description ?? ""} /></label>
              </div>

              {aspects.length > 0 && (
                <>
                  <div className="step" style={{ marginTop: 16 }}>Item specifics (from eBay's category taxonomy)</div>
                  <div className="grid2">
                    {aspects.map((a) => (
                      <label className="field" key={a.name}>
                        <span>{a.name} {a.required && <span className="required">*</span>}</span>
                        <input className="input" name={`aspect__${a.name}`} defaultValue={currentSpecifics[a.name] ?? ""} />
                      </label>
                    ))}
                  </div>
                </>
              )}

              <label className="field" style={{ marginTop: 12 }}><span>Description <span className="required">*</span></span>
                <textarea className="input" name="description" rows={6} defaultValue={draft?.description ?? ""} required />
              </label>

              <div className="grid2">
                <label className="field"><span>Price (AUD) <span className="required">*</span></span><input className="input" type="number" step="0.01" name="price" defaultValue={draft?.price ?? ""} required /></label>
                <label className="field"><span>Quantity <span className="required">*</span></span><input className="input" type="number" name="quantity" defaultValue={draft?.quantity ?? supplierProduct?.available_stock ?? 1} required /></label>
              </div>
              <label className="field"><span><input type="checkbox" name="best_offer_enabled" defaultChecked={draft?.best_offer_enabled} /> Accept Best Offer</span></label>

              <div className="step" style={{ marginTop: 16 }}>Postage (from real package data — {supplierProduct?.weight_kg ? `${supplierProduct.weight_kg}kg, ${supplierProduct.package_length_cm}×${supplierProduct.package_width_cm}×${supplierProduct.package_height_cm}cm` : "no dimensions on file yet — add these on Saved Opportunities first"})</div>
              <div className="grid2">
                <label className="field"><span>Dispatch time (days)</span><input className="input" type="number" name="dispatch_time_days" defaultValue={draft?.dispatch_time_days ?? supplierProduct?.lead_time_days ?? ""} /></label>
                <label className="field"><span>Domestic postage service</span><input className="input" name="domestic_postage_service" defaultValue={draft?.domestic_postage_service ?? ""} placeholder="e.g. Australia Post Parcel Post" /></label>
              </div>
              <div className="grid2">
                <label className="field"><span>Domestic postage cost</span><input className="input" type="number" step="0.01" name="domestic_postage_cost" defaultValue={draft?.domestic_postage_cost ?? ""} /></label>
                <label className="field"><span><input type="checkbox" name="free_shipping" defaultChecked={draft?.free_shipping} /> Free shipping</span></label>
              </div>
              <label className="field"><span>Warranty details</span><input className="input" name="warranty_details" defaultValue={draft?.warranty_details ?? ""} /></label>
              <label className="field"><span>Promoted Listings rate % (optional)</span><input className="input" type="number" step="0.1" name="promoted_listings_pct" defaultValue={draft?.promoted_listings_pct ?? ""} /></label>

              <div className="step" style={{ marginTop: 16 }}>Images — real photos only, at least one required <span className="required">*</span></div>
              {[1, 2, 3, 4, 5].map((i) => (
                <div className="grid2" key={i}>
                  <label className="field"><span>Image {i} URL</span><input className="input" type="url" name={`image_url_${i}`} defaultValue={images[i - 1]?.url ?? ""} placeholder="https://..." /></label>
                  <label className="field"><span>Source</span>
                    <select className="input" name={`image_source_${i}`} defaultValue={images[i - 1]?.source ?? ""}>
                      <option value="">— select —</option>
                      <option value="my_photo">My own photo</option>
                      <option value="supplier_authorized">Supplier-authorized</option>
                      <option value="manufacturer_authorized">Manufacturer-authorized</option>
                      <option value="original_graphic">Original graphic (JDM Kingdom branded)</option>
                    </select>
                  </label>
                </div>
              ))}

              <button type="submit" className="btn btn-primary" style={{ marginTop: 12 }}>Save draft</button>
            </form>
          </div>

          {draft && (
            <div className="card">
              <div className="step">Step 2 — Validate</div>
              <p style={{ fontSize: 12.5, color: "#8891a0" }}>Checks required fields, real package dimensions, image sourcing, and every category-required item specific from eBay's own taxonomy.</p>
              <form action={`/api/listing-drafts/${params.id}/validate`} method="post">
                <button type="submit" className="btn btn-primary">Validate</button>
              </form>
              {draft.status === "validated" && <p style={{ color: "#4ade80", fontSize: 12.5, marginTop: 8 }}>✓ Validated</p>}
            </div>
          )}

          {draft && (draft.status === "validated" || draft.status === "ebay_draft_created") && (
            <div className="card">
              <div className="step">Step 3 — Create eBay draft (unpublished)</div>
              <p style={{ fontSize: 12.5, color: "#8891a0" }}>Creates the inventory item and offer on eBay. Saved as a draft in Seller Hub — not live.</p>
              <form action={`/api/listing-drafts/${params.id}/create-ebay-draft`} method="post">
                <button type="submit" className="btn btn-primary" disabled={draft.status !== "validated" && draft.status !== "ebay_draft_created"}>
                  Create eBay draft
                </button>
              </form>
              {draft.publish_error && <p style={{ color: "#f87171", fontSize: 12.5, marginTop: 8 }}>{draft.publish_error}</p>}
              {draft.status === "ebay_draft_created" && <p style={{ color: "#4ade80", fontSize: 12.5, marginTop: 8 }}>✓ eBay draft created (offer {draft.ebay_offer_id})</p>}
            </div>
          )}

          {draft?.status === "ebay_draft_created" && (
            <div className="card">
              <div className="step">Step 4 — Publish (goes live)</div>
              <div style={{ background: "#161a22", borderRadius: 8, padding: 14, fontSize: 12.5, marginBottom: 12 }}>
                <p><strong>{draft.title}</strong> {draft.subtitle}</p>
                <p>Price: ${Number(draft.price).toFixed(2)} AUD · Qty: {draft.quantity} · Condition: {draft.condition}</p>
                <p>Category: {draft.category_name ?? draft.category_id}</p>
                <p>Postage: {draft.free_shipping ? "Free shipping" : `${draft.domestic_postage_service} — $${draft.domestic_postage_cost}`}</p>
                <p>{images.length} image(s) attached</p>
              </div>
              <form action={`/api/listing-drafts/${params.id}/publish`} method="post">
                <label style={{ fontSize: 12.5, display: "block", marginBottom: 10 }}>
                  <input type="checkbox" name="confirm" value="yes" required /> I confirm the above is correct and want to publish this as a live eBay listing.
                </label>
                <button type="submit" className="btn btn-danger">Publish to eBay (live)</button>
              </form>
            </div>
          )}
        </>
      )}
    </main>
  );
}
