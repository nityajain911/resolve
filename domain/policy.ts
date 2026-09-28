import { STATE_META } from "./state-machine";
import { addDays, daysBetween, istDate } from "./time";
import { formatINR } from "./money";
import type {
  ActionType,
  InvoiceCase,
  InvoiceState,
  MerchantPolicy,
  PolicyCheck,
  PolicyDecision,
  PolicyEvaluation,
} from "./types";

/**
 * Deterministic policy engine. The AI never calls this with authority — it only
 * produces a CaseUnderstanding. Every proposed action (AI- or rule-originated) is
 * evaluated here, and buyer-facing actions are re-evaluated immediately before
 * execution with a fresh payment recheck.
 */

export const DEFAULT_POLICY: MerchantPolicy = {
  version: 1,
  reviewFirst: true,
  allowPartPayments: true,
  minPartPaymentAmount: 50_000,
  maxExtensionDays: 30,
  correctedInvoiceRequiresApproval: true,
  creditNoteRequiresApproval: true,
  excludedBuyerIds: [],
  reminderFrequencyCap: 2,
  promiseGracePeriodHours: 24,
  pauseAllAutomation: false,
};

export const BUYER_FACING_ACTIONS: ActionType[] = ["SEND_REMINDER", "CREATE_PART_PAYMENT_LINK", "RESUME_FOLLOW_UP"];
export const FINANCIAL_OR_DOCUMENT_ACTIONS: ActionType[] = [
  "CREATE_PART_PAYMENT_LINK",
  "DRAFT_CORRECTION",
  "CREATE_CHILD_INVOICE",
  "MATCH_PAYMENT",
];

export interface ProposedAction {
  type: ActionType;
  /** Part payment: amount requested now. */
  immediateAmount?: number;
  /** Part payment / wait: the latest date in the proposed arrangement (YYYY-MM-DD). */
  finalDate?: string;
  /** Any buyer-facing text Resolve would send. */
  buyerMessage?: string;
}

export interface LatestPaymentStatus {
  outstandingAmount: number;
  /** A payment or matching bank credit arrived that the case has not yet absorbed. */
  newPaymentDetected: boolean;
  checkedAt: string;
}

/** Pressure / false-urgency language Resolve must never send. */
const PRESSURE_PATTERNS = [
  /legal action/i,
  /final (notice|warning|reminder)/i,
  /immediately/i,
  /last chance/i,
  /blacklist/i,
  /credit (score|rating)/i,
  /within \d+ hours?/i,
  /urgent/i,
  /failure to pay/i,
];

export function toneViolations(text: string): string[] {
  return PRESSURE_PATTERNS.filter((p) => p.test(text)).map((p) => p.source);
}

/** States in which a given buyer-facing action may be taken at all. */
const STATE_GATE: Partial<Record<ActionType, InvoiceState[]>> = {
  SEND_REMINDER: ["FOLLOW_UP_ACTIVE"],
  CREATE_PART_PAYMENT_LINK: ["CASH_CONSTRAINED"],
  RESUME_FOLLOW_UP: ["FOLLOW_UP_ACTIVE", "PROMISE_TO_PAY", "CASH_CONSTRAINED", "PAPERWORK_BLOCKED"],
};

const STATE_BLOCK_REASON: Record<InvoiceState, string> = {
  FOLLOW_UP_ACTIVE: "STATE_FOLLOW_UP_ACTIVE",
  PAID_UNMATCHED: "STATE_PAID_UNMATCHED_BLOCKS_CONTACT",
  PAPERWORK_BLOCKED: "STATE_PAPERWORK_BLOCKS_REMINDER",
  CASH_CONSTRAINED: "STATE_CASH_PLAN_REPLACES_REMINDER",
  PROMISE_TO_PAY: "STATE_WAITING_ON_PROMISE",
  NEEDS_REVIEW: "STATE_NEEDS_REVIEW_BLOCKS_CONTACT",
  COMMERCIAL_DISPUTE: "STATE_DISPUTE_BLOCKS_CONTACT",
  RESOLVED: "STATE_RESOLVED_BLOCKS_COLLECTION",
};

export function remindersInLast7Days(c: InvoiceCase, now: string): number {
  const cutoff = addDays(istDate(now), -7);
  return c.receivablesHandoff.reminderHistory.filter((r) => r.channel !== "CALL" && istDate(r.at) > cutoff).length;
}

