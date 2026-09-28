/**
 * Core domain types for Resolve.
 *
 * Design principle: the invoice STATE is the source of truth. Every InvoiceCase has
 * exactly one `currentState`, and every change to it is a StateTransition backed by
 * Evidence. Nothing in this module (or anything under /domain) may read hidden
 * synthetic ground truth — see tests/ground-truth-isolation.test.ts.
 */

export const INVOICE_STATES = [
  "FOLLOW_UP_ACTIVE",
  "PAID_UNMATCHED",
  "PAPERWORK_BLOCKED",
  "CASH_CONSTRAINED",
  "PROMISE_TO_PAY",
  "NEEDS_REVIEW",
  "COMMERCIAL_DISPUTE",
  "RESOLVED",
] as const;
export type InvoiceState = (typeof INVOICE_STATES)[number];

export const EVIDENCE_TYPES = [
  "BUYER_MESSAGE",
  "BUYER_EMAIL",
  "VOICE_NOTE_TRANSCRIPT",
  "SCREENSHOT_TEXT",
  "BANK_CREDIT",
  "PAYMENT_EVENT",
  "IMS_IMPORT",
  "INVOICE_DATA",
  "MANUAL_NOTE",
  "MERCHANT_OVERRIDE",
] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** Evidence types whose text the classifier is allowed to interpret. */
export const TEXTUAL_BUYER_EVIDENCE: EvidenceType[] = [
  "BUYER_MESSAGE",
  "BUYER_EMAIL",
  "VOICE_NOTE_TRANSCRIPT",
  "SCREENSHOT_TEXT",
];

export type ConfidenceBand = "HIGH" | "NEEDS_REVIEW";

export type TemporalType =
  | "EXACT_DATE"
  | "DATE_RANGE"
  | "AFTER_DATE"
  | "RELATIVE_DATE"
  | "AMBIGUOUS";

/** Dates are ISO calendar dates (YYYY-MM-DD) in Asia/Kolkata. */
export interface TemporalExpression {
  rawText: string;
  type: TemporalType;
  normalizedDate?: string;
  lowerBound?: string;
  upperBound?: string;
  confidenceBand: ConfidenceBand;
  /** Short note on how the expression was resolved (never chain-of-thought). */
  resolutionNote?: string;
}

export type AmountRole = "IMMEDIATE" | "REMAINDER" | "TOTAL" | "DISPUTED" | "UNDISPUTED" | "PAID" | "UNSPECIFIED";

export interface ExtractedAmount {
  rawText: string;
  amount: number; // rupees
  role: AmountRole;
}

export interface BankCreditData {
  amount: number;
  payerName: string;
  reference: string;
  valueDate: string; // ISO timestamp
  bankTxnId: string;
}

export interface PaymentEventData {
  amount: number;
  channel: "RAZORPAY_PAYMENT_LINK" | "RAZORPAY_PAYMENT" | "SIMULATED";
  reference?: string;
  /** Payment events tied to an invoice reference are reconciled by construction. */
  reconciled: boolean;
}

export interface ImsImportData {
  gstinOfSupplier: string;
  invoiceNumber: string;
  action: "ACCEPTED" | "REJECTED" | "PENDING";
  remark?: string;
  importedFile: string;
}

export interface InvoiceData {
  billedGstin: string;
  poNumber?: string;
  lineItems: { description: string; qty: number; rate: number }[];
}

export interface MerchantOverrideData {
  fromProposedState?: InvoiceState;
  chosenState: InvoiceState;
  note?: string;
}

export interface Evidence {
  id: string;
  invoiceId: string;
  type: EvidenceType;
  timestamp: string; // ISO
  source: string; // e.g. "WhatsApp (captured)", "Bank statement import", "IMS export CSV"
  rawContent: string;
  structuredExtraction?:
    | { kind: "BANK_CREDIT"; data: BankCreditData }
    | { kind: "PAYMENT_EVENT"; data: PaymentEventData }
    | { kind: "IMS_IMPORT"; data: ImsImportData }
    | { kind: "INVOICE_DATA"; data: InvoiceData }
    | { kind: "MERCHANT_OVERRIDE"; data: MerchantOverrideData }
    | { kind: "UNDERSTANDING"; data: CaseUnderstanding };
  attachmentName?: string;
  isSynthetic: boolean;
}

export type Initiator = "AI" | "RULE" | "MERCHANT" | "TIMER" | "PAYMENT_EVENT";

