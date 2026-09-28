import type {
  ConfidenceBand,
  Evidence,
  Initiator,
  InvoiceCase,
  InvoiceState,
  StateTransition,
  TriggerType,
} from "./types";

/**
 * Explicit, exhaustive transition table. A transition not listed here is illegal.
 * Each edge also lists WHO may initiate it — e.g. the AI can never move an invoice
 * to PAID_UNMATCHED or RESOLVED; only deterministic rules, payment events, or the
 * merchant can.
 */
type Edge = { to: InvoiceState; by: Initiator[]; note: string };

const BLOCKER_STATES: InvoiceState[] = [
  "PAPERWORK_BLOCKED",
  "CASH_CONSTRAINED",
  "PROMISE_TO_PAY",
  "COMMERCIAL_DISPUTE",
];

const TO_RESOLVED: Edge = {
  to: "RESOLVED",
  by: ["PAYMENT_EVENT", "MERCHANT"],
  note: "Full payment confirmed and reconciled",
};
const TO_PAID_UNMATCHED: Edge = {
  to: "PAID_UNMATCHED",
  by: ["RULE"],
  note: "Bank credit strongly matches this invoice but is not reconciled",
};
const TO_REVIEW_FROM_NEW_EVIDENCE: Edge = {
  to: "NEEDS_REVIEW",
  by: ["AI", "RULE", "MERCHANT"],
  note: "New evidence conflicts with current state",
};
/** A merchant may reclassify one blocker state as another (recorded as an override). */
const merchantReclassify = (from: InvoiceState): Edge[] =>
  BLOCKER_STATES.filter((s) => s !== from).map((to) => ({
    to,
    by: ["MERCHANT"] as Initiator[],
    note: "Merchant reclassified the blocker",
  }));

export const ALLOWED_TRANSITIONS: Record<InvoiceState, Edge[]> = {
  FOLLOW_UP_ACTIVE: [
    TO_PAID_UNMATCHED,
    { to: "PAPERWORK_BLOCKED", by: ["AI", "MERCHANT"], note: "High-confidence paperwork blocker or merchant confirmation" },
    { to: "CASH_CONSTRAINED", by: ["AI", "MERCHANT"], note: "Buyer clearly requests split payment / extension" },
    { to: "PROMISE_TO_PAY", by: ["AI", "MERCHANT"], note: "Clear promise with a sufficiently precise date" },
    { to: "NEEDS_REVIEW", by: ["AI", "RULE", "MERCHANT"], note: "Mixed signals, low confidence or ambiguous date" },
    { to: "COMMERCIAL_DISPUTE", by: ["AI", "MERCHANT"], note: "Buyer disputes quantity, quality or rate" },
    TO_RESOLVED,
  ],
  PAID_UNMATCHED: [
    { to: "RESOLVED", by: ["MERCHANT", "PAYMENT_EVENT"], note: "Merchant confirmed the bank credit matches" },
    { to: "FOLLOW_UP_ACTIVE", by: ["MERCHANT"], note: "Merchant says the credit is a different payment" },
  ],
  PAPERWORK_BLOCKED: [
    { to: "FOLLOW_UP_ACTIVE", by: ["MERCHANT"], note: "Correction approved and issued; invoice still unpaid" },
    ...merchantReclassify("PAPERWORK_BLOCKED"),
    TO_PAID_UNMATCHED,
    TO_REVIEW_FROM_NEW_EVIDENCE,
    TO_RESOLVED,
  ],
  CASH_CONSTRAINED: [
    { to: "FOLLOW_UP_ACTIVE", by: ["TIMER", "MERCHANT"], note: "Installment missed or plan rejected" },
    ...merchantReclassify("CASH_CONSTRAINED"),
    TO_PAID_UNMATCHED,
    TO_REVIEW_FROM_NEW_EVIDENCE,
    TO_RESOLVED,
  ],
  PROMISE_TO_PAY: [
    { to: "FOLLOW_UP_ACTIVE", by: ["TIMER", "MERCHANT"], note: "Promised date + grace passed; invoice unpaid" },
    ...merchantReclassify("PROMISE_TO_PAY"),
    TO_PAID_UNMATCHED,
    TO_REVIEW_FROM_NEW_EVIDENCE,
    TO_RESOLVED,
  ],
  NEEDS_REVIEW: [
    ...(["FOLLOW_UP_ACTIVE", ...BLOCKER_STATES] as InvoiceState[]).map((to) => ({
      to,
      by: ["MERCHANT"] as Initiator[],
      note: "Merchant classification of an ambiguous case",
    })),
    TO_PAID_UNMATCHED,
    TO_RESOLVED,
  ],
  COMMERCIAL_DISPUTE: [
    { to: "FOLLOW_UP_ACTIVE", by: ["MERCHANT"], note: "Dispute settled; amount still due" },
    ...merchantReclassify("COMMERCIAL_DISPUTE"),
    TO_PAID_UNMATCHED,
    TO_REVIEW_FROM_NEW_EVIDENCE,
    TO_RESOLVED,
  ],
  RESOLVED: [],
};

