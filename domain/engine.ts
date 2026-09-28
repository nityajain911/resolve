/**
 * Resolve engine: the only place that changes WorldState.
 *
 *   AI (classifier)  → UNDERSTANDS the case (CaseUnderstanding)
 *   Policy engine    → DECIDES what is allowed (evaluateAction)
 *   Workflow (here)  → EXECUTES / ROUTES via explicit state transitions
 *   Outcomes         → update buyer + invoice state, with an audit trail
 *
 * Every exported command takes a WorldState and returns a NEW WorldState
 * (the input is never mutated). Internals mutate a structured clone.
 */
import type { ClassifierEvidence, ClassifierInput } from "@/ai/classifier";
import type { BookBankCredit, BookEvidence, ObservableInvoiceBook } from "./book";
import { matchCredit } from "./matching";
import { formatINR } from "./money";
import { DEFAULT_POLICY, evaluateAction, FINANCIAL_OR_DOCUMENT_ACTIONS, policyVersion, type ProposedAction } from "./policy";
import { applyTransition, openCase, STATE_META, type TransitionRequest } from "./state-machine";
import { splitInvoice } from "./split";
import { addDays, daysOverdue, formatDate, formatIst, istDate, isOnOrBefore } from "./time";
import { cancelTimersFor, dueTimers, promiseDeadline, schedule } from "./timers";
import {
  TEXTUAL_BUYER_EVIDENCE,
  type ActionType,
  type BankFeedEntry,
  type CaseUnderstanding,
  type Evidence,
  type Initiator,
  type InvoiceCase,
  type InvoiceState,
  type MerchantPolicy,
  type PaymentLinkRecord,
  type PaymentPlan,
  type ResolutionAction,
  type WorldState,
} from "./types";

export type ClassifyFn = (input: ClassifierInput) => CaseUnderstanding;

export interface EngineContext {
  classify: ClassifyFn;
}

export class EngineError extends Error {}

// ---------------------------------------------------------------------------
// helpers

function nextId(w: WorldState, prefix: string): string {
  w.idCounter += 1;
  return `${prefix}-${String(w.idCounter).padStart(4, "0")}`;
}

function log(w: WorldState, text: string): void {
  w.activity.unshift({ at: w.clock, text });
  if (w.activity.length > 300) w.activity.length = 300;
}

function getCase(w: WorldState, id: string): InvoiceCase {
  const c = w.cases[id];
  if (!c) throw new EngineError(`Unknown invoice case ${id}`);
  return c;
}

function addEvidence(w: WorldState, c: InvoiceCase, e: BookEvidence): Evidence {
  const ev: Evidence = { ...structuredClone(e), id: nextId(w, "ev"), invoiceId: c.id };
  c.evidence.push(ev);
  c.updatedAt = w.clock;
  return ev;
}

function systemNote(w: WorldState, c: InvoiceCase, source: string, text: string): Evidence {
  return addEvidence(w, c, {
    type: "MANUAL_NOTE",
    timestamp: w.clock,
    source,
    rawContent: text,
    isSynthetic: false,
  });
}

function syncBuyer(w: WorldState, buyerId: string): void {
  const b = w.buyers[buyerId];
  for (const id of w.caseOrder) {
    if (w.cases[id].buyerId === buyerId) w.cases[id].buyerContext = structuredClone(b);
  }
}

const OPEN_ACTION: ResolutionAction["status"][] = ["PROPOSED", "REVIEW_REQUIRED", "APPROVED"];

function openActionsFor(w: WorldState, caseId: string): ResolutionAction[] {
  return Object.values(w.actions).filter((a) => a.invoiceId === caseId && OPEN_ACTION.includes(a.status));
}