export type TriggerType =
  | "HANDOFF"
  | "EVIDENCE"
  | "CLASSIFICATION"
  | "BANK_MATCH"
  | "MERCHANT_DECISION"
  | "TIMER"
  | "PAYMENT"
  | "SPLIT";

export interface StateTransition {
  id: string;
  invoiceId: string;
  fromState: InvoiceState | null; // null = case opened
  toState: InvoiceState;
  timestamp: string;
  triggerType: TriggerType;
  evidenceIds: string[];
  initiatedBy: Initiator;
  reasonCode: string;
  humanReadableReason: string;
  modelVersion?: string;
  policyVersion?: string;
}

export type PromiseStatus = "ACTIVE" | "KEPT" | "BROKEN";

export interface PromiseToPay {
  promisedAmount?: number;
  promisedDate: string; // YYYY-MM-DD (IST)
  datePrecision: "DAY" | "DEADLINE";
  sourceEvidenceId: string;
  status: PromiseStatus;
  createdAt: string;
  evaluatedAt?: string;
  deadlineAt: string; // ISO: end of promised day + grace
}

export interface Installment {
  id: string;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  status: "PENDING" | "PAID" | "MISSED";
  paymentLink?: PaymentLinkRecord;
  paidAt?: string;
}

export interface PaymentPlan {
  id: string;
  sourceEvidenceId: string;
  installments: Installment[];
  status: "PROPOSED" | "APPROVED" | "ACTIVE" | "COMPLETED" | "BROKEN" | "REJECTED";
  /** Outstanding when the plan was proposed; payments since then count toward installments. */
  startingOutstanding: number;
  paymentLink?: PaymentLinkRecord;
  createdAt: string;
}

export interface PaymentLinkRecord {
  mode: "TEST_MODE" | "SIMULATED";
  id: string;
  shortUrl: string;
  amount: number;
  acceptPartial: boolean;
  firstMinPartialAmount?: number;
  createdAt: string;
  /** Why a simulated link was used instead of a real test-mode link. */
  fallbackReason?: string;
}

export type ActionType =
  | "MATCH_PAYMENT"
  | "STOP_FOLLOW_UP"
  | "ROUTE_TO_ACCOUNTS"
  | "DRAFT_CORRECTION"
  | "CREATE_PART_PAYMENT_LINK"
  | "WAIT_UNTIL_DATE"
  | "RESUME_FOLLOW_UP"
  | "REQUEST_HUMAN_REVIEW"
  | "CREATE_CHILD_INVOICE"
  /** Standard reminder sent by the (simulated) Receivables Agent — gated by Resolve policy. */
  | "SEND_REMINDER";

export type ActionStatus =
  | "PROPOSED"
  | "REVIEW_REQUIRED"
  | "APPROVED"
  | "EXECUTING"
  | "EXECUTED"
  | "BLOCKED"
  | "CANCELLED"
  | "FAILED";

export type PolicyDecision = "ALLOW" | "REVIEW_REQUIRED" | "BLOCK";

export interface PolicyCheck {
  code: string;
  label: string;
  passed: boolean;
  /** When a failed check only requires review rather than blocking. */
  severity: "BLOCK" | "REVIEW" | "INFO";
}

export interface PolicyEvaluation {
  decision: PolicyDecision;
  reasonCodes: string[];
  checks: PolicyCheck[];
  policyVersion: string;
  evaluatedAt: string;
}

export interface ResolutionAction {
  id: string;
  invoiceId: string;
  type: ActionType;
  status: ActionStatus;
  proposedBy: Initiator;
  approvedBy?: string;
  createdAt: string;
  executedAt?: string;
  policyEvaluation: PolicyEvaluation;
  evidenceIds: string[];
  /** Human-readable description of what the action would do. */
  summary: string;
  payload?: Record<string, unknown>;
  result?: string;
}

export interface ReminderRecord {
  at: string;
  channel: "EMAIL" | "WHATSAPP" | "SMS" | "CALL";
  outcome: string;
}

export interface ReceivablesHandoff {
  /** Always SIMULATED in this prototype — there is no live Receivables Agent integration. */
  source: "SIMULATED_RECEIVABLES_AGENT";
  handedOffAt: string;
  remindersSent: number;
  callsMade: number;
  reminderHistory: ReminderRecord[];
  reason: string;
}

export interface BuyerContext {
  buyerId: string;
  name: string;
  gstin: string;
  city: string;
  aliases: string[];
  relationshipSince: string;
  promiseHistory: { made: number; kept: number; broken: number };
  contact: { email: string; phone: string };
}

