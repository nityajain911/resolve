# Product decisions

## Why Resolve is not the Receivables Agent

Razorpay's Receivables Agent is the first-line collections layer: reminders, calls, follow-up,
escalation. It assumes *overdue → remind → remind harder → escalate*. That is right for the
invoice a buyer simply forgot.

It is wrong for invoices that are late for a reason: payment already made but unmatched, wrong
GSTIN, missing PO, a cash squeeze, a dated promise, a dispute. Another reminder is useless there,
and sometimes harmful (chasing a buyer who has paid, or who is disputing the goods).

Resolve starts **after** standard follow-up fails and asks one question:

> What is actually preventing this invoice from being paid, and what is the minimum action that removes that blocker?

It then either resolves the blocker or **hands the invoice back** to the Receivables Agent.
Resolve does not send reminders itself — it gates them.

## MVP: four deep flows + one safety state

| Flow | Trigger | Resolve does | Human step |
|---|---|---|---|
| Paid but unmatched | Bank credit strongly matches (rule) | Stop follow-up; show credit + rationale | Confirm match / Not the same payment |
| Paperwork blocked | Buyer states a document problem (AI); IMS corroborates | Pause reminders; route to Accounts; draft correction | Accountant approves; merchant marks issued |
| Cash constrained | Buyer proposes amount now + later date | Extract plan; policy check | Approve → part-payment link |
| Promise to pay | Dated promise | Wait; timer at deadline + grace | None, unless it breaks |
| Needs review | Mixed / ambiguous signals | No buyer message | Merchant classifies |

`COMMERCIAL_DISPUTE` exists in the state model (with invoice splitting) but is not a deep flow.

## Non-goals

Generic reminder scheduling · another WhatsApp bot · recovery probabilities · credit
underwriting · Tally replacement · GST filing · live IMS API · TReDS · autonomous credit notes or
corrected tax invoices · DSO forecasting · a collection-uplift simulator · production auth.

## AI vs rules

AI handles what rules cannot: Hinglish/English replies, spelling errors, screenshots and
voice-note text, amounts and dates in free text, mixed signals. It outputs a `CaseUnderstanding`
with a confidence **band** (HIGH or NEEDS_REVIEW) and a short evidence-citing explanation — no
chain of thought.

Rules handle everything checkable: bank matching, payment recheck, never-contact list, maximum
extension, minimum part payment, approval requirements, contact caps, timer expiry. The state
machine forbids the AI from marking invoices paid or resolved, and requires HIGH confidence for
any AI-initiated move into a blocker state. Financial and document actions always need approval.

## Why no recovery probability

A "72% likely to pay" score invites false precision, cannot be validated on synthetic data, and
does not tell the merchant what to *do*. Resolve shows the blocker, the evidence and plain
counts ("kept 3 of 3 previous promises").

## Why no simulated collection result

Whether a buyer pays after a resolution action depends on real behaviour. Any "₹X collected" or
"Y% faster" from this prototype would be an assumption dressed as a result. The prototype reports
only countable outcomes (wrong chases avoided, routing, overrides, promise counts). Cash uplift
is the **pilot metric**, measured against a reminder-only holdout.

## Learning loop

Resolve learns through state, not retraining: promise history updates in plain counts, merchant
classifications are recorded as overrides and added to a labelled review set. Nothing retrains
automatically; any prompt or model change is a new version that must be evaluated first.
