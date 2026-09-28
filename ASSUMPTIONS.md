# Assumptions

Stated explicitly so nothing in the prototype is mistaken for a claim about Razorpay or its merchants.

1. **Simulated Receivables Agent handoff.** The invoices, reminder history and handoff are
   synthetic. There is no integration with Razorpay's Receivables Agent or Agent Studio;
   "Agent Studio concept" describes where this could live, not something that exists.
2. **Synthetic invoice book.** 46 invoices generated from a fixed seed (`20260921`). Buyer and
   merchant names are fictional. The distribution of blockers is illustrative, not measured.
3. **IMS is imported, not live.** IMS evidence comes from a (synthetic) exported CSV. No GST
   portal access and no guaranteed IMS API access are assumed.
4. **IMS only corroborates.** An IMS rejection supports a buyer's statement; it is never treated
   as proof that payment is withheld. IMS alone routes to NEEDS_REVIEW.
5. **Buyer-conversation capture is an assumption.** The prototype assumes buyer replies
   (WhatsApp, email, voice-note transcripts, screenshot text) reaching the Receivables Agent can
   be captured and passed to Resolve. Consent, channel access and transcription are unsolved here.
6. **Bank statements are imported.** Bank credits come from a synthetic statement import.
7. **Test payment completion may be simulated.** Payment Links are created in Razorpay test mode
   when test keys are configured, otherwise simulated. Payments are recorded with a labelled
   **Simulated payment event**, since test completion depends on account/KYC configuration.
8. **Merchant persona is an assumption.** A ₹20–100 Cr Indian packaging manufacturer selling B2B
   on 30–60 day credit to roughly 40–100 enterprise buyers, GST-registered, with accounts, sales
   and dispatch teams. This is a prototype persona, not a Razorpay merchant fact. Next segment:
   B2B services / SaaS.
9. **Timezone.** All dates are Asia/Kolkata (fixed UTC+05:30).
10. **Demo clock.** Time only moves when advanced in the UI; timers fire on advance.
11. **No production concerns.** No auth, multi-tenant permissions or durable storage. State
    lives in the browser's localStorage.
