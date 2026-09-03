// Profit calculation — a pure function over explicit inputs. Nothing here
// is invented: every number that goes in is either the seller's own entry
// or an explicitly-labeled editable assumption. formula_version lets a
// future change to this math be distinguished from old results.

export const PROFIT_FORMULA_VERSION = 1;

export type ProfitInputs = {
  productCost: number;
  freightToAuPerUnit: number;
  importDutyPct: number;
  expectedSalePrice: number;
  expectedUnitsPerMonth: number;
  domesticPostageCost: number;
  ebayFinalValueFeePct: number;
  promotedListingsPct: number;
  paymentProcessingPct: number;
  returnAllowancePct: number;
  minOrderQty: number | null;
};

export type ProfitResult = {
  landedCostPerUnit: number;
  netProfitPerUnit: number;
  netMarginPct: number;
  breakEvenPrice: number;
  expectedMonthlyProfit: number;
  cashRequiredInitialStock: number | null;
};

export function calculateProfit(inputs: ProfitInputs): ProfitResult {
  const {
    productCost,
    freightToAuPerUnit,
    importDutyPct,
    expectedSalePrice,
    expectedUnitsPerMonth,
    domesticPostageCost,
    ebayFinalValueFeePct,
    promotedListingsPct,
    paymentProcessingPct,
    returnAllowancePct,
    minOrderQty,
  } = inputs;

  const landedCostPerUnit = productCost + freightToAuPerUnit + productCost * (importDutyPct / 100);

  const totalFeePct = (ebayFinalValueFeePct + promotedListingsPct + paymentProcessingPct + returnAllowancePct) / 100;
  const feeCostAtSalePrice = expectedSalePrice * totalFeePct;

  const netProfitPerUnit = expectedSalePrice - landedCostPerUnit - domesticPostageCost - feeCostAtSalePrice;
  const netMarginPct = expectedSalePrice > 0 ? (netProfitPerUnit / expectedSalePrice) * 100 : 0;

  const breakEvenPrice = totalFeePct < 1 ? (landedCostPerUnit + domesticPostageCost) / (1 - totalFeePct) : Infinity;

  const expectedMonthlyProfit = netProfitPerUnit * expectedUnitsPerMonth;
  const cashRequiredInitialStock = minOrderQty ? landedCostPerUnit * minOrderQty : null;

  return {
    landedCostPerUnit: round2(landedCostPerUnit),
    netProfitPerUnit: round2(netProfitPerUnit),
    netMarginPct: round2(netMarginPct),
    breakEvenPrice: Number.isFinite(breakEvenPrice) ? round2(breakEvenPrice) : NaN,
    expectedMonthlyProfit: round2(expectedMonthlyProfit),
    cashRequiredInitialStock: cashRequiredInitialStock !== null ? round2(cashRequiredInitialStock) : null,
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
