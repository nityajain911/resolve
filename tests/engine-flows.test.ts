import { describe, expect, it } from "vitest";
import {
  actionsFor, advanceClock, approveAction, beginExecution, classifyCase, completePaymentLink,
  ingestEvidence, markCorrectionIssued, receiveBankCredit, rejectAction, simulatePayment,
} from "@/domain/engine";
import { istDateTime } from "@/domain/time";
import type { PaymentLinkRecord } from "@/domain/types";
import { ctx, freshWorld, HERO } from "./helpers";

const link: PaymentLinkRecord = { mode: "SIMULATED", id: "plink_sim_1", shortUrl: "https://example.invalid/sim", amount: 265500, acceptPartial: true, firstMinPartialAmount: 90000, createdAt: "2026-09-25T12:00:00.000Z" };

describe("Flow A · paid but unmatched", () => {
  it("confirm match resolves; reject resumes follow-up", () => {
    const w = freshWorld();
    const match = actionsFor(w, HERO.paid).find((a) => a.type === "MATCH_PAYMENT")!;
    expect(match.status).toBe("REVIEW_REQUIRED");
    const ok = approveAction(w, match.id);
    expect(ok.cases[HERO.paid].currentState).toBe("RESOLVED");
    expect(ok.cases[HERO.paid].outstandingAmount).toBe(0);
    const no = rejectAction(w, match.id);
    expect(no.cases[HERO.paid].currentState).toBe("FOLLOW_UP_ACTIVE");
    expect(no.cases[HERO.paid].rejectedCreditIds).toHaveLength(1);
  });
});

describe("Flow B · paperwork", () => {
  it("pauses reminders, routes to Accounts, needs approval, then resumes after issue", () => {
    let w = freshWorld();
    const c = w.cases[HERO.gst];
    expect(c.currentState).toBe("PAPERWORK_BLOCKED");
    expect(c.understanding?.conciseExplanation).toMatch(/IMS evidence/);
    expect(c.workflow?.routedTo).toBe("ACCOUNTS");
    const draft = actionsFor(w, HERO.gst).find((a) => a.type === "DRAFT_CORRECTION")!;
    expect(draft.status).toBe("REVIEW_REQUIRED");
    expect(() => markCorrectionIssued(w, HERO.gst)).toThrow(/approved first/);
    w = approveAction(w, draft.id);
    w = markCorrectionIssued(w, HERO.gst);
    expect(w.cases[HERO.gst].currentState).toBe("FOLLOW_UP_ACTIVE");
  });
});

describe("Flow C · cash constraint", () => {
  it("approve → execute → link → partial payment → remainder resolves", () => {
    let w = freshWorld();
    const c = w.cases[HERO.cash];
    expect(c.currentState).toBe("CASH_CONSTRAINED");
    expect(c.paymentPlan?.installments.map((i) => i.amount)).toEqual([90000, 175500]);
    expect(c.paymentPlan?.installments[1].dueDate).toBe("2026-10-16");
    const a = actionsFor(w, HERO.cash).find((x) => x.type === "CREATE_PART_PAYMENT_LINK")!;
    expect(() => beginExecution(w, a.id)).toThrow(/APPROVED/);
    w = approveAction(w, a.id);
    w = beginExecution(w, a.id);
    w = completePaymentLink(w, a.id, link);
    expect(w.cases[HERO.cash].paymentPlan?.status).toBe("ACTIVE");
    w = simulatePayment(w, HERO.cash, 90000);
    expect(w.cases[HERO.cash].paymentPlan?.installments[0].status).toBe("PAID");
    expect(w.cases[HERO.cash].currentState).toBe("CASH_CONSTRAINED");
    w = simulatePayment(w, HERO.cash, 175500);
    expect(w.cases[HERO.cash].currentState).toBe("RESOLVED");
  });

  it("missed installment returns to follow-up", () => {
    let w = freshWorld();
    const a = actionsFor(w, HERO.cash).find((x) => x.type === "CREATE_PART_PAYMENT_LINK")!;
    w = completePaymentLink(beginExecution(approveAction(w, a.id), a.id), a.id, link);
    w = advanceClock(w, istDateTime("2026-09-28", 9, 0));
    expect(w.cases[HERO.cash].currentState).toBe("FOLLOW_UP_ACTIVE");
    expect(w.cases[HERO.cash].paymentPlan?.status).toBe("BROKEN");
  });

  it("payment detected immediately before send blocks execution and re-evaluates state", () => {
    let w = freshWorld();
    const a = actionsFor(w, HERO.cash).find((x) => x.type === "CREATE_PART_PAYMENT_LINK")!;
    w = approveAction(w, a.id);
    w = receiveBankCredit(w, { id: "late", source: "Bank statement import (synthetic)", data: { amount: 265500, payerName: "NILGIRI CREST BEVERAGES PVT LTD", reference: "NEFT SCP-1049", valueDate: w.clock, bankTxnId: "UTRX" } }, false);
    w = beginExecution(w, a.id);
    expect(w.actions[a.id].status).toBe("BLOCKED");
    expect(w.actions[a.id].policyEvaluation.reasonCodes).toContain("PAYMENT_RECHECK");
    expect(w.cases[HERO.cash].currentState).toBe("PAID_UNMATCHED");
  });
});

