# Resolve AI

> **Razorpay's Receivables Agent chases payment. Resolve fixes what's preventing it.**

Prototype for the Razorpay AI x PM Build Challenge. Resolve is the **escalation / resolution
layer** that takes over *after* standard reminders and calls have failed. It works out what is
actually blocking payment, checks deterministic merchant policy, and removes the blocker — or
hands the invoice back to normal follow-up.

The handoff from the Receivables Agent is **simulated**. There is no live integration with any
Razorpay product, GST portal or IMS API. Everything is labelled in the UI.

```
AI              → UNDERSTANDS the case    (ai/)
Policy engine   → DECIDES what is allowed (domain/policy.ts)
Workflow engine → EXECUTES / ROUTES       (domain/engine.ts, domain/state-machine.ts, domain/timers.ts)
Outcomes        → update buyer + invoice state, with an evidence-backed audit trail
```

## Setup

Requires Node 20+ (tested on Node 24).

```bash
npm install
cp .env.example .env.local   # optional — everything works without it
npm run dev                  # http://localhost:3000
```

Record the demo at **1440×900**. Use **Demo mode** (header) for the guided 90-second walkthrough
and **Reset demo** to restore the seeded book, timers, approvals, simulated payments and clock.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm test` | Vitest unit tests (domain, policy, timers, temporal parsing, isolation, metrics) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run eval -- --set dev` | Classifier regression on the development set (**not held out**) |
| `npm run eval:live -- --set dev --publish` | Same cases through the live Groq model (needs `GROQ_API_KEY`); publishes a frozen report |
| `npm run eval -- --set heldout --publish` / `npm run eval:live -- --set heldout --publish` | Held-out evaluation, once `evaluation/heldout-cases.json` exists |
| `npm run heldout:draft` / `npm run heldout:promote -- --reviewed-by "Name"` | Blind candidate drafting by a different model, then human-reviewed promotion |

## Razorpay test mode

Set `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` to **test-mode** keys (`rzp_test_…`). On approval of a
part-payment plan, `integrations/razorpay/payment-links.ts` calls the official `razorpay` SDK
`paymentLink.create` with `amount`, `currency`, `accept_partial: true`,
`first_min_partial_amount`, `reference_id`, `description`, `customer`, `notify` (both off),
`reminder_enable: false`, `notes` and `expire_by`.

If credentials are missing, are live keys, or the API errors, the app creates a clearly
labelled **Simulated payment link** and shows the reason. Payment completion never depends on
Razorpay: **Simulate payment received** generates a labelled synthetic `PAYMENT_EVENT`
(test payment completion may be unavailable depending on account / KYC settings).

## Live classifier (optional, Groq)

With `GROQ_API_KEY` set, new buyer replies typed in the demo are classified by
`ai/live-classifier.ts` via Groq (`openai/gpt-oss-120b` by default; override with
`RESOLVE_LIVE_MODEL`). It uses the frozen prompt `ai/prompts/case-classifier-v1.md` and Groq
structured outputs (`json_schema`, `strict: true`), then re-validates the result with zod.
Errors, empty output or invalid output degrade to `NEEDS_REVIEW`. The synthetic book, the demo
and all headline metrics use the deterministic `DemoCaseClassifier`, so they are reproducible
and never depend on an external API.

## Repository map

```
domain/        types, state machine, policy engine, timers, bank matching, split, engine
ai/            classifier contract, deterministic demo classifier, temporal + amount parsing,
               live adapter, versioned prompts (+ PROMPT_LOCK.json)
data/synthetic seeded generator; invoice-book.ts (observable) and ground-truth.ts (hidden)
evaluation/    wrong-chase metric, classifier metrics, cost matrix, held-out loader, dev cases
integrations/  razorpay payment links, IMS CSV import
app/           screens + API routes;  components/  UI;  lib/store.tsx  client store
tests/         unit tests;  scripts/run-eval.ts  evaluation CLI
```

## Caveats (read before judging numbers)

- The invoice book is **synthetic** (fixed seed `20260921`); buyer names are fictional.
- The headline metric — *"Resolve blocked N of M wrong chases"* — is computed from that book.
  It is deliberately imperfect: some invoices were paid or disputed with no observable signal.
- The demo classifier was developed alongside the synthetic messages; the wrong-chase result
  measures the system design, not model accuracy.
- A **real model** (`groq:openai/gpt-oss-120b`, frozen prompt v1) has been run on the development
  set: 76.6% state accuracy, 3 high-risk errors (`evaluation/published/dev-live.json`). Not held out.
- **No held-out accuracy is shown** until an independently authored held-out set is imported
  (see `evaluation/HELDOUT_INSTRUCTIONS.md`). Once a held-out set has been evaluated, changing
  the prompt requires a new version (`case-classifier-v2.md`) and ideally a fresh held-out set.
- No cash-collection uplift is claimed. That is the **pilot metric**.

See `PRODUCT_DECISIONS.md`, `STATE_MACHINE.md`, `EVALUATION_PROTOCOL.md`, `ASSUMPTIONS.md`,
`DEMO_SCRIPT.md`, `AI_BUILD_LOG.md` and `VALIDATION_NOTES.md`.
