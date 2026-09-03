import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return true;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

const FORMULA_VERSION = 1;

type LineItem = {
  sku?: string;
  title?: string;
  quantity?: number;
  lineItemCost?: { value?: string };
  total?: { value?: string };
};

// The only fully verified revenue source in this app: JDM Kingdom's own
// completed eBay orders. Real quantities, real prices, real dates — no
// estimation. Written into the same research_products/product_metrics
// schema as everything else so it's comparable, but tagged
// provider=EBAY_OWN_ORDERS, confidence=verified.
export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  const { data: run } = await db
    .from("research_runs")
    .insert({ run_type: "store_sales_metrics" })
    .select()
    .single();

  try {
    const { data: orders, error: ordersError } = await db
      .from("store_orders")
      .select("ebay_order_id, order_total, currency, placed_at, line_items");
    if (ordersError) throw new Error(ordersError.message);

    const { data: listings } = await db.from("store_listings").select("sku, ebay_item_id, title, image_url, listing_url, category_id, category_name");
    const listingBySku = new Map((listings ?? []).filter((l) => l.sku).map((l) => [l.sku as string, l]));

    type Agg = { sku: string; title: string; units: number; revenue: number; firstSeen: Date; lastSeen: Date };
    const bySku = new Map<string, Agg>();

    for (const order of orders ?? []) {
      const placedAt = order.placed_at ? new Date(order.placed_at) : null;
      const lineItems: LineItem[] = Array.isArray(order.line_items) ? order.line_items : [];
      for (const li of lineItems) {
        const sku = li.sku || `untracked:${(li.title ?? "unknown").slice(0, 40)}`;
        const qty = Number(li.quantity) || 0;
        const lineRevenue = Number(li.total?.value ?? li.lineItemCost?.value ?? 0) || 0;
        const existing = bySku.get(sku);
        const when = placedAt ?? new Date();
        if (existing) {
          existing.units += qty;
          existing.revenue += lineRevenue;
          if (when < existing.firstSeen) existing.firstSeen = when;
          if (when > existing.lastSeen) existing.lastSeen = when;
        } else {
          bySku.set(sku, { sku, title: li.title ?? sku, units: qty, revenue: lineRevenue, firstSeen: when, lastSeen: when });
        }
      }
    }

    let productsFound = 0;
    for (const agg of bySku.values()) {
      const listing = listingBySku.get(agg.sku);
      const periodDays = Math.max(1, Math.round((agg.lastSeen.getTime() - agg.firstSeen.getTime()) / 86_400_000) || 1);
      const monthlyUnits = (agg.units / periodDays) * 30;
      const monthlyRevenue = (agg.revenue / periodDays) * 30;
      const avgPrice = agg.units > 0 ? agg.revenue / agg.units : null;

      const { data: product, error: upsertError } = await db
        .from("research_products")
        .upsert(
          {
            source_sku: agg.sku,
            title_normalized: (listing?.title ?? agg.title).toLowerCase(),
            display_title: listing?.title ?? agg.title,
            category_id: listing?.category_id ?? null,
            category_name: listing?.category_name ?? null,
            image_url: listing?.image_url ?? null,
            listing_url: listing?.listing_url ?? null,
            cluster_confidence: 1,
            cluster_method: "own_sku_exact",
            updated_at: new Date().toISOString(),
          },
          { onConflict: "source_sku" }
        )
        .select()
        .single();
      if (upsertError || !product) continue;

      await db.from("product_evidence").insert({
        research_product_id: product.id,
        provider: "EBAY_OWN_ORDERS",
        source_type: "own_order_line_item",
        external_id: listing?.ebay_item_id ?? null,
        price: avgPrice,
        currency: "AUD",
        quantity: agg.units,
        listing_url: listing?.listing_url ?? null,
        image_url: listing?.image_url ?? null,
        observed_at: agg.lastSeen.toISOString(),
        raw: { sku: agg.sku, units: agg.units, revenue: agg.revenue, period_days: periodDays },
      });

      await db.from("product_metrics").insert({
        research_product_id: product.id,
        provider: "EBAY_OWN_ORDERS",
        metric_type: "verified_sales",
        period_days: periodDays,
        monthly_units: Math.round(monthlyUnits * 100) / 100,
        monthly_revenue: Math.round(monthlyRevenue * 100) / 100,
        avg_price: avgPrice,
        evidence_count: 1,
        confidence: "verified",
        formula_version: FORMULA_VERSION,
        formula_notes: `Real completed-order data. monthly_units = units observed over ${periodDays}-day observed span, normalized to 30 days. No estimation.`,
      });
      productsFound += 1;
    }

    await db
      .from("research_runs")
      .update({ status: "completed", completed_at: new Date().toISOString(), products_scanned: bySku.size, products_found: productsFound })
      .eq("id", run?.id);

    return NextResponse.json({ ok: true, skusProcessed: bySku.size, productsWritten: productsFound });
  } catch (err) {
    await db.from("research_runs").update({ status: "failed", completed_at: new Date().toISOString(), error: String(err) }).eq("id", run?.id);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
