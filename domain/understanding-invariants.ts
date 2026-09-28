/**
 * Financial consistency invariants. Deterministic checks applied to EVERY
 * CaseUnderstanding (demo or live model) before it can drive a transition.
 * A violation never becomes an action: the case goes to NEEDS_REVIEW with a
 * specific reason code.
 */
import { formatINR } from "./money";
import type { CaseUnderstanding } from "./types";

export type InvariantCode =
  | "AMOUNT_IMPLAUSIBLE"
  | "AMOUNT_EXCEEDS_OUTSTANDING"
  | "IMMEDIATE_COVERS_OUTSTANDING"
  | "SPLIT_EXCEEDS_OUTSTANDING"
  | "NEGATIVE_REMAINDER"
  | "DISPUTED_EXCEEDS_OUTSTANDING";

export interface InvariantIssue {
  code: InvariantCode;
  message: string;
}

const TOLERANCE = 1; // ₹1 rounding
/** Anything above this multiple of the invoice amount is almost certainly not money for this invoice. */
export const IMPLAUSIBLE_MULTIPLE = 3;

export function validateUnderstanding(
  u: CaseUnderstanding,
  invoice: { amount: number; outstandingAmount: number },
): InvariantIssue[] {
  const issues: InvariantIssue[] = [];
  const out = invoice.outstandingAmount;
  const amounts = u.extractedAmounts;

  for (const a of amounts) {
    if (a.amount > invoice.amount * IMPLAUSIBLE_MULTIPLE) {
      issues.push({
        code: "AMOUNT_IMPLAUSIBLE",
        message: `Extracted ${formatINR(a.amount)} ("${a.rawText}") is implausible for a ${formatINR(invoice.amount)} invoice.`,
      });
    }
  }
  if (issues.length) return issues;

  const disputed = amounts.filter((a) => a.role === "DISPUTED");
  for (const d of disputed) {
    if (d.amount > out + TOLERANCE) {
      issues.push({ code: "DISPUTED_EXCEEDS_OUTSTANDING", message: `Disputed ${formatINR(d.amount)} exceeds the ${formatINR(out)} outstanding.` });
    }
  }
  for (const a of amounts) {
    if (a.role === "DISPUTED" || a.role === "PAID") continue;
    if (a.amount > out + TOLERANCE) {
      issues.push({
        code: "AMOUNT_EXCEEDS_OUTSTANDING",
        message: `Buyer mentions ${formatINR(a.amount)} but only ${formatINR(out)} is outstanding.`,
      });
    }
  }
  const imm = amounts.find((a) => a.role === "IMMEDIATE");
  const rem = amounts.find((a) => a.role === "REMAINDER");
  if (u.proposedState === "CASH_CONSTRAINED" && imm && imm.amount >= out - TOLERANCE && imm.amount <= out + TOLERANCE) {
    issues.push({
      code: "IMMEDIATE_COVERS_OUTSTANDING",
      message: `The "now" amount ${formatINR(imm.amount)} already covers the full balance — this is not a split payment.`,
    });
  }
  if (imm && rem) {
    if (rem.amount < 0) issues.push({ code: "NEGATIVE_REMAINDER", message: `Remainder ${formatINR(rem.amount)} is negative.` });
    else if (imm.amount + rem.amount > out + TOLERANCE) {
      issues.push({
        code: "SPLIT_EXCEEDS_OUTSTANDING",
        message: `${formatINR(imm.amount)} now + ${formatINR(rem.amount)} later exceeds the ${formatINR(out)} outstanding.`,
      });
    }
  }
  const undisputed = amounts.find((a) => a.role === "UNDISPUTED");
  if (disputed[0] && undisputed && disputed[0].amount + undisputed.amount > out + TOLERANCE) {
    issues.push({
      code: "SPLIT_EXCEEDS_OUTSTANDING",
      message: `Disputed ${formatINR(disputed[0].amount)} + undisputed ${formatINR(undisputed.amount)} exceeds the ${formatINR(out)} outstanding.`,
    });
  }
  // de-duplicate by code+message
  return issues.filter((i, idx) => issues.findIndex((j) => j.code === i.code && j.message === i.message) === idx);
}
