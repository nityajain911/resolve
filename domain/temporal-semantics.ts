/**
 * Temporal semantics as a first-class domain concept. Every consumer (policy,
 * promise creation, payment plans, evaluation scoring) goes through `temporalKind`,
 * so a range or a lower bound is never silently coerced into an exact date.
 *
 *   EXACT       — a single day (EXACT_DATE or RELATIVE_DATE resolved with HIGH confidence)
 *   LOWER_BOUND — "after X" (AFTER_DATE); no upper bound
 *   RANGE       — a window (DATE_RANGE); may carry an explicit upper bound ("by the weekend")
 *   AMBIGUOUS   — cannot be resolved safely (AMBIGUOUS type or NEEDS_REVIEW band)
 */
import type { TemporalExpression } from "./types";

export type TemporalKind = "EXACT" | "LOWER_BOUND" | "RANGE" | "AMBIGUOUS";

export function temporalKind(t: Pick<TemporalExpression, "type" | "confidenceBand" | "normalizedDate">): TemporalKind {
  if (t.type === "AMBIGUOUS" || t.confidenceBand === "NEEDS_REVIEW") return "AMBIGUOUS";
  if (t.type === "AFTER_DATE") return "LOWER_BOUND";
  if (t.type === "DATE_RANGE") return "RANGE";
  return t.normalizedDate ? "EXACT" : "AMBIGUOUS";
}

/** Kind used for SCORING: type only (band is scored separately). EXACT_DATE and RELATIVE_DATE are both EXACT. */
export function scoringKind(type: TemporalExpression["type"]): TemporalKind {
  if (type === "AMBIGUOUS") return "AMBIGUOUS";
  if (type === "AFTER_DATE") return "LOWER_BOUND";
  if (type === "DATE_RANGE") return "RANGE";
  return "EXACT";
}

/**
 * A date a PROMISE can be held to. Only EXACT (a day) or a RANGE with an explicit
 * upper bound (a deadline). LOWER_BOUND and AMBIGUOUS never produce a promise date.
 */
export function promiseDeadlineDate(t: TemporalExpression): { date: string; precision: "DAY" | "DEADLINE" } | undefined {
  const k = temporalKind(t);
  if (k === "EXACT") return { date: t.normalizedDate!, precision: "DAY" };
  if (k === "RANGE" && t.upperBound) return { date: t.upperBound, precision: "DEADLINE" };
  return undefined;
}
