# AI build log (challenge submission template)

Fill in the bracketed parts; the pre-filled lines describe how this prototype was built.

## AI tools used
- Claude Code (Claude Opus 5.5): repo scaffolding, domain model, engine, tests, UI, docs.
- [Other tools you used: ChatGPT / Cursor / v0 / …]
- Optional runtime: Groq API (`openai/gpt-oss-120b`) as a live classifier, off by default.

## What AI accelerated
- Turning the product spec into a typed domain model, explicit state machine and policy engine.
- Writing 58 unit tests covering transitions, policy gates, timers, temporal parsing, isolation and metrics.
- Hinglish temporal/amount parsing rules and the development case set.
- UI screens and documentation.

## Where human product decisions were made
- [Positioning Resolve as the resolution layer *after* the Receivables Agent, not a replacement]
- [Choosing the four MVP flows and making NEEDS_REVIEW a first-class safety state]
- [The strict wrong-chase definition, and refusing to show simulated cash uplift]
- [Confidence bands instead of percentages; plain promise counts instead of reliability scores]
- [IMS as corroboration only; review-first by default]

## What was rejected
- Recovery-probability scores and "₹X collected" projections (not honestly derivable).
- Letting the AI mark invoices paid or execute financial actions.
- A dataset tuned so Resolve looks perfect (misses are deliberate).
- [Anything else you cut]

## What was validated
- Deterministic tests: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.
- Development-set regression (NOT held out): `npm run eval -- --set dev`.
- [Held-out evaluation: pending until independently authored cases are imported]
- [Merchant validation interviews: see VALIDATION_NOTES.md]
