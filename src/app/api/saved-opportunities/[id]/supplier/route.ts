import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { runComplianceChecks } from "@/lib/compliance";
import { calculateProfit, PROFIT_FORMULA_VERSION } from "@/lib/profit";

export const dynamic = "force-dynamic";

function num(form: FormData, key: string): number {
  const v = form.get(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function numOrNull(form: FormData, key: string): number | null {
  const v = form.get(key);
  if (v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Saves supplier + landed-cost data for a saved opportunity, then
// automatically (a) runs the rules-based compliance checklist and (b)
// computes conservative/expected/optimistic profit scenarios from it.
// Nothing here invents cost data — every field comes from the form.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const db = supabaseAdmin();
  const form = await req.formData();

  const { data: opp } = await db
    .from("saved_opportunities")
    .select("id, research_product_id, research_products(display_title)")
    .eq("id", params.id)
    .single();
  if (!opp) return NextResponse.json({ error: "opportunity not found" }, { status: 404 });

  // Supplier: find-or-create by name.
  const supplierName = String(form.get("supplier_name") ?? "").trim();
  let supplierId: string | null = null;
  if (supplierName) {
    const { data: existing } = await db.from("suppliers").select("id").eq("name", supplierName).maybeSingle();
    if (existing) {
      supplierId = existing.id;
    } else {
      const { data: created } = await db
        .from("suppliers")
        .insert({ name: supplierName, url: form.get("supplier_url") || null, country: form.get("supplier_country") || null })
        .select()
        .single();
      supplierId = created?.id ?? null;
    }
  }

  const productCost = num(form, "product_cost");
  const freightToAu = num(form, "freight_to_au");
  const importDutyPct = num(form, "import_duty_pct");
  const minOrderQty = numOrNull(form, "min_order_qty");

  const { data: supplierProduct, error: spError } = await db
    .from("supplier_products")
    .upsert(
      {
        saved_opportunity_id: params.id,
        supplier_id: supplierId,
        supplier_sku: form.get("supplier_sku") || null,
        product_cost: productCost,
        freight_to_au: freightToAu,
        import_duty_pct: importDutyPct,
        min_order_qty: minOrderQty,
        available_stock: numOrNull(form, "available_stock"),
        lead_time_days: numOrNull(form, "lead_time_days"),
        package_length_cm: numOrNull(form, "package_length_cm"),
        package_width_cm: numOrNull(form, "package_width_cm"),
        package_height_cm: numOrNull(form, "package_height_cm"),
        weight_kg: numOrNull(form, "weight_kg"),
        gst_treatment: form.get("gst_treatment") || null,
        notes: form.get("notes") || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "saved_opportunity_id" }
    )
    .select()
    .single();
  if (spError || !supplierProduct) {
    return NextResponse.json({ error: spError?.message ?? "failed to save supplier product" }, { status: 500 });
  }

  // Compliance: re-run fresh each time cost data changes (title doesn't
  // change here, but keep the checklist current with the review).
  const title = (opp as unknown as { research_products: { display_title: string } }).research_products?.display_title ?? "";
  await db.from("compliance_checks").delete().eq("saved_opportunity_id", params.id);
  const complianceResults = runComplianceChecks(title, true);
  await db
    .from("compliance_checks")
    .insert(complianceResults.map((r) => ({ saved_opportunity_id: params.id, ...r })));

  // Profit scenarios: shared fee/postage assumptions, per-scenario price + volume.
  const domesticPostageCost = num(form, "domestic_postage_cost");
  const ebayFeePct = num(form, "ebay_final_value_fee_pct");
  const promotedPct = num(form, "promoted_listings_pct");
  const paymentPct = num(form, "payment_processing_pct");
  const returnPct = num(form, "return_allowance_pct");

  await db.from("profit_calculations").delete().eq("supplier_product_id", supplierProduct.id);

  const scenarios: { scenario: "conservative" | "expected" | "optimistic"; priceKey: string; unitsKey: string }[] = [
    { scenario: "conservative", priceKey: "conservative_price", unitsKey: "conservative_units" },
    { scenario: "expected", priceKey: "expected_price", unitsKey: "expected_units" },
    { scenario: "optimistic", priceKey: "optimistic_price", unitsKey: "optimistic_units" },
  ];

  for (const s of scenarios) {
    const expectedSalePrice = num(form, s.priceKey);
    const expectedUnitsPerMonth = num(form, s.unitsKey);
    if (expectedSalePrice <= 0) continue;

    const result = calculateProfit({
      productCost,
      freightToAuPerUnit: freightToAu,
      importDutyPct,
      expectedSalePrice,
      expectedUnitsPerMonth,
      domesticPostageCost,
      ebayFinalValueFeePct: ebayFeePct,
      promotedListingsPct: promotedPct,
      paymentProcessingPct: paymentPct,
      returnAllowancePct: returnPct,
      minOrderQty,
    });

    await db.from("profit_calculations").insert({
      supplier_product_id: supplierProduct.id,
      scenario: s.scenario,
      expected_sale_price: expectedSalePrice,
      expected_units_per_month: expectedUnitsPerMonth,
      domestic_postage_cost: domesticPostageCost,
      ebay_final_value_fee_pct: ebayFeePct,
      promoted_listings_pct: promotedPct,
      payment_processing_pct: paymentPct,
      return_allowance_pct: returnPct,
      landed_cost_per_unit: result.landedCostPerUnit,
      net_profit_per_unit: result.netProfitPerUnit,
      net_margin_pct: result.netMarginPct,
      break_even_price: result.breakEvenPrice,
      expected_monthly_profit: result.expectedMonthlyProfit,
      cash_required_initial_stock: result.cashRequiredInitialStock,
      formula_version: PROFIT_FORMULA_VERSION,
    });
  }

  return NextResponse.redirect(new URL("/saved", req.url));
}
