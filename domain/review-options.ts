/**
 * Review options for a NEEDS_REVIEW case, derived from that case's own candidates
 * and evidence. Never a fixed button set: a "we already paid" review offers payment
 * confirmation, an "after the 15th" review offers promise / cash-plan choices, and
 * a "PO mismatch" review offers paperwork / dispute.
 */
import { formatINR } from "./money";
import { addDays } from "./time";
import type { InvoiceCase, InvoiceState, ResolutionAction, WorldState } from "./types";

export type ReviewOption =
  | { id: string; kind: "CONFIRM_MATCH"; label: string; description: string; actionId: string }
  | { id: string; kind: "REJECT_MATCH"; label: string; description: string; actionId: string }
  | { id: string; kind: "RECORD_PAYMENT"; label: string; description: string; amount: number }
  | { id: string; kind: "CLASSIFY"; label: string; description: string; state: InvoiceState; requiresDate?: boolean; defaultDate?: string };

const CLASSIFY_COPY: Partial<Record<InvoiceState, { label: string; description: string }>> = {
  PAPERWORK_BLOCKED: { label: "Paperwork issue", description: "Route to Accounts and draft a correction (approval required)." },
  COMMERCIAL_DISPUTE: { label: "Commercial dispute", description: "Pause collections and route to Sales." },
  CASH_CONSTRAINED: { label: "Cash constraint — set up a plan", description: "Propose a part-payment plan; policy checks amounts and dates." },
  PROMISE_TO_PAY: { label: "Promise to pay", description: "Wait until a date you confirm; a timer resumes follow-up if unpaid." },
  FOLLOW_UP_ACTIVE: { label: "No blocker — resume follow-up", description: "Hand back to the Receivables Agent." },
};

export const ALL_CLASSIFIABLE: InvoiceState[] = ["PAPERWORK_BLOCKED", "COMMERCIAL_DISPUTE", "CASH_CONSTRAINED", "PROMISE_TO_PAY", "FOLLOW_UP_ACTIVE"];

function defaultPromiseDate(c: InvoiceCase): string | undefined {
  for (const t of c.understanding?.temporalExpressions ?? []) {
    if (t.normalizedDate) return t.normalizedDate;
    if (t.upperBound) return t.upperBound;
    if (t.type === "AFTER_DATE" && t.lowerBound) return addDays(t.lowerBound, 1);
    if (t.lowerBound) return t.lowerBound;
  }
  return undefined;
}

export function reviewOptions(w: WorldState, c: InvoiceCase): { primary: ReviewOption[]; other: ReviewOption[] } {
  const primary: ReviewOption[] = [];
  const candidates = c.reviewCandidates ?? [];
  const openMatch = Object.values(w.actions).find(
    (a: ResolutionAction) => a.invoiceId === c.id && a.type === "MATCH_PAYMENT" && ["PROPOSED", "REVIEW_REQUIRED"].includes(a.status),
  );

  if (openMatch) {
    primary.push({ id: "confirm-match", kind: "CONFIRM_MATCH", label: "Credit pays this invoice — reconcile", description: "Marks the bank credit as this invoice's payment.", actionId: openMatch.id });
    primary.push({ id: "reject-match", kind: "REJECT_MATCH", label: "Different payment — resume follow-up", description: "Records that the credit belongs elsewhere.", actionId: openMatch.id });
  } else if (candidates.includes("PAID_UNMATCHED")) {
    primary.push({
      id: "record-payment",
      kind: "RECORD_PAYMENT",
      label: "Payment confirmed in our ledger",
      description: `Record ${formatINR(c.outstandingAmount)} as received and reconcile.`,
      amount: c.outstandingAmount,
    });
  }

  for (const s of candidates) {
    const copy = CLASSIFY_COPY[s];
    if (!copy || primary.some((o) => o.kind === "CLASSIFY" && o.state === s)) continue;
    if (s === "FOLLOW_UP_ACTIVE" && openMatch) continue; // covered by "Different payment"
    primary.push({
      id: `classify-${s}`,
      kind: "CLASSIFY",
      state: s,
      ...copy,
      label: s === "FOLLOW_UP_ACTIVE" && candidates.includes("PAID_UNMATCHED") ? "Not received — resume follow-up" : copy.label,
      requiresDate: s === "PROMISE_TO_PAY",
      defaultDate: s === "PROMISE_TO_PAY" ? defaultPromiseDate(c) : undefined,
    });
  }

  // "No blocker" is always a legitimate answer.
  if (!openMatch && !primary.some((o) => o.kind === "CLASSIFY" && o.state === "FOLLOW_UP_ACTIVE")) {
    primary.push({
      id: "classify-FOLLOW_UP_ACTIVE",
      kind: "CLASSIFY",
      state: "FOLLOW_UP_ACTIVE",
      ...CLASSIFY_COPY.FOLLOW_UP_ACTIVE!,
      label: candidates.includes("PAID_UNMATCHED") ? "Not received — resume follow-up" : CLASSIFY_COPY.FOLLOW_UP_ACTIVE!.label,
    });
  }

  const other = ALL_CLASSIFIABLE.filter((s) => !primary.some((o) => o.kind === "CLASSIFY" && o.state === s))
    .filter((s) => !(s === "FOLLOW_UP_ACTIVE" && openMatch))
    .map<ReviewOption>((s) => ({
      id: `classify-${s}`,
      kind: "CLASSIFY",
      state: s,
      ...CLASSIFY_COPY[s]!,
      requiresDate: s === "PROMISE_TO_PAY",
      defaultDate: s === "PROMISE_TO_PAY" ? defaultPromiseDate(c) : undefined,
    }));
  return { primary, other };
}
