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
| FOLLOW_UP_ACTIVE | PAID_UNMATCHED | RULE | Strong bank match; bank-credit evidence required |
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
