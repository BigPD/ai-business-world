// Rules-based compliance/risk checklist. This is NOT a legal determination
// — it's a checklist that surfaces known risk categories from the product
// title/keyword for human review before anything is listed. Never silently
// "pass" a product into Ready to List without a human seeing these flags.

export type ComplianceResult = { check_type: string; status: "pass" | "warn" | "block"; notes: string };

const DANGEROUS_GOODS_TERMS = ["battery", "lithium", "nitrous", " nos ", "airbag", "gas strut", "pyrotechnic"];
const ELECTRICAL_TERMS = ["ecu", "wiring", "ignition coil", "led headlight", "led taillight", "hid kit", "xenon"];
const SAFETY_CRITICAL_TERMS = ["brake", "suspension", "steering", "seatbelt", "seat belt", "airbag", "wheel bearing"];
const REPLICA_RISK_TERMS = ["replica", "inspired by", "style", "fake", "copy of"];
const KNOWN_VERO_SENSITIVE_BRANDS = ["nismo", "mugen", "sti", "amg", "brabus", "trd", "ralliart"];

function contains(haystack: string, terms: string[]): string[] {
  const lower = haystack.toLowerCase();
  return terms.filter((t) => lower.includes(t));
}

export function runComplianceChecks(title: string, sourcedFromSupplier: boolean): ComplianceResult[] {
  const results: ComplianceResult[] = [];

  const veroHit = contains(title, KNOWN_VERO_SENSITIVE_BRANDS);
  const replicaHit = contains(title, REPLICA_RISK_TERMS);
  if (veroHit.length && (replicaHit.length || !sourcedFromSupplier)) {
    results.push({
      check_type: "trademark_vero_risk",
      status: "block",
      notes: `Title references a brand eBay actively polices for VeRO (${veroHit.join(", ")})${replicaHit.length ? " and replica-style wording" : ""}. Do not list unless you have genuine, verifiable sourcing for this exact branded item — confirm supplier authenticity documentation first.`,
    });
  } else if (veroHit.length) {
    results.push({
      check_type: "trademark_vero_risk",
      status: "warn",
      notes: `Title references a brand (${veroHit.join(", ")}) with a history of eBay VeRO takedowns. Only list if genuinely sourced — keep supplier proof on file.`,
    });
  } else {
    results.push({ check_type: "trademark_vero_risk", status: "pass", notes: "No known VeRO-sensitive brand terms detected in the title." });
  }

  const dangerousHit = contains(title, DANGEROUS_GOODS_TERMS);
  if (dangerousHit.length) {
    results.push({
      check_type: "dangerous_goods",
      status: "warn",
      notes: `Possible dangerous goods item (${dangerousHit.join(", ")}). Confirm correct eBay hazmat/dangerous-goods listing fields and compliant shipping method before publishing.`,
    });
  } else {
    results.push({ check_type: "dangerous_goods", status: "pass", notes: "No dangerous-goods terms detected." });
  }

  const electricalHit = contains(title, ELECTRICAL_TERMS);
  if (electricalHit.length) {
    results.push({
      check_type: "electrical_compliance",
      status: "warn",
      notes: `Electrical/lighting item (${electricalHit.join(", ")}) may require ADR/ACMA compliance for Australian road use. Confirm compliance status before listing as road-legal.`,
    });
  } else {
    results.push({ check_type: "electrical_compliance", status: "pass", notes: "No electrical-compliance-triggering terms detected." });
  }

  const safetyHit = contains(title, SAFETY_CRITICAL_TERMS);
  if (safetyHit.length) {
    results.push({
      check_type: "safety_critical_part",
      status: "warn",
      notes: `Safety-critical part (${safetyHit.join(", ")}). Fitment/compatibility must be exact — never guess vehicle compatibility. Consider a fitment disclaimer in the description.`,
    });
  } else {
    results.push({ check_type: "safety_critical_part", status: "pass", notes: "Not flagged as a safety-critical part category." });
  }

  results.push({
    check_type: "image_rights",
    status: "warn",
    notes: "Standing reminder: do not reuse competitor or manufacturer images without permission. Use supplier-authorized, manufacturer-authorized, or your own photos only — enforced in the image manager.",
  });

  return results;
}

export function worstStatus(results: ComplianceResult[]): "pass" | "warn" | "block" {
  if (results.some((r) => r.status === "block")) return "block";
  if (results.some((r) => r.status === "warn")) return "warn";
  return "pass";
}