export class TransitionError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "TransitionError";
  }
}

export interface TransitionRequest {
  to: InvoiceState;
  initiatedBy: Initiator;
  triggerType: TriggerType;
  evidenceIds: string[];
  reasonCode: string;
  humanReadableReason: string;
  confidenceBand?: ConfidenceBand;
  modelVersion?: string;
  policyVersion?: string;
}

export function canTransition(from: InvoiceState, to: InvoiceState, by: Initiator): boolean {
  return ALLOWED_TRANSITIONS[from].some((e) => e.to === to && e.by.includes(by));
}

/** Throws TransitionError if the request is not permitted for this case. */
export function assertTransition(c: InvoiceCase, req: TransitionRequest): void {
  const from = c.currentState;
  if (from === req.to) {
    throw new TransitionError("NO_OP", `Invoice ${c.invoiceNumber} is already ${from}`);
  }
  const edge = ALLOWED_TRANSITIONS[from].find((e) => e.to === req.to);
  if (!edge) throw new TransitionError("ILLEGAL_TRANSITION", `${from} → ${req.to} is not an allowed transition`);
  if (!edge.by.includes(req.initiatedBy)) {
    throw new TransitionError(
      "INITIATOR_NOT_PERMITTED",
      `${req.initiatedBy} may not initiate ${from} → ${req.to} (allowed: ${edge.by.join(", ")})`,
    );
  }
  if (req.evidenceIds.length === 0) {
    throw new TransitionError("NO_EVIDENCE", "Every state change must reference supporting evidence");
  }
  const byId = new Map(c.evidence.map((e) => [e.id, e] as const));
  const missing = req.evidenceIds.filter((id) => !byId.has(id));
  if (missing.length) throw new TransitionError("UNKNOWN_EVIDENCE", `Unknown evidence: ${missing.join(", ")}`);
  const evidence = req.evidenceIds.map((id) => byId.get(id)!) as Evidence[];

  if (req.initiatedBy === "AI" && req.to !== "NEEDS_REVIEW" && req.confidenceBand !== "HIGH") {
    throw new TransitionError("LOW_CONFIDENCE", "AI may only move a case to a blocker state with HIGH confidence");
  }
  if (req.to === "PAID_UNMATCHED" && !evidence.some((e) => e.type === "BANK_CREDIT")) {
    throw new TransitionError("NEEDS_BANK_CREDIT", "PAID_UNMATCHED requires a matched bank credit as evidence");
  }
  if (req.to === "RESOLVED" && c.outstandingAmount > 0) {
    throw new TransitionError("OUTSTANDING_REMAINS", "Cannot resolve while an amount is still outstanding");
  }
  if (from === "PAPERWORK_BLOCKED" && req.to === "FOLLOW_UP_ACTIVE") {
    if (c.workflow?.correction?.status !== "ISSUED") {
      throw new TransitionError("CORRECTION_NOT_ISSUED", "Follow-up can resume only after the correction is issued");
    }
  }
  if (req.to === "FOLLOW_UP_ACTIVE" && c.outstandingAmount <= 0) {
    throw new TransitionError("ALREADY_PAID", "Cannot resume follow-up on a fully paid invoice");
  }
}

