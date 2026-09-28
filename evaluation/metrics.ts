/**
 * Classifier evaluation metrics. Pure functions — no I/O.
 * Never reported as a single "AI accuracy" number: state accuracy, per-state
 * precision/recall/F1, risk-weighted errors, temporal exact-match (per category)
 * and ambiguous-expression routing are all reported separately.
 */
import type { CaseClassifier, ClassifierInput } from "@/ai/classifier";
import type { CaseUnderstanding, InvoiceState, TemporalExpression } from "@/domain/types";
import { errorRisk, RISK_WEIGHT, type RiskTier } from "./cost-matrix";
import type { ExpectedTemporal, HeldoutCase, TemporalCategory } from "./types";

export const DEFAULT_OUTSTANDING = 200_000;

export interface CasePrediction {
  caseId: string;
  expectedState: InvoiceState;
  predictedState: InvoiceState; // effective routing state (band-adjusted)
  rawProposedState: InvoiceState;
  confidenceBand: CaseUnderstanding["confidenceBand"];
  stateCorrect: boolean;
  amountsCorrect: boolean;
  temporalCorrect: boolean | null; // null = no temporal expectation
  temporalCategory?: TemporalCategory;
  expectsAmbiguity: boolean;
  risk: { tier: RiskTier; why: string } | null;
  explanation: string;
}

export function toClassifierInput(c: HeldoutCase): ClassifierInput {
  return {
    primaryEvidence: { id: `${c.id}-msg`, type: "BUYER_MESSAGE", text: c.message, timestamp: c.messageTimestamp },
    supportingEvidence: (c.optionalSupportingEvidence ?? []).map((e, i) => ({
      id: `${c.id}-sup-${i}`,
      type: e.type,
      text: e.text,
      timestamp: e.timestamp ?? c.messageTimestamp,
    })),
    invoice: {
      invoiceNumber: `EVAL-${c.id}`,
      amount: c.invoiceOutstanding ?? DEFAULT_OUTSTANDING,
      outstandingAmount: c.invoiceOutstanding ?? DEFAULT_OUTSTANDING,
      dueAt: c.messageTimestamp,
    },
    buyerName: "Evaluation buyer",
  };
}

/** The state the engine would route to: NEEDS_REVIEW band always routes to review. */
export function effectiveState(u: CaseUnderstanding): InvoiceState {
  return u.confidenceBand === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : u.proposedState;
}

export function temporalMatches(expected: ExpectedTemporal, predicted: TemporalExpression[]): boolean {
  return predicted.some(
    (p) =>
      p.type === expected.type &&
      (expected.normalizedDate === undefined || p.normalizedDate === expected.normalizedDate) &&
      (expected.lowerBound === undefined || p.lowerBound === expected.lowerBound) &&
      (expected.upperBound === undefined || p.upperBound === expected.upperBound) &&
      (expected.confidenceBand === undefined || p.confidenceBand === expected.confidenceBand),
  );
}

function amountsMatch(expected: number[], predicted: CaseUnderstanding["extractedAmounts"]): boolean {
  const e = [...expected].sort((a, b) => a - b);
  const p = Array.from(new Set(predicted.map((a) => a.amount))).sort((a, b) => a - b);
  return e.length === p.length && e.every((v, i) => v === p[i]);
}

export function scoreCase(c: HeldoutCase, u: CaseUnderstanding): CasePrediction {
  const predicted = effectiveState(u);
  const expectsAmbiguity =
    c.expectedTemporalExpression?.type === "AMBIGUOUS" || c.expectedTemporalExpression?.confidenceBand === "NEEDS_REVIEW";
  return {
    caseId: c.id,
    expectedState: c.expectedState,
    predictedState: predicted,
    rawProposedState: u.proposedState,
    confidenceBand: u.confidenceBand,
    stateCorrect: predicted === c.expectedState,
    amountsCorrect: amountsMatch(c.expectedExtractedAmounts, u.extractedAmounts),
    temporalCorrect: c.expectedTemporalExpression ? temporalMatches(c.expectedTemporalExpression, u.temporalExpressions) : null,
    temporalCategory: c.temporalCategory,
    expectsAmbiguity,
    risk: errorRisk(c.expectedState, predicted),
    explanation: u.conciseExplanation,
  };
}

export interface StateMetric {
  state: InvoiceState;
  support: number;
  predicted: number;
  precision: number | null;
  recall: number | null;
  f1: number | null;
}

export interface ClassifierMetrics {
  n: number;
  stateAccuracy: number;
  perState: StateMetric[];
  confusion: Record<string, Record<string, number>>;
  riskWeightedErrors: number;
  errorsByTier: Record<RiskTier, number>;
  amountExactMatch: { correct: number; total: number };
  temporal: {
    correct: number;
    total: number;
    byCategory: Record<string, { correct: number; total: number }>;
  };
  ambiguousHandling: { routedToReview: number; total: number };
}

export function computeMetrics(preds: CasePrediction[]): ClassifierMetrics {
  const states = Array.from(new Set(preds.flatMap((p) => [p.expectedState, p.predictedState]))).sort();
  const confusion: ClassifierMetrics["confusion"] = {};
  for (const s of states) confusion[s] = Object.fromEntries(states.map((t) => [t, 0]));
  for (const p of preds) confusion[p.expectedState][p.predictedState] += 1;

  const perState: StateMetric[] = states.map((s) => {
    const tp = preds.filter((p) => p.expectedState === s && p.predictedState === s).length;
    const support = preds.filter((p) => p.expectedState === s).length;
    const predicted = preds.filter((p) => p.predictedState === s).length;
    const precision = predicted ? tp / predicted : null;
    const recall = support ? tp / support : null;
    const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : precision === null || recall === null ? null : 0;
    return { state: s, support, predicted, precision, recall, f1 };
  });

  const errorsByTier: Record<RiskTier, number> = { HIGH: 0, MODERATE: 0, LOW: 0 };
  for (const p of preds) if (p.risk) errorsByTier[p.risk.tier] += 1;

  const withTemporal = preds.filter((p) => p.temporalCorrect !== null);
  const byCategory: Record<string, { correct: number; total: number }> = {};
  for (const p of withTemporal) {
    const k = p.temporalCategory ?? "UNCATEGORISED";
    byCategory[k] ??= { correct: 0, total: 0 };
    byCategory[k].total += 1;
    if (p.temporalCorrect) byCategory[k].correct += 1;
  }
  const ambiguous = preds.filter((p) => p.expectsAmbiguity);

  return {
    n: preds.length,
    stateAccuracy: preds.length ? preds.filter((p) => p.stateCorrect).length / preds.length : 0,
    perState,
    confusion,
    riskWeightedErrors: (Object.keys(errorsByTier) as RiskTier[]).reduce((s, t) => s + errorsByTier[t] * RISK_WEIGHT[t], 0),
    errorsByTier,
    amountExactMatch: { correct: preds.filter((p) => p.amountsCorrect).length, total: preds.length },
    temporal: { correct: withTemporal.filter((p) => p.temporalCorrect).length, total: withTemporal.length, byCategory },
    ambiguousHandling: { routedToReview: ambiguous.filter((p) => p.predictedState === "NEEDS_REVIEW").length, total: ambiguous.length },
  };
}

export async function evaluateClassifier(cases: HeldoutCase[], classifier: CaseClassifier) {
  const predictions: CasePrediction[] = [];
  for (const c of cases) predictions.push(scoreCase(c, await classifier.classify(toClassifierInput(c))));
  return { predictions, metrics: computeMetrics(predictions) };
}
