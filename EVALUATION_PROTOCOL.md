# Evaluation protocol

## 1. Headline prototype metric: wrong chases avoided

**Definition (strict, do not change silently):** a *wrong chase* is a collection message the
reminder-only baseline would send on an invoice that ground truth shows is **already paid** or
**in active commercial dispute**.

- *Reminder-only baseline:* sends the next standard reminder on every escalated invoice still
  open in the merchant ledger (not reconciled as paid).
- *Resolve blocks* a chase when its `SEND_REMINDER` policy gate is not ALLOW for a state,
  payment or exclusion reason at the evaluation snapshot. Blocks caused only by the reminder
  frequency cap do not count.
- `M` = wrong chases by the baseline; `N` = those Resolve blocks. Reported as
  *"Resolve blocked N of M wrong chases in this labelled synthetic invoice book."*
- Also reported: **remaining misses** with the reason (e.g. cash payment with no bank/payment
  signal), and **cost of caution** (follow-up paused on invoices with no real blocker).
- *Secondary metric* (reported separately): **avoidable follow-up** also counts invoices whose
  true blocker is paperwork.

Implementation: `evaluation/wrong-chase.ts`. Resolve's decisions come from `createWorld()` on
the observable book; hidden ground truth (`data/synthetic/ground-truth.ts`) is read only by the
harness. `tests/ground-truth-isolation.test.ts` fails if `/domain`, `/ai` or `/integrations`
reach synthetic data or the harness, or if the store, components or API routes import ground truth.

The book is designed so Resolve **cannot** be perfect: some payments (cash, undeposited cheque,
parent entity net of TDS) and one verbal dispute leave no usable signal. The metric uses the
deterministic demo classifier, which was developed alongside these synthetic messages, so it
measures the system design (states + policy + rules), not model accuracy.

## 2. Classifier evaluation: three separate sets

| Set | File | Use |
|---|---|---|
| Demo cases | synthetic book (`data/synthetic/generator.ts`) | Product walkthrough |
| Development set | `evaluation/development-cases.json` | Building/tuning the parser and prompt — **NOT held out** |
| Held-out set | `evaluation/heldout-cases.json` (not included) | Final evaluation, authored independently after the prompt freeze |

Claude Code wrote the development set and must not write the held-out set.
`evaluation/HELDOUT_INSTRUCTIONS.md` explains who should author it and how. Without it the UI
shows **"Held-out evaluation pending"** and no accuracy figure.

## 3. Prompt freeze and versioning

- Prompt: `ai/prompts/case-classifier-v1.md`; SHA-256 in `ai/prompts/PROMPT_LOCK.json`.
- `tests/eval-harness.test.ts` and `scripts/run-eval.ts` refuse a prompt that no longer
  matches its lock.
- Every report (`evaluation/reports/*.json`) records `promptVersion`, `promptHash`,
  `datasetHash` (SHA-256 of canonical JSON), `evaluationTimestamp`, and provider/model.
- **Once a held-out set has been evaluated, changing the prompt requires a new version
  (`case-classifier-v2.md`, never overwrite v1) and ideally a fresh held-out set.**

## 4. Metrics (never a single "AI accuracy")

- State classification accuracy, using the band-adjusted routing state (NEEDS_REVIEW band → NEEDS_REVIEW).
- Per-state precision, recall, F1 and a confusion matrix.
- Amount extraction exact match (set of distinct rupee amounts, including derived remainders).
- Temporal parsing exact match (type + dates), broken down by category.
- Ambiguous-expression handling: % of expected-ambiguous cases routed to NEEDS_REVIEW.
- Risk-weighted error count (below).

## 5. Relative-date testing

Relative dates are resolved against the **message timestamp** in Asia/Kolkata, never the device
clock. Required categories: `WEEKDAY`, `TOMORROW_KAL`, `PARSO`, `AFTER_15TH`, `NEXT_FRIDAY`,
`MONTH_BOUNDARY`, `WEEKEND_BOUNDARY` (plus `EXPLICIT_DATE`, `VAGUE`).

Resolution rules (`ai/temporal.ts`):

- **kal:** tomorrow; with past-tense markers ("kar diya tha"), yesterday.
- **parso:** forward (+2 days) only with an explicit future marker ("kar dunga", "denge", "tak",
  "will"); past markers → two days ago; otherwise `AMBIGUOUS` / NEEDS_REVIEW.
- **Weekday:** the next occurrence strictly after the message date; if the message was sent on
  that weekday → AMBIGUOUS.
- **next <weekday>:** AMBIGUOUS if the next occurrence falls in the same Mon–Sun week as the
  message (this week's or next week's?); otherwise that occurrence.
- **"15 ke baad" / "after the 15th":** `AFTER_DATE` with `lowerBound` = next 15th on or after the
  message date. It is **not** an exact promise date → NEEDS_REVIEW unless part of a clear split
  request (then the plan proposes the next day, editable).
- **Day-of-month that doesn't exist** ("31 tak" in September), or equal to the message day → NEEDS_REVIEW.
- **"next week", "this week", "jaldi", "few days":** imprecise → NEEDS_REVIEW.

## 6. Asymmetric error costs

Unitless weights, deliberately **not** rupees (`evaluation/cost-matrix.ts`):

| Error | Tier | Weight | Why |
|---|---|---|---|
| any blocker → FOLLOW_UP_ACTIVE | HIGH | 3 | merchant may wrongly chase |
| COMMERCIAL_DISPUTE → anything but NEEDS_REVIEW | HIGH | 3 | dispute handled as a payment matter |
| FOLLOW_UP_ACTIVE → blocker | MODERATE | 2 | follow-up paused without reason |
| NEEDS_REVIEW → confident state | MODERATE | 2 | false confidence |
| blocker → other blocker | MODERATE | 2 | wrong workflow |
| anything → NEEDS_REVIEW | LOW | 1 | only merchant review time |

## 7. Pilot metric

**Incremental cash collected within 30 days on invoices escalated after standard reminders
failed.** Eligible escalated invoices are randomised into a Resolve cohort and a reminder-only
holdout; measure cash within 30 days, with wrong chases and merchant review time as guardrails.
The prototype does not simulate this.
