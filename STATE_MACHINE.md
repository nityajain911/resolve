# State machine

Every invoice has exactly **one** `currentState`. Only `applyTransition()` in
`domain/state-machine.ts` writes it, and only along edges in `ALLOWED_TRANSITIONS`.

## States

| State | Buyer contact | Meaning |
|---|---|---|
| `FOLLOW_UP_ACTIVE` | Allowed | No blocker; standard Receivables Agent follow-up |
| `PAID_UNMATCHED` | Blocked | Bank credit strongly matches, not reconciled |
| `PAPERWORK_BLOCKED` | Blocked | Document / tax-data problem |
| `CASH_CONSTRAINED` | Blocked (plan replaces reminders) | Split / extension requested |
| `PROMISE_TO_PAY` | Blocked (waiting) | Dated promise |
| `NEEDS_REVIEW` | Blocked | Mixed / ambiguous — human classifies |
| `COMMERCIAL_DISPUTE` | Blocked | Goods / price dispute; routed to Sales |
| `RESOLVED` | All collection blocked | Paid and reconciled (terminal) |

## Allowed transitions (who may initiate)

| From | To | Initiator | Condition |
|---|---|---|---|
| (open) | FOLLOW_UP_ACTIVE | RULE | Simulated Receivables Agent handoff |
| FOLLOW_UP_ACTIVE | PAID_UNMATCHED | RULE | STRONG bank match (amount + invoice reference); bank-credit evidence required |
| FOLLOW_UP_ACTIVE / blockers | NEEDS_REVIEW | RULE | POSSIBLE bank match (amount + payer, no reference) — `POSSIBLE_BANK_MATCH` |
| FOLLOW_UP_ACTIVE | PAPERWORK_BLOCKED / CASH_CONSTRAINED / PROMISE_TO_PAY / COMMERCIAL_DISPUTE | AI (HIGH only), MERCHANT | |
| FOLLOW_UP_ACTIVE | NEEDS_REVIEW | AI, RULE, MERCHANT | |
| PAID_UNMATCHED | RESOLVED | MERCHANT, PAYMENT_EVENT | Match confirmed; outstanding = 0 |
| PAID_UNMATCHED | FOLLOW_UP_ACTIVE | MERCHANT | "Not the same payment" |
| PAPERWORK_BLOCKED | FOLLOW_UP_ACTIVE | MERCHANT | Correction approved **and issued**; still unpaid |
| CASH_CONSTRAINED | FOLLOW_UP_ACTIVE | TIMER, MERCHANT | Installment missed (plan broken) / plan rejected |
| PROMISE_TO_PAY | FOLLOW_UP_ACTIVE | TIMER, MERCHANT | Promised date + grace passed unpaid (promise BROKEN) |
| blocker states | NEEDS_REVIEW | AI, RULE, MERCHANT | Conflicting new evidence |
| blocker states | other blocker state | MERCHANT | Reclassification (override, audited) |
| NEEDS_REVIEW | any non-resolved state | MERCHANT only | Human classification |
| any blocker / NEEDS_REVIEW | PAID_UNMATCHED | RULE | Bank credit arrives |
| any non-resolved | RESOLVED | PAYMENT_EVENT, MERCHANT | Full payment reconciled |
| RESOLVED | — | — | Terminal |

Guards enforced for every transition: at least one evidence id, all ids exist on the case, AI
needs HIGH confidence (except into NEEDS_REVIEW), RESOLVED needs zero outstanding, follow-up can
never resume on a paid invoice. The AI can never reach PAID_UNMATCHED or RESOLVED: a buyer
saying "paid" triggers the bank-matching rule, and if no credit matches the case goes to
NEEDS_REVIEW.

## Guards between the AI and any transition

- **Financial invariants** (`domain/understanding-invariants.ts`), applied to every
  CaseUnderstanding from any provider: implausible amounts (> 3× invoice), amount exceeding the
  outstanding, "now" amount covering the whole balance, split parts exceeding the balance, negative
  remainder, disputed amount exceeding the balance. Any violation → NEEDS_REVIEW with that code
  (e.g. `AMOUNT_EXCEEDS_OUTSTANDING`).
- **Amount extraction** only accepts typed money (₹/Rs/INR, K/L/lakh/Cr, Indian digit grouping) or a
  bare number with money context; numbers inside tokens or after UTR / txn / ref / account / GSTIN /
  IFSC / UPI / cheque / invoice / PO are never amounts; unit rates ("₹2 per box") are skipped.

## Assessments vs transitions

`CaseAssessment` snapshots record confidence and evidence strength (single source / corroborated /
conflicting). New evidence can update the assessment without a transition — e.g. the imported IMS
file for SCP-1057 adds "Assessment updated — corroborating IMS evidence received" while the state
stays PAPERWORK_BLOCKED.

## Follow-up suppression

`followUpSuppressedUntil` is stored explicitly (promise: promised day end + grace; active plan: next
installment day end + grace) and checked by the policy engine before any reminder
(`FOLLOW_UP_SUPPRESSED`). It is cleared when follow-up resumes or the invoice resolves.

## Idempotency

Approve / reject / confirm-match / correction-issued / split are no-ops when repeated; payment events
de-duplicate on `paymentId`, bank credits on `bankTxnId`; classifications accept an idempotency key
derived from the displayed case version; link completion and timers are retry-safe. Razorpay links
use a stable `reference_id` per plan and browser session, and an existing link is looked up and
reused before creating a new one.

## Policy snapshots

Each `PolicyEvaluation` stores the policy version and the thresholds used. Approving an action whose
evaluation is from an older policy version re-runs the policy first; if it is now outside policy the
approval is refused and recorded.

## Evidence

`BUYER_MESSAGE`, `BUYER_EMAIL`, `VOICE_NOTE_TRANSCRIPT`, `SCREENSHOT_TEXT`, `BANK_CREDIT`,
`PAYMENT_EVENT`, `IMS_IMPORT`, `INVOICE_DATA`, `MANUAL_NOTE`, `MERCHANT_OVERRIDE`. Each
`StateTransition` records from/to, timestamp, trigger, evidence ids, initiator, reason code, a
human-readable reason, model version and policy version. The case timeline in the UI is this
audit trail, and every "Why?" link highlights evidence — never reasoning.

## Timers

`domain/timers.ts` holds `ScheduledEvent`s on world state; the engine fires them when the clock
advances (**Advance demo clock** in the UI). All dates are Asia/Kolkata.

- **Promise deadline** = end of the promised IST day + grace (default 24h; 12h or 24h in Policy).
  On fire: re-check payment (including pending bank credits) → paid: RESOLVED / KEPT; unpaid:
  FOLLOW_UP_ACTIVE / BROKEN, buyer history updated (e.g. 3/3 → 3/4 kept).
- **Installment due** = end of installment day + grace. Missed → plan BROKEN → FOLLOW_UP_ACTIVE.
- Leaving a state cancels its pending timers and open proposals.

## Invoice splitting

A partially disputed invoice is never given two states. On an approved `CREATE_CHILD_INVOICE`:
the parent stays `COMMERCIAL_DISPUTE` with only the disputed amount outstanding, and a child
receivable (`<number>-A`, `parentInvoiceId` set) is created in `FOLLOW_UP_ACTIVE` for the
undisputed amount. Invariant: parent + child outstanding = parent outstanding before the split
(`tests/split.test.ts`).
