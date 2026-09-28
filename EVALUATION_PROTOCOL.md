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

**Stronger benchmark (`evaluation/baselines.ts`).** Besides reminder-only, a *competent rules
baseline* uses only observable data and no classifier: ledger check, deterministic STRONG bank
matching (amount + invoice reference), and keyword suppression for payment / dispute / document
words. The Evaluation page shows wrong chases blocked, unnecessary pauses and avoidable follow-up
handled for all three, plus which invoices only Resolve (or only the rules) blocked. On seed
20260921 the rules baseline blocks 8 of 14 with no unnecessary pauses; Resolve blocks 10 of 14 with
2 unnecessary pauses; its 2 extra blocks come from the deterministic possible-match tier, not the
classifier. The keyword list and the synthetic messages share an author, so the rules baseline is
likely optimistic. Resolve's distinct contribution is choosing the next action (dated wait, approved
plan, routed correction, review) — which the pilot must measure.

**Frozen evaluation snapshot.** The report is rebuilt from the seed on every request, independent of
any demo state (demo state lives in each browser). `tests/review-fixes.test.ts` checks that demo
commands cannot change M/N.

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

**Provider failures are not predictions.** A rate-limited, failed or invalid live-model call is
recorded under `providerErrors`, excluded from every metric and reported separately. Evaluation
runs the live classifier in *patient* mode, which waits out rate limits (e.g. Groq's free tier
allows ~2–3 classifications per minute for `openai/gpt-oss-120b`).

- State classification accuracy, using the band-adjusted routing state (NEEDS_REVIEW band → NEEDS_REVIEW).
- Per-state precision, recall, F1 and a confusion matrix.
- Amount extraction exact match (set of distinct rupee amounts, including derived remainders).
- Temporal parsing exact match (type + dates), broken down by category.
- Ambiguous-expression handling: % of expected-ambiguous cases routed to NEEDS_REVIEW.
- Risk-weighted error count (below).

## 5. Relative-date testing

Relative dates are resolved against the **message timestamp** in Asia/Kolkata, never the device
clock.

**Scoring by semantic kind** (`domain/temporal-semantics.ts`): predictions are compared on kind —
EXACT (EXACT_DATE or RELATIVE_DATE), LOWER_BOUND (AFTER_DATE), RANGE (DATE_RANGE), AMBIGUOUS
(type AMBIGUOUS or band NEEDS_REVIEW) — and then on the dates that kind carries. So "Monday tak"
labelled EXACT_DATE by one annotator and RELATIVE_DATE by another is scored on the resolved day.
This rule was fixed before any held-out evaluation. The same kinds drive the product: only EXACT or
a RANGE with an explicit deadline can become a promise date; a LOWER_BOUND never silently becomes an
exact date (a remainder date proposed from "after the 15th" carries `PROPOSED_FROM_LOWER_BOUND` and
policy requires confirmation). Required categories: `WEEKDAY`, `TOMORROW_KAL`, `PARSO`, `AFTER_15TH`, `NEXT_FRIDAY`,
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

## 7. Results so far (development set — NOT held out)

| Classifier | State accuracy | Risk-weighted errors | Temporal (kind + date) | Ambiguous → review |
|---|---|---|---|---|
| `demo-lexicon-v1` (deterministic, built on these cases) | 47/47 | 0 | 31/31 | 8/8 |
| `groq:openai/gpt-oss-120b` + frozen `case-classifier-v1` | 36/47 (76.6%) | 21 (3 high) | 20/31 | 5/8 |

The deterministic score reflects that it was developed on these cases. The Groq run is the first
real-model result: the prompt was **not** edited after seeing it (v1 stays frozen; changes would be
v2 with a fresh held-out set). Its three high-risk errors route vague/ambiguous replies ("jaldi kar
denge", "thoda thoda karke denge", "weekend ke baad dekhte hain") to follow-up instead of review.
Frozen report: `evaluation/published/dev-live.json`.

## 8. Held-out drafting workflow

1. `npm run heldout:draft` — a **different model family** (`qwen/qwen3.8-27b`) drafts candidates
   blind: the script never imports the classifier prompt or development set
   (`tests/heldout-independence.test.ts`) and prints only counts.
2. A person reviews and corrects **every** label in `evaluation/heldout-candidates.json`.
3. `npm run heldout:promote -- --reviewed-by "Name"` writes `heldout-cases.json`, recording the
   reviewer and the frozen prompt hash. Refuses to overwrite an existing held-out set.
4. `npm run eval -- --set heldout --publish` and `npm run eval:live -- --set heldout --publish`.

Real anonymised buyer messages from validation interviews remain the preferred source.

## 9. Pilot metric

**Incremental cash collected within 30 days on invoices escalated after standard reminders
failed.** Eligible escalated invoices are randomised into a Resolve cohort and a reminder-only
holdout; measure cash within 30 days, with wrong chases and merchant review time as guardrails.
The prototype does not simulate this.
