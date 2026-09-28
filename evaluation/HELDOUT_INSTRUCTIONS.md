# Held-out evaluation set — instructions

The development cases in `development-cases.json` were written **by the same process
that built the classifier** (Claude Code, while tuning the deterministic parser and
prompt v1). They are **NOT held out** and say nothing about generalisation.

A real held-out set must be authored **separately, after the prompt is frozen**.

## Rules

1. The classifier prompt `ai/prompts/case-classifier-v1.md` is frozen. Its SHA-256 is
   recorded in `ai/prompts/PROMPT_LOCK.json`; `tests/eval-harness.test.ts` fails if it changes.
2. Held-out cases must be written by someone/something other than the classifier developer.
   In order of preference:
   - anonymised real buyer messages from merchant validation conversations (see `VALIDATION_NOTES.md`);
   - a friend or classmate who has not seen the prompt or the dev set;
   - a different model, prompted only with the schema and the category list below — not with the prompt or dev cases.
3. **Claude Code must not generate the held-out cases** and then call them independent.
4. The classifier developer must not edit the prompt or the demo lexicon after looking at the
   held-out cases. Any change → `case-classifier-v2.md` (never overwrite v1) and ideally a fresh held-out set.
5. Label each case (expected state, amounts, temporal expression) **before** running the classifier.

## Coverage required

- Languages: English, Hindi, Hinglish; spelling errors; very short replies.
- States: every MVP state plus mixed/ambiguous messages that should land in `NEEDS_REVIEW`.
- Temporal categories (`temporalCategory`): `WEEKDAY`, `TOMORROW_KAL`, `PARSO`, `AFTER_15TH`,
  `NEXT_FRIDAY`, `MONTH_BOUNDARY`, `WEEKEND_BOUNDARY`, `EXPLICIT_DATE`, `VAGUE`.
- Aim for at least 60 cases, at least 5 per temporal category.

## Labelling conventions (match `EVALUATION_PROTOCOL.md`)

- Dates are `YYYY-MM-DD` in Asia/Kolkata, resolved against `messageTimestamp`.
- `expectedState` is the state Resolve should route to: a genuinely ambiguous message is `NEEDS_REVIEW`.
- A buyer saying they already paid is labelled `PAID_UNMATCHED` (the classifier reports the claim;
  bank matching decides).
- `expectedExtractedAmounts` is the set of distinct rupee amounts, including a derived remainder.

## File format

Copy `heldout-cases.example.json` to `heldout-cases.json` and set:

```json
"meta": {
  "set": "heldout",
  "heldOut": true,
  "authoredBy": "<who wrote them>",
  "authoredAt": "<date>",
  "promptVersionFrozen": "case-classifier-v1",
  "promptHashAtAuthoring": "<sha256 from PROMPT_LOCK.json>"
}
```

## Running

```bash
npm run eval -- --set heldout                  # deterministic demo classifier
npm run eval -- --set heldout --provider live  # live model (needs GROQ_API_KEY)
```

Reports land in `evaluation/reports/` with prompt version, prompt hash, dataset hash,
timestamp and provider. The Evaluation screen shows held-out metrics only once this file exists.