export function evaluateAction(args: {
  invoiceCase: InvoiceCase;
  proposedAction: ProposedAction;
  merchantPolicy: MerchantPolicy;
  latestPaymentStatus: LatestPaymentStatus;
  now: string;
}): PolicyEvaluation {
  const { invoiceCase: c, proposedAction: a, merchantPolicy: p, latestPaymentStatus: pay, now } = args;
  const checks: PolicyCheck[] = [];
  const add = (code: string, label: string, passed: boolean, severity: PolicyCheck["severity"] = "BLOCK") =>
    checks.push({ code, label, passed, severity });

  const buyerFacing = BUYER_FACING_ACTIONS.includes(a.type);
  const state = c.currentState;

  // RESOLVED blocks every collection action.
  if (state === "RESOLVED" && a.type !== "STOP_FOLLOW_UP") {
    add("STATE_RESOLVED_BLOCKS_COLLECTION", "Invoice is resolved — no collection action", false);
    return finish(checks, p, now);
  }

  if (buyerFacing) {
    // 1. Re-check payment state.
    add(
      "PAYMENT_RECHECK",
      pay.newPaymentDetected
        ? "Payment detected on recheck — action blocked, state will be re-evaluated"
        : `Payment re-checked: ${formatINR(pay.outstandingAmount)} still unpaid`,
      !pay.newPaymentDetected && pay.outstandingAmount > 0,
    );
    // 2. Check invoice state.
    const allowedStates = STATE_GATE[a.type] ?? [];
    const stateOk = allowedStates.includes(state);
    add(
      stateOk ? "STATE_OK" : STATE_BLOCK_REASON[state],
      stateOk
        ? `Invoice state ${STATE_META[state].label} permits this action`
        : `${STATE_META[state].label}: ${STATE_META[state].description}`,
      stateOk,
    );
    // 3. Excluded buyer.
    const excluded = p.excludedBuyerIds.includes(c.buyerId);
    add(
      "BUYER_EXCLUDED",
      excluded ? "Buyer is on the never-contact list" : "Buyer is not on the never-contact list",
      !excluded,
    );
    // Global pause.
    add(
      "AUTOMATION_PAUSED",
      p.pauseAllAutomation ? "Resolve is paused by the merchant" : "Resolve automation is on",
      !p.pauseAllAutomation,
    );
    // 6. Contact policy.
    if (a.type === "SEND_REMINDER") {
      const recent = remindersInLast7Days(c, now);
      add(
        "REMINDER_FREQUENCY_CAP",
        `${recent} reminder(s) in the last 7 days (cap ${p.reminderFrequencyCap})`,
        recent < p.reminderFrequencyCap,
      );
    }
    if (a.buyerMessage) {
      const v = toneViolations(a.buyerMessage);
      add("NO_PRESSURE_LANGUAGE", v.length ? `Message contains pressure language (${v.join(", ")})` : "No pressure or false-urgency language", v.length === 0);
    }
  }

  // 5. Amount / date limits for part payments.
  if (a.type === "CREATE_PART_PAYMENT_LINK") {
    add("PART_PAYMENT_ALLOWED", p.allowPartPayments ? "Part payments are allowed" : "Part payments are disabled", p.allowPartPayments);
    const imm = a.immediateAmount ?? 0;
    add(
      "MIN_PART_PAYMENT",
      `${formatINR(imm)} ${imm >= p.minPartPaymentAmount ? "meets" : "is below"} the ${formatINR(p.minPartPaymentAmount)} minimum`,
      imm >= p.minPartPaymentAmount,
    );
    add("PART_BELOW_OUTSTANDING", "Immediate amount is less than the outstanding balance", imm > 0 && imm < pay.outstandingAmount);
    if (a.finalDate) {
      const ext = daysBetween(istDate(now), a.finalDate);
      add(
        "MAX_EXTENSION",
        `Final payment ${ext} day(s) out (limit ${p.maxExtensionDays})`,
        ext <= p.maxExtensionDays,
      );
    } else {
      add("MAX_EXTENSION", "No final date for the remainder — needs a date before approval", false, "REVIEW");
    }
  }

  if (a.type === "WAIT_UNTIL_DATE" && a.finalDate) {
    const ext = daysBetween(istDate(now), a.finalDate);
    add("MAX_EXTENSION", `Waiting ${ext} day(s) (limit ${p.maxExtensionDays})`, ext <= p.maxExtensionDays, "REVIEW");
  }

  // 4. Review-first and mandatory approvals.
  if (a.type === "DRAFT_CORRECTION") {
    add("CORRECTION_REQUIRES_APPROVAL", "Corrected invoice requires accountant approval", false, "REVIEW");
  }
  if (a.type === "CREATE_CHILD_INVOICE") {
    add("CREDIT_NOTE_REQUIRES_APPROVAL", "Splitting / credit note requires merchant approval", false, "REVIEW");
  }
  if (a.type === "MATCH_PAYMENT") {
    add("RECONCILIATION_REQUIRES_CONFIRMATION", "Merchant must confirm the bank credit before reconciling", false, "REVIEW");
  }
  if (a.type === "CREATE_PART_PAYMENT_LINK") {
    add(
      "REVIEW_FIRST",
      p.reviewFirst ? "Review-first mode: merchant approval required" : "Review-first mode is off",
      !p.reviewFirst,
      "REVIEW",
    );
  }
  if (p.pauseAllAutomation && !buyerFacing && !["STOP_FOLLOW_UP", "REQUEST_HUMAN_REVIEW"].includes(a.type)) {
    add("AUTOMATION_PAUSED", "Resolve is paused — merchant must act manually", false, "REVIEW");
  }

  return finish(checks, p, now);
}

function finish(checks: PolicyCheck[], p: MerchantPolicy, now: string): PolicyEvaluation {
  const failed = checks.filter((c) => !c.passed);
  let decision: PolicyDecision = "ALLOW";
  if (failed.some((c) => c.severity === "BLOCK")) decision = "BLOCK";
  else if (failed.some((c) => c.severity === "REVIEW")) decision = "REVIEW_REQUIRED";
  return {
    decision,
    reasonCodes: failed.length ? failed.map((c) => c.code) : ["ALL_CHECKS_PASSED"],
    checks,
    policyVersion: policyVersion(p),
    evaluatedAt: now,
  };
}

export function policyVersion(p: MerchantPolicy): string {
  return `merchant-policy@v${p.version}`;
}