export interface InvoiceCase {
  id: string;
  invoiceNumber: string;
  merchantId: string;
  buyerId: string;
  amount: number;
  outstandingAmount: number;
  issuedAt: string;
  dueAt: string;
  currentState: InvoiceState;
  stateEnteredAt: string;

  evidence: Evidence[];
  transitions: StateTransition[];

  promiseToPay?: PromiseToPay;
  paymentPlan?: PaymentPlan;
  workflow?: WorkflowState;
  policyEvaluation?: PolicyEvaluation;
  understanding?: CaseUnderstanding;
  buyerContext: BuyerContext;
  receivablesHandoff: ReceivablesHandoff;

  /** Split invoices: a child receivable links back to its parent. */
  parentInvoiceId?: string;
  childInvoiceIds?: string[];
  disputedAmount?: number;

  /** Bank credits the merchant rejected as "not the same payment". */
  rejectedCreditIds?: string[];
  /** Candidate states when in NEEDS_REVIEW. */
  reviewCandidates?: InvoiceState[];

  isDemoHero?: boolean;
  demoLabel?: string;

  createdAt: string;
  updatedAt: string;
}

export interface WorkflowState {
  routedTo?: "ACCOUNTS" | "SALES" | "COLLECTIONS";
  followUpPaused: boolean;
  correction?: {
    status: "DRAFTED" | "APPROVED" | "ISSUED" | "REJECTED";
    draft: string;
    approvedBy?: string;
    issuedAt?: string;
  };
  nextActionLabel?: string;
}

export interface MerchantPolicy {
  version: number;
  reviewFirst: boolean;
  allowPartPayments: boolean;
  minPartPaymentAmount: number;
  maxExtensionDays: number;
  correctedInvoiceRequiresApproval: true;
  creditNoteRequiresApproval: true;
  excludedBuyerIds: string[];
  reminderFrequencyCap: number; // max reminders per 7 days
  promiseGracePeriodHours: number;
  pauseAllAutomation: boolean;
}

// ---- Classifier contract (shared by demo + live providers) ----

export interface CaseUnderstanding {
  proposedState: InvoiceState;
  confidenceBand: ConfidenceBand;
  extractedAmounts: ExtractedAmount[];
  temporalExpressions: TemporalExpression[];
  entities: {
    blockerKind?:
      | "GSTIN"
      | "PO"
      | "INVOICE_FORMAT"
      | "SUPPORTING_DOC"
      | "QUALITY"
      | "QUANTITY"
      | "RATE"
      | "TDS"
      | "CASH_FLOW"
      | "PAYMENT_CLAIM"
      | "UNKNOWN";
    alternativeStates?: InvoiceState[];
    paymentClaimed?: boolean;
    documents?: string[];
  };
  evidenceUsed: string[];
  conciseExplanation: string;
  provider: string; // e.g. "demo-lexicon-v1" or "groq:openai/gpt-oss-120b"
  promptVersion?: string;
}

export interface ScheduledEvent {
  id: string;
  invoiceId: string;
  kind: "PROMISE_DEADLINE" | "INSTALLMENT_DUE";
  fireAt: string; // ISO
  status: "PENDING" | "FIRED" | "CANCELLED";
  payload: { installmentId?: string };
  createdAt: string;
  firedAt?: string;
  outcome?: string;
}

export interface LabelledReviewExample {
  invoiceId: string;
  evidenceIds: string[];
  aiProposedState?: InvoiceState;
  merchantState: InvoiceState;
  labelledAt: string;
  note: string;
}

export interface WorldState {
  seed: number;
  merchantId: string;
  merchantName: string;
  clock: string; // demo clock, ISO
  cases: Record<string, InvoiceCase>;
  caseOrder: string[];
  actions: Record<string, ResolutionAction>;
  timers: ScheduledEvent[];
  policy: MerchantPolicy;
  labelledReviewSet: LabelledReviewExample[];
  /** Per-buyer context (promise history lives here; cases hold a synced snapshot). */
  buyers: Record<string, BuyerContext>;
  /** Imported bank statement lines. Matching is a deterministic rule. */
  bankFeed: BankFeedEntry[];
  idCounter: number;
  activity: { at: string; text: string }[];
}

export interface BankFeedEntry {
  evidence: Evidence; // type BANK_CREDIT, invoiceId "" until assigned
  assignedTo?: string;
  reconciled: boolean;
}