export function actionsFor(w: WorldState, caseId: string): ResolutionAction[] {
  return Object.values(w.actions)
    .filter((a) => a.invoiceId === caseId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function recheckPayment(w: WorldState, c: InvoiceCase) {
  const pending = w.bankFeed.find(
    (f) =>
      !f.assignedTo &&
      !(c.rejectedCreditIds ?? []).includes(f.evidence.id) &&
      f.evidence.structuredExtraction?.kind === "BANK_CREDIT" &&
      matchCredit(f.evidence.structuredExtraction.data, c).strength === "STRONG",
  );
  return { outstandingAmount: c.outstandingAmount, newPaymentDetected: Boolean(pending), checkedAt: w.clock };
}

function evaluate(w: WorldState, c: InvoiceCase, proposal: ProposedAction) {
  return evaluateAction({
    invoiceCase: c,
    proposedAction: proposal,
    merchantPolicy: w.policy,
    latestPaymentStatus: recheckPayment(w, c),
    now: w.clock,
  });
}

/** Evaluate whether the Receivables Agent may send a standard reminder right now. */
export function reminderGate(w: WorldState, c: InvoiceCase) {
  return evaluate(w, c, { type: "SEND_REMINDER" });
}

function propose(
  w: WorldState,
  c: InvoiceCase,
  type: ActionType,
  opts: {
    proposedBy: Initiator;
    summary: string;
    evidenceIds: string[];
    proposal?: Omit<ProposedAction, "type">;
    payload?: Record<string, unknown>;
    autoExecute?: boolean;
    result?: string;
  },
): ResolutionAction {
  const pe = evaluate(w, c, { type, ...(opts.proposal ?? {}) });
  let status: ResolutionAction["status"];
  if (pe.decision === "BLOCK") status = "BLOCKED";
  else if (pe.decision === "REVIEW_REQUIRED") status = "REVIEW_REQUIRED";
  else status = opts.autoExecute ? "EXECUTED" : "PROPOSED";
  // Financial / document actions can never skip approval, whatever the policy says.
  if (FINANCIAL_OR_DOCUMENT_ACTIONS.includes(type) && status === "EXECUTED") status = "REVIEW_REQUIRED";
  const a: ResolutionAction = {
    id: nextId(w, "act"),
    invoiceId: c.id,
    type,
    status,
    proposedBy: opts.proposedBy,
    createdAt: w.clock,
    executedAt: status === "EXECUTED" ? w.clock : undefined,
    policyEvaluation: pe,
    evidenceIds: opts.evidenceIds,
    summary: opts.summary,
    payload: opts.payload,
    result: status === "EXECUTED" ? opts.result : undefined,
  };
  w.actions[a.id] = a;
  if (type !== "STOP_FOLLOW_UP") c.policyEvaluation = pe;
  return a;
}

function transition(w: WorldState, c: InvoiceCase, req: Omit<TransitionRequest, "policyVersion">) {
  const from = c.currentState;
  const t = applyTransition(c, { ...req, policyVersion: policyVersion(w.policy) }, { now: w.clock, id: nextId(w, "tr") });
  // Leaving a state cancels that state's open proposals and timers.
  for (const a of openActionsFor(w, c.id)) {
    a.status = "CANCELLED";
    a.result = `Cancelled: case moved ${STATE_META[from].label} → ${STATE_META[req.to].label}`;
  }
  if (from === "PROMISE_TO_PAY" || from === "CASH_CONSTRAINED") {
    cancelTimersFor(w.timers, c.id, `Case left ${from}`);
  }
  log(w, `${c.invoiceNumber}: ${STATE_META[from].label} → ${STATE_META[req.to].label} (${req.initiatedBy})`);
  return t;
}

// ---------------------------------------------------------------------------
// state entry workflows

function onEnterState(w: WorldState, c: InvoiceCase, evidenceIds: string[], ctx?: { creditEvidenceId?: string; matchRationale?: string[] }) {
  const u = c.understanding;
  c.workflow = { ...(c.workflow ?? { followUpPaused: false }) };
  const stop = () =>
    propose(w, c, "STOP_FOLLOW_UP", {
      proposedBy: "RULE",
      summary: "Pause Receivables Agent reminders and calls for this invoice",
      evidenceIds,
      autoExecute: true,
      result: "Buyer follow-up paused",
    });

  switch (c.currentState) {
    case "PAID_UNMATCHED": {
      c.workflow.followUpPaused = true;
      stop();
      propose(w, c, "MATCH_PAYMENT", {
        proposedBy: "RULE",
        summary: "Confirm that the bank credit pays this invoice and reconcile it",
        evidenceIds,
        payload: { creditEvidenceId: ctx?.creditEvidenceId, rationale: ctx?.matchRationale ?? [] },
      });
      break;
    }
    case "PAPERWORK_BLOCKED": {
      c.workflow.followUpPaused = true;
      c.workflow.routedTo = "ACCOUNTS";
      stop();
      propose(w, c, "ROUTE_TO_ACCOUNTS", {
        proposedBy: "RULE",
        summary: "Route the case to Accounts to fix the document",
        evidenceIds,
        autoExecute: true,
        result: "Assigned to Accounts queue",
      });
      const draft = correctionDraft(c);
      c.workflow.correction = { status: "DRAFTED", draft };
      propose(w, c, "DRAFT_CORRECTION", {
        proposedBy: "AI",
        summary: "Correction request drafted for Accounts — approval required before anything is issued",
        evidenceIds,
        payload: { draft },
      });
      break;
    }
    case "CASH_CONSTRAINED": {
      c.workflow.followUpPaused = true;
      stop();
      const plan = planFromUnderstanding(w, c, evidenceIds[0]);
      c.paymentPlan = plan;
      proposePartPayment(w, c, evidenceIds);
      break;
    }
    case "PROMISE_TO_PAY": {
      c.workflow.followUpPaused = true;
      stop();
      const p = c.promiseToPay!;
      schedule(w.timers, {
        id: nextId(w, "tmr"),
        invoiceId: c.id,
        kind: "PROMISE_DEADLINE",
        fireAt: p.deadlineAt,
        payload: {},
        createdAt: w.clock,
      });
      const hist = c.buyerContext.promiseHistory;
      propose(w, c, "WAIT_UNTIL_DATE", {
        proposedBy: "RULE",
        summary: `Wait until ${formatDate(p.promisedDate)} — no buyer follow-up. Buyer kept ${hist.kept} of ${hist.made} previous promises.`,
        evidenceIds,
        proposal: { finalDate: p.promisedDate },
        autoExecute: true,
        result: `Timer set for ${formatIst(p.deadlineAt)} (promised date + ${w.policy.promiseGracePeriodHours}h grace)`,
      });
      break;
    }
    case "NEEDS_REVIEW": {
      c.workflow.followUpPaused = true;
      stop();
      propose(w, c, "REQUEST_HUMAN_REVIEW", {
        proposedBy: "RULE",
        summary: "Ask the merchant to classify this case. No buyer message will be sent until then.",
        evidenceIds,
        autoExecute: true,
        result: "Added to review queue",
      });
      break;
    }
    case "COMMERCIAL_DISPUTE": {
      c.workflow.followUpPaused = true;
      c.workflow.routedTo = "SALES";
      stop();
      const disputed = u?.extractedAmounts.find((a) => a.role === "DISPUTED")?.amount;
      if (disputed && disputed < c.outstandingAmount && !c.parentInvoiceId) {
        propose(w, c, "CREATE_CHILD_INVOICE", {
          proposedBy: "AI",
          summary: `Split: keep ${formatINR(disputed)} disputed, move ${formatINR(c.outstandingAmount - disputed)} undisputed to a child receivable`,
          evidenceIds,
          payload: { disputedAmount: disputed },
        });
      }
      break;
    }
    case "FOLLOW_UP_ACTIVE": {
      const a = propose(w, c, "RESUME_FOLLOW_UP", {
        proposedBy: c.transitions.at(-1)?.initiatedBy ?? "RULE",
        summary: "Hand the invoice back to the Receivables Agent for standard follow-up",
        evidenceIds,
        autoExecute: true,
        result: "Follow-up resumed (simulated Receivables Agent)",
      });
      c.workflow.followUpPaused = a.status !== "EXECUTED";
      c.workflow.routedTo = "COLLECTIONS";
      break;
    }
    case "RESOLVED": {
      c.workflow.followUpPaused = true;
      cancelTimersFor(w.timers, c.id, "Invoice resolved");
      break;
    }
  }
}

function correctionDraft(c: InvoiceCase): string {
  const u = c.understanding;
  const kind = u?.entities.blockerKind ?? "SUPPORTING_DOC";
  const inv = c.evidence.find((e) => e.structuredExtraction?.kind === "INVOICE_DATA");
  const invData = inv?.structuredExtraction?.kind === "INVOICE_DATA" ? inv.structuredExtraction.data : undefined;
  const ims = c.evidence.find((e) => e.type === "IMS_IMPORT");
  const lines = [
    `To: Accounts team`,
    `Re: ${c.invoiceNumber} · ${c.buyerContext.name} · ${formatINR(c.outstandingAmount)} outstanding`,
    ``,
  ];
  if (kind === "GSTIN") {
    const billed = invData?.billedGstin ?? "—";
    const master = c.buyerContext.gstin;
    lines.push(
      `Buyer reports the invoice was rejected because the GSTIN is incorrect.`,
      ims ? `Imported IMS evidence supports this: "${ims.rawContent}".` : `No IMS evidence imported for this invoice.`,
      ``,
      `GSTIN on invoice:        ${billed}`,
      `GSTIN in buyer master:   ${master}${billed !== master ? "   ← differs" : ""}`,
      ``,
      `Proposed next step: verify the buyer GSTIN and issue a corrected tax document per your accountant's process.`,
    );
  } else if (kind === "PO") {
    lines.push(
      `Buyer's accounts team cannot process the invoice without a valid PO reference.`,
      `PO on invoice: ${invData?.poNumber ?? "missing"}`,
      ``,
      `Proposed next step: obtain the PO number from Sales and re-share the invoice with the PO quoted.`,
    );
  } else if (kind === "INVOICE_FORMAT") {
    lines.push(
      `Buyer rejected the invoice format (template / mandatory fields).`,
      ``,
      `Proposed next step: re-issue the invoice in the buyer's required format after Accounts review.`,
    );
  } else {
    lines.push(
      `Buyer needs a supporting document before releasing payment (${(u?.entities.documents ?? ["document"]).join(", ")}).`,
      ``,
      `Proposed next step: share the missing document with the buyer's accounts team.`,
    );
  }
  lines.push(``, `Resolve will not issue any tax document or credit note. Buyer reminders stay paused until this is done.`);
  return lines.join("\n");
}

function planFromUnderstanding(w: WorldState, c: InvoiceCase, sourceEvidenceId: string): PaymentPlan {
  const u = c.understanding;
  const src = c.evidence.find((e) => e.id === sourceEvidenceId);
  const msgDate = istDate(src?.timestamp ?? w.clock);
  const immediate = u?.extractedAmounts.find((a) => a.role === "IMMEDIATE")?.amount;
  // The remainder's date is the expression that is NOT "today" (e.g. "15 ke baad" in "₹90K aaj, baaki 15 ke baad").
  const t = u?.temporalExpressions.find((x) => x.type !== "AMBIGUOUS" && x.normalizedDate !== msgDate);
  let remainderDate: string | undefined;
  if (t?.type === "AFTER_DATE" && t.lowerBound) remainderDate = addDays(t.lowerBound, 1);
  else if (t?.type === "DATE_RANGE" && t.upperBound) remainderDate = t.upperBound;
  else if (t?.normalizedDate && t.normalizedDate !== msgDate) remainderDate = t.normalizedDate;
  const firstDate = istDate(w.clock) > msgDate ? istDate(w.clock) : msgDate;
  const installments = [] as PaymentPlan["installments"];
  if (immediate && immediate < c.outstandingAmount) {
    installments.push({ id: nextId(w, "inst"), amount: immediate, dueDate: firstDate, status: "PENDING" });
    installments.push({
      id: nextId(w, "inst"),
      amount: c.outstandingAmount - immediate,
      dueDate: remainderDate ?? "",
      status: "PENDING",
    });
  }
  return {
    id: nextId(w, "plan"),
    sourceEvidenceId,
    installments,
    status: "PROPOSED",
    startingOutstanding: c.outstandingAmount,
    createdAt: w.clock,
  };
}

function proposePartPayment(w: WorldState, c: InvoiceCase, evidenceIds: string[]) {
  const plan = c.paymentPlan!;
  const [first, second] = plan.installments;
  const summary = first
    ? `Part-payment link: ${formatINR(first.amount)} now, ${formatINR(second.amount)} ${second.dueDate ? `by ${formatDate(second.dueDate)}` : "(date needed)"}`
    : "Part-payment plan needs amounts before it can be proposed";
  return propose(w, c, "CREATE_PART_PAYMENT_LINK", {
    proposedBy: "AI",
    summary,
    evidenceIds,
    proposal: {
      immediateAmount: first?.amount,
      finalDate: second?.dueDate || undefined,
      buyerMessage: first
        ? `Hi, as discussed, here is a payment link for ${c.invoiceNumber}. You can pay ${formatINR(first.amount)} now and the balance of ${formatINR(second.amount)} by ${second.dueDate ? formatDate(second.dueDate, false) : "the agreed date"}. Thank you.`
        : undefined,
    },
    payload: { planId: plan.id },
  });
}

// ---------------------------------------------------------------------------
// evidence ingestion + classification

function classifierInputFor(c: InvoiceCase, primary: Evidence): ClassifierInput {
  const toCE = (e: Evidence): ClassifierEvidence => ({ id: e.id, type: e.type, text: e.rawContent, timestamp: e.timestamp });
  const supporting = c.evidence.filter(
    (e) => e.id !== primary.id && (TEXTUAL_BUYER_EVIDENCE.includes(e.type) || e.type === "IMS_IMPORT"),
  );
  return {
    primaryEvidence: toCE(primary),
    supportingEvidence: supporting.map(toCE),
    invoice: {
      invoiceNumber: c.invoiceNumber,
      amount: c.amount,
      outstandingAmount: c.outstandingAmount,
      dueAt: c.dueAt,
    },
    buyerName: c.buyerContext.name,
  };
}

function ingestMut(w: WorldState, ctx: EngineContext, caseId: string, e: BookEvidence, understanding?: CaseUnderstanding) {
  const c = getCase(w, caseId);
  const ev = addEvidence(w, c, e);
  log(w, `${c.invoiceNumber}: new evidence — ${ev.source}`);
  if (c.currentState === "RESOLVED") return ev;

  if (ev.type === "PAYMENT_EVENT") {
    processPayment(w, c, ev);
    return ev;
  }
  if (TEXTUAL_BUYER_EVIDENCE.includes(ev.type)) {
    const u = understanding ?? ctx.classify(classifierInputFor(c, ev));
    applyUnderstanding(w, c, u, ev);
    return ev;
  }
  if (ev.type === "IMS_IMPORT") {
    // IMS only corroborates. Re-read the latest buyer message with IMS as supporting evidence;
    // if there is no buyer message, IMS alone is interpreted by the classifier (it cannot, by
    // itself, prove payment is withheld).
    const lastMsg = [...c.evidence].reverse().find((x) => TEXTUAL_BUYER_EVIDENCE.includes(x.type));
    const primary = lastMsg ?? ev;
    const u = ctx.classify(classifierInputFor(c, primary));
    applyUnderstanding(w, c, u, primary, ev);
  }
  return ev;
}

function applyUnderstanding(w: WorldState, c: InvoiceCase, u: CaseUnderstanding, primary: Evidence, trigger?: Evidence) {
  c.understanding = u;
  primary.structuredExtraction = { kind: "UNDERSTANDING", data: u };
  const evidenceIds = Array.from(new Set([primary.id, ...(trigger ? [trigger.id] : []), ...u.evidenceUsed.filter((id) => c.evidence.some((e) => e.id === id))]));
  const state = c.currentState;
  if (state === "RESOLVED") return;

  let target: InvoiceState = u.proposedState;
  let reasonCode = `AI_${target}`;
  let reason = u.conciseExplanation;
  const candidates = new Set<InvoiceState>([u.proposedState, ...(u.entities.alternativeStates ?? [])]);

  if (target === "PAID_UNMATCHED" || target === "RESOLVED") {
    // The AI cannot mark an invoice paid. Check the bank feed with the deterministic rule.
    const before = c.currentState;
    runMatchingForCase(w, c);
    if (c.currentState !== before) return;
    target = "NEEDS_REVIEW";
    reasonCode = "BUYER_REPORTS_PAYMENT_NO_CREDIT";
    reason = `${u.conciseExplanation} No matching bank credit was found, so a person must check before any follow-up.`;
    candidates.add("PAID_UNMATCHED");
    candidates.add("FOLLOW_UP_ACTIVE");
  }
  if (u.confidenceBand === "NEEDS_REVIEW" && target !== "NEEDS_REVIEW") {
    target = "NEEDS_REVIEW";
    reasonCode = "LOW_CONFIDENCE_OR_AMBIGUOUS";
  }
  candidates.delete("NEEDS_REVIEW");
  candidates.delete("RESOLVED");

  if (target === state) {
    // New corroborating evidence (e.g. an IMS import) refreshes an unapproved correction draft.
    if (state === "PAPERWORK_BLOCKED" && c.workflow?.correction?.status === "DRAFTED") {
      const draft = correctionDraft(c);
      c.workflow.correction.draft = draft;
      for (const a of openActionsFor(w, c.id)) {
        if (a.type === "DRAFT_CORRECTION") {
          a.payload = { ...a.payload, draft };
          a.evidenceIds = Array.from(new Set([...a.evidenceIds, ...evidenceIds]));
        }
      }
    }
    if (state === "NEEDS_REVIEW") c.reviewCandidates = Array.from(new Set([...(c.reviewCandidates ?? []), ...candidates]));
    log(w, `${c.invoiceNumber}: understanding refreshed — state unchanged (${STATE_META[state].label})`);
    return;
  }
  if (target === "FOLLOW_UP_ACTIVE") {
    log(w, `${c.invoiceNumber}: no blocker found — standard follow-up continues`);
    return;
  }

  const common = {
    initiatedBy: "AI" as const,
    triggerType: "CLASSIFICATION" as const,
    evidenceIds,
    confidenceBand: u.confidenceBand,
    modelVersion: `${u.provider}${u.promptVersion ? ` · ${u.promptVersion}` : ""}`,
  };

  if (state === "FOLLOW_UP_ACTIVE") {
    if (target === "PROMISE_TO_PAY") {
      const pd = promiseDateFrom(u);
      if (!pd) {
        target = "NEEDS_REVIEW";
        reasonCode = "PROMISE_WITHOUT_PRECISE_DATE";
      } else {
        c.promiseToPay = {
          promisedAmount: u.extractedAmounts.find((a) => a.role !== "DISPUTED")?.amount,
          promisedDate: pd.date,
          datePrecision: pd.precision,
          sourceEvidenceId: primary.id,
          status: "ACTIVE",
          createdAt: w.clock,
          deadlineAt: promiseDeadline(pd.date, w.policy.promiseGracePeriodHours),
        };
      }
    }
    if (target === "NEEDS_REVIEW") c.reviewCandidates = Array.from(candidates);
    transition(w, c, { ...common, to: target, reasonCode, humanReadableReason: reason });
    onEnterState(w, c, evidenceIds);
    return;
  }

  // Already in a blocker state and new evidence points elsewhere → human review.
  if (state !== "NEEDS_REVIEW" && state !== "PAID_UNMATCHED") {
    c.reviewCandidates = Array.from(new Set([state, ...candidates]));
    transition(w, c, {
      ...common,
      to: "NEEDS_REVIEW",
      reasonCode: "CONFLICTING_EVIDENCE",
      humanReadableReason: `New evidence suggests ${STATE_META[target].label.toLowerCase()} but the case is ${STATE_META[state].label.toLowerCase()}. ${u.conciseExplanation}`,
    });
    onEnterState(w, c, evidenceIds);
  } else if (state === "NEEDS_REVIEW") {
    c.reviewCandidates = Array.from(new Set([...(c.reviewCandidates ?? []), ...candidates]));
  }
}

function promiseDateFrom(u: CaseUnderstanding): { date: string; precision: "DAY" | "DEADLINE" } | undefined {
  const t = u.temporalExpressions.find((x) => x.confidenceBand === "HIGH" && (x.normalizedDate || x.upperBound));
  if (!t) return undefined;
  if (t.type === "AFTER_DATE") return undefined; // "15 ke baad" is not an exact promise date
  if (t.normalizedDate) return { date: t.normalizedDate, precision: t.type === "EXACT_DATE" ? "DEADLINE" : "DAY" };
  return { date: t.upperBound!, precision: "DEADLINE" };
}

// ---------------------------------------------------------------------------
// bank matching (deterministic rule)

function assignCredit(w: WorldState, c: InvoiceCase, entry: BankFeedEntry, rationale: string[]) {
  entry.assignedTo = c.id;
  entry.evidence.invoiceId = c.id;
  c.evidence.push(entry.evidence);
  if (c.currentState === "RESOLVED" || c.currentState === "PAID_UNMATCHED") return;
  transition(w, c, {
    to: "PAID_UNMATCHED",
    initiatedBy: "RULE",
    triggerType: "BANK_MATCH",
    evidenceIds: [entry.evidence.id],
    reasonCode: "BANK_CREDIT_STRONG_MATCH",
    humanReadableReason: `Possible payment already received: ${rationale.join("; ")}.`,
  });
  onEnterState(w, c, [entry.evidence.id], { creditEvidenceId: entry.evidence.id, matchRationale: rationale });
}

function strongCandidates(w: WorldState, entry: BankFeedEntry): { c: InvoiceCase; rationale: string[] }[] {
  if (entry.evidence.structuredExtraction?.kind !== "BANK_CREDIT") return [];
  const credit = entry.evidence.structuredExtraction.data;
  const out: { c: InvoiceCase; rationale: string[] }[] = [];
  for (const id of w.caseOrder) {
    const c = w.cases[id];
    if (c.currentState === "RESOLVED" || c.outstandingAmount <= 0) continue;
    if ((c.rejectedCreditIds ?? []).includes(entry.evidence.id)) continue;
    const m = matchCredit(credit, c);
    if (m.strength === "STRONG") out.push({ c, rationale: m.rationale.filter((r, i) => i < 3) });
  }
  return out;
}

function runMatchingForCase(w: WorldState, c: InvoiceCase) {
  for (const entry of w.bankFeed) {
    if (entry.assignedTo) continue;
    const cands = strongCandidates(w, entry);
    if (cands.length === 1 && cands[0].c.id === c.id) {
      assignCredit(w, c, entry, cands[0].rationale);
      return;
    }
  }
}

function runMatching(w: WorldState) {
  for (const entry of w.bankFeed) {
    if (entry.assignedTo) continue;
    const cands = strongCandidates(w, entry);
    if (cands.length === 1) assignCredit(w, cands[0].c, entry, cands[0].rationale);
    else if (cands.length > 1) log(w, `Bank credit ${entry.evidence.rawContent} matches ${cands.length} invoices — left unassigned`);
  }
}

function receiveCreditMut(w: WorldState, credit: BookBankCredit, runMatch: boolean) {
  const ev: Evidence = {
    id: nextId(w, "ev"),
    invoiceId: "",
    type: "BANK_CREDIT",
    timestamp: credit.data.valueDate,
    source: credit.source,
    rawContent: `${formatINR(credit.data.amount)} received from ${credit.data.payerName} · ${credit.data.reference}`,
    structuredExtraction: { kind: "BANK_CREDIT", data: credit.data },
    isSynthetic: true,
  };
  w.bankFeed.push({ evidence: ev, reconciled: false });
  if (runMatch) runMatching(w);
}

// ---------------------------------------------------------------------------
// payments, promises, plans

/** Close an active promise. `paidAt` undefined means the deadline passed unpaid. */
function settlePromise(w: WorldState, c: InvoiceCase, paidAt: string | undefined) {
  const p = c.promiseToPay;
  if (!p || p.status !== "ACTIVE") return;
  const kept = paidAt !== undefined && isOnOrBefore(paidAt, p.deadlineAt);
  p.status = kept ? "KEPT" : "BROKEN";
  p.evaluatedAt = w.clock;
  const b = w.buyers[c.buyerId];
  b.promiseHistory.made += 1;
  if (kept) b.promiseHistory.kept += 1;
  else b.promiseHistory.broken += 1;
  syncBuyer(w, c.buyerId);
}

function processPayment(w: WorldState, c: InvoiceCase, ev: Evidence) {
  if (ev.structuredExtraction?.kind !== "PAYMENT_EVENT") return;
  const amt = ev.structuredExtraction.data.amount;
  c.outstandingAmount = Math.max(0, c.outstandingAmount - amt);
  log(w, `${c.invoiceNumber}: payment of ${formatINR(amt)} recorded (${ev.source})`);

  const plan = c.paymentPlan;
  if (plan && plan.status === "ACTIVE") {
    const paid = plan.startingOutstanding - c.outstandingAmount;
    let cumulative = 0;
    for (const inst of plan.installments) {
      cumulative += inst.amount;
      if (inst.status === "PENDING" && paid >= cumulative) {
        inst.status = "PAID";
        inst.paidAt = w.clock;
      }
    }
    if (plan.installments.every((i) => i.status === "PAID")) plan.status = "COMPLETED";
  }
  if (c.outstandingAmount <= 0) {
    settlePromise(w, c, ev.timestamp);
    if (c.currentState !== "RESOLVED") {
      transition(w, c, {
        to: "RESOLVED",
        initiatedBy: "PAYMENT_EVENT",
        triggerType: "PAYMENT",
        evidenceIds: [ev.id],
        reasonCode: "PAID_IN_FULL",
        humanReadableReason: `Full payment received and reconciled against ${c.invoiceNumber}.`,
      });
      onEnterState(w, c, [ev.id]);
    }
  }
}

function fireTimer(w: WorldState, t: WorldState["timers"][number]) {
  t.status = "FIRED";
  t.firedAt = w.clock;
  const c = getCase(w, t.invoiceId);
  // Always re-check payment first.
  runMatchingForCase(w, c);

  if (t.kind === "PROMISE_DEADLINE") {
    const p = c.promiseToPay;
    if (c.currentState !== "PROMISE_TO_PAY" || !p || p.status !== "ACTIVE") {
      t.outcome = `No action — case is ${STATE_META[c.currentState].label}`;
      return;
    }
    if (c.outstandingAmount <= 0) {
      t.outcome = "Paid before deadline";
      return;
    }
    settlePromise(w, c, undefined);
    const b = c.buyerContext.promiseHistory;
    const note = systemNote(
      w,
      c,
      "Resolve timer · payment recheck",
      `Promised date ${formatDate(p.promisedDate)} + ${w.policy.promiseGracePeriodHours}h grace passed. Payment re-checked: ${formatINR(c.outstandingAmount)} still outstanding.`,
    );
    transition(w, c, {
      to: "FOLLOW_UP_ACTIVE",
      initiatedBy: "TIMER",
      triggerType: "TIMER",
      evidenceIds: [p.sourceEvidenceId, note.id],
      reasonCode: "PROMISE_BROKEN",
      humanReadableReason: `Promise missed. Follow-up resumed. Buyer has now kept ${b.kept} of ${b.made} promises.`,
    });
    onEnterState(w, c, [note.id]);
    t.outcome = "Promise broken → follow-up resumed";
    return;
  }

  if (t.kind === "INSTALLMENT_DUE") {
    const plan = c.paymentPlan;
    const inst = plan?.installments.find((i) => i.id === t.payload.installmentId);
    if (!plan || !inst || c.currentState !== "CASH_CONSTRAINED") {
      t.outcome = `No action — case is ${STATE_META[c.currentState].label}`;
      return;
    }
    if (inst.status !== "PENDING") {
      t.outcome = "Installment already paid";
      return;
    }
    inst.status = "MISSED";
    plan.status = "BROKEN";
    const note = systemNote(
      w,
      c,
      "Resolve timer · payment recheck",
      `Agreed installment of ${formatINR(inst.amount)} due ${formatDate(inst.dueDate)} was not received. Payment re-checked: ${formatINR(c.outstandingAmount)} outstanding.`,
    );
    transition(w, c, {
      to: "FOLLOW_UP_ACTIVE",
      initiatedBy: "TIMER",
      triggerType: "TIMER",
      evidenceIds: [plan.sourceEvidenceId, note.id],
      reasonCode: "PAYMENT_PLAN_MISSED",
      humanReadableReason: "Agreed installment missed. Plan marked broken; follow-up resumed.",
    });
    onEnterState(w, c, [note.id]);
    t.outcome = "Installment missed → follow-up resumed";
  }
}

function advanceMut(w: WorldState, to: string) {
  if (new Date(to).getTime() < new Date(w.clock).getTime()) return;
  for (const t of dueTimers(w.timers, to)) {
    w.clock = t.fireAt > w.clock ? t.fireAt : w.clock;
    fireTimer(w, t);
  }
  w.clock = to;
}

// ---------------------------------------------------------------------------
// bootstrap

export function createWorld(book: ObservableInvoiceBook, ctx: EngineContext, opts: { policy?: MerchantPolicy } = {}): WorldState {
  const w: WorldState = {
    seed: book.seed,
    merchantId: book.merchantId,
    merchantName: book.merchantName,
    clock: book.handoffAt,
    cases: {},
    caseOrder: [],
    actions: {},
    timers: [],
    policy: structuredClone(opts.policy ?? DEFAULT_POLICY),
    labelledReviewSet: [],
    buyers: Object.fromEntries(book.buyers.map((b) => [b.buyerId, structuredClone(b)])),
    bankFeed: [],
    idCounter: 0,
    activity: [],
  };

  for (const inv of book.invoices) {
    const buyer = w.buyers[inv.buyerId];
    if (!buyer) throw new EngineError(`Unknown buyer ${inv.buyerId}`);
    const c: InvoiceCase = {
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      merchantId: book.merchantId,
      buyerId: inv.buyerId,
      amount: inv.amount,
      outstandingAmount: inv.amount,
      issuedAt: inv.issuedAt,
      dueAt: inv.dueAt,
      currentState: "FOLLOW_UP_ACTIVE",
      stateEnteredAt: book.handoffAt,
      evidence: [],
      transitions: [],
      buyerContext: structuredClone(buyer),
      receivablesHandoff: structuredClone(inv.handoff),
      workflow: { followUpPaused: false, routedTo: "COLLECTIONS" },
      isDemoHero: inv.isDemoHero,
      demoLabel: inv.demoLabel,
      createdAt: book.handoffAt,
      updatedAt: book.handoffAt,
    };
    w.cases[c.id] = c;
    w.caseOrder.push(c.id);
    const invEv = addEvidence(w, c, {
      type: "INVOICE_DATA",
      timestamp: inv.issuedAt,
      source: "Invoice register (synthetic)",
      rawContent: `${inv.invoiceNumber} issued for ${formatINR(inv.amount)}, due ${formatIst(inv.dueAt, { time: false })}. Billed GSTIN ${inv.invoiceData.billedGstin}${inv.invoiceData.poNumber ? `, PO ${inv.invoiceData.poNumber}` : ", no PO quoted"}.`,
      structuredExtraction: { kind: "INVOICE_DATA", data: inv.invoiceData },
      isSynthetic: true,
    });
    const h = inv.handoff;
    openCase(c, {
      now: book.handoffAt,
      id: nextId(w, "tr"),
      evidenceIds: [invEv.id],
      reason: `Simulated Receivables Agent handoff: ${daysOverdue(inv.dueAt, book.handoffAt)} days overdue after ${h.remindersSent} reminders and ${h.callsMade} call${h.callsMade === 1 ? "" : "s"}.`,
    });
  }

  type Ev = { at: string; order: number; run: () => void };
  const events: Ev[] = [];
  let order = 0;
  for (const inv of book.invoices) {
    for (const e of inv.evidence) {
      events.push({ at: e.timestamp, order: order++, run: () => ingestMut(w, ctx, inv.id, e) });
    }
  }
  for (const credit of book.bankFeed) {
    events.push({ at: credit.data.valueDate, order: order++, run: () => receiveCreditMut(w, credit, true) });
  }
  events.sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);
  for (const ev of events) {
    advanceMut(w, ev.at > w.clock ? ev.at : w.clock);
    ev.run();
  }
  advanceMut(w, book.demoStartAt);
  log(w, `Invoice book loaded: ${w.caseOrder.length} invoices from the simulated Receivables Agent handoff`);
  return w;
}

// ---------------------------------------------------------------------------
// public commands (pure: world in → new world out)

function mutate(w: WorldState, fn: (draft: WorldState) => void): WorldState {
  const draft = structuredClone(w);
  fn(draft);
  return draft;
}

export function advanceClock(w: WorldState, to: string): WorldState {
  return mutate(w, (d) => advanceMut(d, to));
}

export function ingestEvidence(
  w: WorldState,
  ctx: EngineContext,
  caseId: string,
  e: BookEvidence,
  understanding?: CaseUnderstanding,
): WorldState {
  return mutate(w, (d) => {
    ingestMut(d, ctx, caseId, e, understanding);
  });
}

/** A new bank statement line arrives. `runMatching=false` models a feed that syncs lazily. */
export function receiveBankCredit(w: WorldState, credit: BookBankCredit, runMatch = true): WorldState {
  return mutate(w, (d) => receiveCreditMut(d, credit, runMatch));
}

export function simulatePayment(w: WorldState, caseId: string, amount: number, note = "Simulated payment event"): WorldState {
  return mutate(w, (d) => {
    const c = getCase(d, caseId);
    const link = c.paymentPlan?.paymentLink;
    const ev = addEvidence(d, c, {
      type: "PAYMENT_EVENT",
      timestamp: d.clock,
      source: note,
      rawContent: `${formatINR(amount)} received${link ? ` via ${link.mode === "TEST_MODE" ? "test-mode" : "simulated"} payment link ${link.id}` : ""}. SIMULATED — no real money moved.`,
      structuredExtraction: {
        kind: "PAYMENT_EVENT",
        data: { amount, channel: "SIMULATED", reference: link?.id ?? c.invoiceNumber, reconciled: true },
      },
      isSynthetic: true,
    });
    if (c.currentState !== "RESOLVED") processPayment(d, c, ev);
  });
}

function merchantEvidence(d: WorldState, c: InvoiceCase, text: string, chosen: InvoiceState, from?: InvoiceState) {
  return addEvidence(d, c, {
    type: "MERCHANT_OVERRIDE",
    timestamp: d.clock,
    source: "Merchant decision",
    rawContent: text,
    structuredExtraction: { kind: "MERCHANT_OVERRIDE", data: { chosenState: chosen, fromProposedState: from } },
    isSynthetic: false,
  });
}

export function approveAction(w: WorldState, actionId: string, approver = "Merchant (demo)"): WorldState {
  return mutate(w, (d) => {
    const a = d.actions[actionId];
    if (!a) throw new EngineError("Unknown action");
    if (a.status !== "REVIEW_REQUIRED" && a.status !== "PROPOSED") {
      throw new EngineError(`Action is ${a.status}; only proposed actions can be approved`);
    }
    const c = getCase(d, a.invoiceId);
    a.status = "APPROVED";
    a.approvedBy = approver;
    log(d, `${c.invoiceNumber}: ${a.type} approved by ${approver}`);

    if (a.type === "MATCH_PAYMENT") {
      const creditId = a.payload?.creditEvidenceId as string;
      const entry = d.bankFeed.find((f) => f.evidence.id === creditId);
      const credit = entry?.evidence.structuredExtraction?.kind === "BANK_CREDIT" ? entry.evidence.structuredExtraction.data : undefined;
      if (!entry || !credit) throw new EngineError("Matched credit not found");
      entry.reconciled = true;
      c.outstandingAmount = Math.max(0, c.outstandingAmount - credit.amount);
      settlePromise(d, c, credit.valueDate);
      const confirm = merchantEvidence(d, c, `Merchant confirmed the bank credit (${entry.evidence.rawContent}) pays ${c.invoiceNumber}.`, "RESOLVED", "PAID_UNMATCHED");
      a.status = "EXECUTED";
      a.executedAt = d.clock;
      a.result = "Reconciled";
      if (c.outstandingAmount <= 0) {
        transition(d, c, {
          to: "RESOLVED",
          initiatedBy: "MERCHANT",
          triggerType: "MERCHANT_DECISION",
          evidenceIds: [creditId, confirm.id],
          reasonCode: "MATCH_CONFIRMED",
          humanReadableReason: "Merchant confirmed the bank credit. Invoice reconciled.",
        });
        onEnterState(d, c, [confirm.id]);
      }
    } else if (a.type === "DRAFT_CORRECTION") {
      if (c.workflow?.correction) {
        c.workflow.correction.status = "APPROVED";
        c.workflow.correction.approvedBy = approver;
      }
      a.status = "EXECUTED";
      a.executedAt = d.clock;
      a.result = "Correction approved by Accounts. Resolve does not issue tax documents — mark it issued once your billing system has issued it.";
    } else if (a.type === "CREATE_CHILD_INVOICE") {
      const disputed = Number(a.payload?.disputedAmount);
      const { child } = splitInvoice(c, disputed, {
        now: d.clock,
        childId: nextId(d, "inv"),
        noteEvidenceId: nextId(d, "ev"),
        childEvidenceId: nextId(d, "ev"),
        childTransitionId: nextId(d, "tr"),
      });
      d.cases[child.id] = child;
      d.caseOrder.splice(d.caseOrder.indexOf(c.id) + 1, 0, child.id);
      a.status = "EXECUTED";
      a.executedAt = d.clock;
      a.result = `Child receivable ${child.invoiceNumber} created for ${formatINR(child.amount)} (follow-up active)`;
      onEnterState(d, child, [child.evidence[0].id]);
    } else if (a.type === "CREATE_PART_PAYMENT_LINK") {
      if (!c.paymentPlan || c.paymentPlan.installments.length === 0 || c.paymentPlan.installments.some((i) => !i.dueDate)) {
        throw new EngineError("Every installment needs an amount and a date before approval — edit the plan first");
      }
      c.paymentPlan.status = "APPROVED";
      // Execution is asynchronous (Razorpay call): see beginExecution / completePaymentLink.
    } else {
      a.status = "EXECUTED";
      a.executedAt = d.clock;
    }
  });
}

export function rejectAction(w: WorldState, actionId: string, reason = "Rejected by merchant"): WorldState {
  return mutate(w, (d) => {
    const a = d.actions[actionId];
    if (!a || !OPEN_ACTION.includes(a.status)) throw new EngineError("Only open actions can be rejected");
    const c = getCase(d, a.invoiceId);
    a.status = "CANCELLED";
    a.result = reason;
    log(d, `${c.invoiceNumber}: ${a.type} rejected`);
    if (a.type === "MATCH_PAYMENT") {
      const creditId = a.payload?.creditEvidenceId as string;
      c.rejectedCreditIds = [...(c.rejectedCreditIds ?? []), creditId];
      const entry = d.bankFeed.find((f) => f.evidence.id === creditId);
      if (entry) entry.assignedTo = undefined;
      const ev = merchantEvidence(d, c, `Merchant: the bank credit is a different payment, not ${c.invoiceNumber}.`, "FOLLOW_UP_ACTIVE", "PAID_UNMATCHED");
      transition(d, c, {
        to: "FOLLOW_UP_ACTIVE",
        initiatedBy: "MERCHANT",
        triggerType: "MERCHANT_DECISION",
        evidenceIds: [ev.id],
        reasonCode: "MATCH_REJECTED",
        humanReadableReason: "Merchant says the credit is not this invoice's payment. Follow-up resumes.",
      });
      onEnterState(d, c, [ev.id]);
    } else if (a.type === "DRAFT_CORRECTION") {
      if (c.workflow?.correction) c.workflow.correction.status = "REJECTED";
    } else if (a.type === "CREATE_PART_PAYMENT_LINK") {
      if (c.paymentPlan) c.paymentPlan.status = "REJECTED";
      const ev = merchantEvidence(d, c, "Merchant rejected the proposed part-payment plan.", "FOLLOW_UP_ACTIVE", "CASH_CONSTRAINED");
      transition(d, c, {
        to: "FOLLOW_UP_ACTIVE",
        initiatedBy: "MERCHANT",
        triggerType: "MERCHANT_DECISION",
        evidenceIds: [ev.id],
        reasonCode: "PLAN_REJECTED",
        humanReadableReason: "Merchant rejected the part-payment plan. Standard follow-up resumes.",
      });
      onEnterState(d, c, [ev.id]);
    }
  });
}

/** Merchant edits the proposed part-payment plan; policy is re-evaluated. */
export function editPartPaymentPlan(
  w: WorldState,
  actionId: string,
  edit: { immediateAmount: number; remainderDate: string },
): WorldState {
  return mutate(w, (d) => {
    const a = d.actions[actionId];
    if (!a || a.type !== "CREATE_PART_PAYMENT_LINK" || !OPEN_ACTION.includes(a.status)) {
      throw new EngineError("Only an open part-payment proposal can be edited");
    }
    const c = getCase(d, a.invoiceId);
    const plan = c.paymentPlan!;
    const firstDate = plan.installments[0]?.dueDate || istDate(d.clock);
    plan.installments = [
      { id: nextId(d, "inst"), amount: edit.immediateAmount, dueDate: firstDate, status: "PENDING" },
      { id: nextId(d, "inst"), amount: c.outstandingAmount - edit.immediateAmount, dueDate: edit.remainderDate, status: "PENDING" },
    ];
    plan.status = "PROPOSED";
    a.status = "CANCELLED";
    a.result = "Superseded by merchant edit";
    proposePartPayment(d, c, a.evidenceIds);
  });
}

/**
 * Called immediately before a buyer-facing action is sent. Re-checks payment and
 * policy; a payment detected now blocks the action and re-evaluates state.
 */
export function beginExecution(w: WorldState, actionId: string): WorldState {
  return mutate(w, (d) => {
    const a = d.actions[actionId];
    if (!a) throw new EngineError("Unknown action");
    if (a.status !== "APPROVED") throw new EngineError(`Action must be APPROVED to execute (is ${a.status})`);
    if (FINANCIAL_OR_DOCUMENT_ACTIONS.includes(a.type) && !a.approvedBy) throw new EngineError("Approval required");
    const c = getCase(d, a.invoiceId);
    const plan = c.paymentPlan;
    const pe = evaluate(d, c, {
      type: a.type,
      immediateAmount: plan?.installments[0]?.amount,
      finalDate: plan?.installments[1]?.dueDate || undefined,
    });
    const blocking = pe.checks.filter((x) => !x.passed && x.severity === "BLOCK");
    a.policyEvaluation = pe;
    if (blocking.length) {
      a.status = "BLOCKED";
      a.result = `Blocked at send time: ${blocking.map((b) => b.label).join("; ")}`;
      log(d, `${c.invoiceNumber}: ${a.type} blocked at send time`);
      if (blocking.some((b) => b.code === "PAYMENT_RECHECK")) runMatchingForCase(d, c);
      return;
    }
    a.status = "EXECUTING";
  });
}

export function completePaymentLink(w: WorldState, actionId: string, link: PaymentLinkRecord): WorldState {
  return mutate(w, (d) => {
    const a = d.actions[actionId];
    if (!a || a.status !== "EXECUTING") throw new EngineError("Action is not executing");
    const c = getCase(d, a.invoiceId);
    const plan = c.paymentPlan!;
    plan.paymentLink = link;
    plan.status = "ACTIVE";
    for (const inst of plan.installments) {
      inst.paymentLink = link;
      schedule(d.timers, {
        id: nextId(d, "tmr"),
        invoiceId: c.id,
        kind: "INSTALLMENT_DUE",
        fireAt: promiseDeadline(inst.dueDate, d.policy.promiseGracePeriodHours),
        payload: { installmentId: inst.id },
        createdAt: d.clock,
      });
    }
    a.status = "EXECUTED";
    a.executedAt = d.clock;
    a.result = `${link.mode === "TEST_MODE" ? "Razorpay test-mode" : "Simulated"} payment link ${link.id} created (${link.shortUrl})`;
    log(d, `${c.invoiceNumber}: ${a.result}`);
  });
}

export function failExecution(w: WorldState, actionId: string, error: string): WorldState {
  return mutate(w, (d) => {
    const a = d.actions[actionId];
    if (!a) throw new EngineError("Unknown action");
    a.status = "FAILED";
    a.result = error;
  });
}

export function markCorrectionIssued(w: WorldState, caseId: string): WorldState {
  return mutate(w, (d) => {
    const c = getCase(d, caseId);
    if (c.currentState !== "PAPERWORK_BLOCKED") throw new EngineError("Case is not paperwork-blocked");
    if (c.workflow?.correction?.status !== "APPROVED") throw new EngineError("Correction must be approved first");
    c.workflow.correction.status = "ISSUED";
    c.workflow.correction.issuedAt = d.clock;
    const ev = addEvidence(d, c, {
      type: "MANUAL_NOTE",
      timestamp: d.clock,
      source: "Merchant (Accounts)",
      rawContent: "Corrected document issued by Accounts in the billing system and shared with the buyer.",
      isSynthetic: false,
    });
    log(d, `${c.invoiceNumber}: correction marked issued`);
    if (c.outstandingAmount > 0) {
      transition(d, c, {
        to: "FOLLOW_UP_ACTIVE",
        initiatedBy: "MERCHANT",
        triggerType: "MERCHANT_DECISION",
        evidenceIds: [ev.id],
        reasonCode: "CORRECTION_ISSUED",
        humanReadableReason: "Correction issued and invoice still unpaid. Standard follow-up resumes.",
      });
      onEnterState(d, c, [ev.id]);
    }
  });
}

/** Merchant classifies a NEEDS_REVIEW case (or reclassifies a blocker). Recorded as an override. */
export function classifyCase(
  w: WorldState,
  caseId: string,
  chosen: InvoiceState,
  opts: { note?: string; promiseDate?: string } = {},
): WorldState {
  return mutate(w, (d) => {
    const c = getCase(d, caseId);
    const aiProposed = c.understanding?.proposedState;
    const from = c.currentState;
    const ev = merchantEvidence(
      d,
      c,
      `Merchant classified the case as ${STATE_META[chosen].label}${opts.note ? ` — ${opts.note}` : ""}.`,
      chosen,
      aiProposed,
    );
    if (chosen === "PROMISE_TO_PAY") {
      const date =
        opts.promiseDate ??
        (c.understanding && promiseDateFrom(c.understanding)?.date) ??
        c.understanding?.temporalExpressions.find((t) => t.lowerBound)?.lowerBound;
      if (!date) throw new EngineError("A promise date is required");
      const src = [...c.evidence].reverse().find((e) => TEXTUAL_BUYER_EVIDENCE.includes(e.type));
      c.promiseToPay = {
        promisedDate: date,
        datePrecision: "DAY",
        sourceEvidenceId: src?.id ?? ev.id,
        status: "ACTIVE",
        createdAt: d.clock,
        deadlineAt: promiseDeadline(date, d.policy.promiseGracePeriodHours),
      };
    }
    transition(d, c, {
      to: chosen,
      initiatedBy: "MERCHANT",
      triggerType: "MERCHANT_DECISION",
      evidenceIds: [ev.id, ...c.evidence.filter((e) => TEXTUAL_BUYER_EVIDENCE.includes(e.type)).slice(-1).map((e) => e.id)],
      reasonCode: from === "NEEDS_REVIEW" ? "MERCHANT_CLASSIFIED" : "MERCHANT_OVERRIDE",
      humanReadableReason: `Merchant classified this case as ${STATE_META[chosen].label}.${opts.note ? ` ${opts.note}` : ""}`,
    });
    if (aiProposed) {
      d.labelledReviewSet.push({
        invoiceId: c.id,
        evidenceIds: ev ? [ev.id] : [],
        aiProposedState: from === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : aiProposed,
        merchantState: chosen,
        labelledAt: d.clock,
        note: "Added to labelled review set. Not used for automatic retraining.",
      });
    }
    onEnterState(d, c, [ev.id]);
  });
}

export function updatePolicy(w: WorldState, patch: Partial<Omit<MerchantPolicy, "version">>): WorldState {
  return mutate(w, (d) => {
    d.policy = { ...d.policy, ...patch, version: d.policy.version + 1 } as MerchantPolicy;
    log(d, `Merchant policy updated (${policyVersion(d.policy)})`);
    for (const a of Object.values(d.actions)) {
      if (!["PROPOSED", "REVIEW_REQUIRED", "BLOCKED"].includes(a.status)) continue;
      if (a.status === "BLOCKED" && a.result?.startsWith("Blocked at send time")) continue;
      const c = d.cases[a.invoiceId];
      if (!c || c.currentState === "RESOLVED") continue;
      const plan = c.paymentPlan;
      const pe = evaluate(d, c, {
        type: a.type,
        immediateAmount: a.type === "CREATE_PART_PAYMENT_LINK" ? plan?.installments[0]?.amount : undefined,
        finalDate: a.type === "CREATE_PART_PAYMENT_LINK" ? plan?.installments[1]?.dueDate || undefined : undefined,
      });
      a.policyEvaluation = pe;
      a.status = pe.decision === "BLOCK" ? "BLOCKED" : "REVIEW_REQUIRED";
    }
  });
}

// ---------------------------------------------------------------------------
// read models

export function nextActionLabel(w: WorldState, c: InvoiceCase): string {
  const open = openActionsFor(w, c.id);
  switch (c.currentState) {
    case "FOLLOW_UP_ACTIVE":
      return c.workflow?.followUpPaused ? "Follow-up blocked by policy" : "Back to Receivables Agent follow-up";
    case "PAID_UNMATCHED":
      return "Confirm bank match";
    case "PAPERWORK_BLOCKED": {
      const s = c.workflow?.correction?.status;
      if (s === "DRAFTED") return "Accounts: approve correction";
      if (s === "APPROVED") return "Mark corrected invoice issued";
      if (s === "REJECTED") return "Correction rejected — reclassify";
      return "Route to Accounts";
    }
    case "CASH_CONSTRAINED": {
      const plan = c.paymentPlan;
      if (plan?.status === "ACTIVE") {
        const nextInst = plan.installments.find((i) => i.status === "PENDING");
        return nextInst ? `Await ${formatINR(nextInst.amount)} by ${formatDate(nextInst.dueDate)}` : "Plan complete";
      }
      if (open.some((a) => a.type === "CREATE_PART_PAYMENT_LINK" && a.status === "BLOCKED")) return "Plan outside policy";
      return "Review part-payment plan";
    }
    case "PROMISE_TO_PAY":
      return c.promiseToPay ? `Wait until ${formatDate(c.promiseToPay.promisedDate)}` : "Wait";
    case "NEEDS_REVIEW":
      return "Classify blocker";
    case "COMMERCIAL_DISPUTE":
      return open.some((a) => a.type === "CREATE_CHILD_INVOICE") ? "Review split of undisputed amount" : "Sales to resolve dispute";
    case "RESOLVED":
      return "None";
  }
}

export function lastEvidence(c: InvoiceCase): Evidence | undefined {
  return [...c.evidence]
    .filter((e) => e.type !== "INVOICE_DATA")
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    .at(-1);
}
