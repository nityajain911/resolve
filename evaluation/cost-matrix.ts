/**
 * Asymmetric error costs for classifier evaluation. Unitless risk weights —
 * deliberately NOT rupee values, which the prototype cannot honestly estimate.
 *
 *   HIGH (3)     → the merchant may wrongly chase or pressure the buyer
 *   MODERATE (2) → wrong workflow / delayed follow-up / overconfidence
 *   LOW (1)      → only costs merchant review time
 */
import type { InvoiceState } from "@/domain/types";

export type RiskTier = "HIGH" | "MODERATE" | "LOW";
export const RISK_WEIGHT: Record<RiskTier, number> = { HIGH: 3, MODERATE: 2, LOW: 1 };

export function errorRisk(expected: InvoiceState, predicted: InvoiceState): { tier: RiskTier; why: string } | null {
  if (expected === predicted) return null;
  if (predicted === "FOLLOW_UP_ACTIVE") {
    return { tier: "HIGH", why: `A ${expected} case would be chased as if nothing were blocking it` };
  }
  if (expected === "COMMERCIAL_DISPUTE" && predicted !== "NEEDS_REVIEW") {
    return { tier: "HIGH", why: "A disputed invoice would be handled as a payment matter" };
  }
  if (predicted === "NEEDS_REVIEW") {
    return { tier: "LOW", why: "Only costs merchant review time" };
  }
  if (expected === "FOLLOW_UP_ACTIVE") {
    return { tier: "MODERATE", why: "Follow-up paused without a real blocker" };
  }
  if (expected === "NEEDS_REVIEW") {
    return { tier: "MODERATE", why: "Ambiguous case acted on with false confidence" };
  }
  return { tier: "MODERATE", why: "Wrong blocker workflow" };
}

/** Matrix rows for documentation / UI. */
export const COST_MATRIX_EXAMPLES: { expected: InvoiceState; predicted: InvoiceState }[] = [
  { expected: "COMMERCIAL_DISPUTE", predicted: "FOLLOW_UP_ACTIVE" },
  { expected: "PAPERWORK_BLOCKED", predicted: "FOLLOW_UP_ACTIVE" },
  { expected: "COMMERCIAL_DISPUTE", predicted: "CASH_CONSTRAINED" },
  { expected: "FOLLOW_UP_ACTIVE", predicted: "PAPERWORK_BLOCKED" },
  { expected: "NEEDS_REVIEW", predicted: "PROMISE_TO_PAY" },
  { expected: "FOLLOW_UP_ACTIVE", predicted: "NEEDS_REVIEW" },
];