describe("Flow D · promise to pay timer", () => {
  it("promise resolved against message timestamp, buyer history 3/3", () => {
    const w = freshWorld();
    const c = w.cases[HERO.ptp];
    expect(c.currentState).toBe("PROMISE_TO_PAY");
    expect(c.promiseToPay?.promisedDate).toBe("2026-09-28");
    expect(c.buyerContext.promiseHistory).toEqual({ made: 3, kept: 3, broken: 0 });
  });

  it("timer fires after deadline + grace and resumes follow-up; history becomes 3/4", () => {
    const w0 = freshWorld();
    const before = advanceClock(w0, istDateTime("2026-09-29", 12, 0));
    expect(before.cases[HERO.ptp].currentState).toBe("PROMISE_TO_PAY"); // still within 24h grace
    const w = advanceClock(w0, istDateTime("2026-09-30", 9, 0));
    const c = w.cases[HERO.ptp];
    expect(c.currentState).toBe("FOLLOW_UP_ACTIVE");
    expect(c.promiseToPay?.status).toBe("BROKEN");
    expect(c.buyerContext.promiseHistory).toEqual({ made: 4, kept: 3, broken: 1 });
    expect(c.transitions.at(-1)?.initiatedBy).toBe("TIMER");
    expect(c.transitions.at(-1)?.humanReadableReason).toMatch(/Promise missed/);
  });

  it("payment before deadline resolves and counts as kept", () => {
    let w = freshWorld();
    w = advanceClock(w, istDateTime("2026-09-28", 10, 0));
    w = simulatePayment(w, HERO.ptp, 184080);
    w = advanceClock(w, istDateTime("2026-10-01", 10, 0));
    const c = w.cases[HERO.ptp];
    expect(c.currentState).toBe("RESOLVED");
    expect(c.promiseToPay?.status).toBe("KEPT");
    expect(c.buyerContext.promiseHistory).toEqual({ made: 4, kept: 4, broken: 0 });
  });
});

describe("Needs review", () => {
  it("merchant classification is recorded and added to the labelled set", () => {
    let w = freshWorld();
    expect(w.cases[HERO.review].currentState).toBe("NEEDS_REVIEW");
    expect(w.cases[HERO.review].reviewCandidates).toEqual(expect.arrayContaining(["PAPERWORK_BLOCKED", "COMMERCIAL_DISPUTE"]));
    w = classifyCase(w, HERO.review, "COMMERCIAL_DISPUTE", { note: "Short delivery vs PO" });
    const c = w.cases[HERO.review];
    expect(c.currentState).toBe("COMMERCIAL_DISPUTE");
    expect(c.transitions.at(-1)?.initiatedBy).toBe("MERCHANT");
    expect(c.evidence.some((e) => e.type === "MERCHANT_OVERRIDE")).toBe(true);
    expect(w.labelledReviewSet).toHaveLength(1);
  });

  it("a new buyer reply is classified from its own timestamp", () => {
    const w = freshWorld();
    const w2 = ingestEvidence(w, ctx, "inv-scp-1029", { type: "BUYER_MESSAGE", timestamp: istDateTime("2026-09-25", 12, 0), source: "WhatsApp reply (captured)", rawContent: "parso kar dunga", isSynthetic: true });
    expect(w2.cases["inv-scp-1029"].currentState).toBe("PROMISE_TO_PAY");
    expect(w2.cases["inv-scp-1029"].promiseToPay?.promisedDate).toBe("2026-09-27");
  });

  it("commands never mutate the input world", () => {
    const w = freshWorld();
    const snapshot = JSON.stringify(w);
    advanceClock(w, istDateTime("2026-10-30", 0, 0));
    classifyCase(w, HERO.review, "PAPERWORK_BLOCKED");
    expect(JSON.stringify(w)).toBe(snapshot);
  });
});

describe("IMS corroboration", () => {
  it("refreshes the unapproved correction draft when IMS evidence arrives later", () => {
    const w = freshWorld();
    expect(w.cases[HERO.gst].workflow?.correction?.draft).toMatch(/Imported IMS evidence supports this/);
  });
});