/**
 * Apply a transition in place on a (cloned) case and return the audit record.
 * This is the ONLY function that writes `currentState`.
 */
export function applyTransition(
  c: InvoiceCase,
  req: TransitionRequest,
  ctx: { now: string; id: string },
): StateTransition {
  assertTransition(c, req);
  const t: StateTransition = {
    id: ctx.id,
    invoiceId: c.id,
    fromState: c.currentState,
    toState: req.to,
    timestamp: ctx.now,
    triggerType: req.triggerType,
    evidenceIds: [...req.evidenceIds],
    initiatedBy: req.initiatedBy,
    reasonCode: req.reasonCode,
    humanReadableReason: req.humanReadableReason,
    modelVersion: req.modelVersion,
    policyVersion: req.policyVersion,
  };
  c.transitions.push(t);
  c.currentState = req.to;
  c.stateEnteredAt = ctx.now;
  c.updatedAt = ctx.now;
  if (req.to !== "NEEDS_REVIEW") c.reviewCandidates = undefined;
  return t;
}

/** Record the opening of a case (the simulated Receivables Agent handoff). */
export function openCase(
  c: InvoiceCase,
  ctx: { now: string; id: string; evidenceIds: string[]; reason: string },
): StateTransition {
  if (c.transitions.length > 0) throw new TransitionError("ALREADY_OPEN", "Case already opened");
  if (ctx.evidenceIds.length === 0) throw new TransitionError("NO_EVIDENCE", "Handoff requires evidence");
  const t: StateTransition = {
    id: ctx.id,
    invoiceId: c.id,
    fromState: null,
    toState: "FOLLOW_UP_ACTIVE",
    timestamp: ctx.now,
    triggerType: "HANDOFF",
    evidenceIds: ctx.evidenceIds,
    initiatedBy: "RULE",
    reasonCode: "RECEIVABLES_HANDOFF",
    humanReadableReason: ctx.reason,
  };
  c.transitions.push(t);
  c.currentState = "FOLLOW_UP_ACTIVE";
  c.stateEnteredAt = ctx.now;
  return t;
}

export const STATE_META: Record<
  InvoiceState,
  { label: string; short: string; buyerContactAllowed: boolean; description: string }
> = {
  FOLLOW_UP_ACTIVE: {
    label: "Follow-up active",
    short: "Follow-up",
    buyerContactAllowed: true,
    description: "No blocker found. Standard follow-up by the Receivables Agent continues.",
  },
  PAID_UNMATCHED: {
    label: "Paid but unmatched",
    short: "Paid · unmatched",
    buyerContactAllowed: false,
    description: "A bank credit likely covers this invoice. No buyer follow-up until reconciled.",
  },
  PAPERWORK_BLOCKED: {
    label: "Paperwork blocked",
    short: "Paperwork",
    buyerContactAllowed: false,
    description: "A document or tax-data problem is preventing payment. Reminders paused.",
  },
  CASH_CONSTRAINED: {
    label: "Cash constrained",
    short: "Cash constraint",
    buyerContactAllowed: false,
    description: "Buyer asked for a split or extension. Handled via an approved plan, not reminders.",
  },
  PROMISE_TO_PAY: {
    label: "Promise to pay",
    short: "Promise",
    buyerContactAllowed: false,
    description: "Buyer gave a dated promise. Resolve waits until the deadline passes.",
  },
  NEEDS_REVIEW: {
    label: "Needs review",
    short: "Needs review",
    buyerContactAllowed: false,
    description: "Signals are mixed or ambiguous. No buyer message until a person classifies it.",
  },
  COMMERCIAL_DISPUTE: {
    label: "Commercial dispute",
    short: "Dispute",
    buyerContactAllowed: false,
    description: "Buyer disputes the goods or price. Collections paused; routed to Sales.",
  },
  RESOLVED: {
    label: "Resolved",
    short: "Resolved",
    buyerContactAllowed: false,
    description: "Paid and reconciled. No further collection action.",
  },
};
