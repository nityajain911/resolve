/**
 * Regression tests for the external review (P0/P1 findings). Each block names the finding.
 */
import { describe, expect, it } from "vitest";
import { extractAmounts } from "@/ai/amounts";
import { classifyDemo } from "@/ai/demo-classifier";
import {
  actionsFor, advanceClock, approveAction, beginExecution, classifyCase, completePaymentLink,
  editPartPaymentPlan, receiveBankCredit, recordMerchantPayment, reminderGate, simulatePayment, updatePolicy,
} from "@/domain/engine";
import { matchCredit } from "@/domain/matching";
import { reviewOptions } from "@/domain/review-options";
import { promiseDeadlineDate, temporalKind } from "@/domain/temporal-semantics";
import { istDateTime } from "@/domain/time";
import type { CaseUnderstanding, PaymentLinkRecord } from "@/domain/types";
import { validateUnderstanding } from "@/domain/understanding-invariants";
import { computeWrongChaseReport } from "@/evaluation/wrong-chase";
import { freshWorld, HERO } from "./helpers";

const byNumber = (w: ReturnType<typeof freshWorld>, n: string) => Object.values(w.cases).find((c) => c.invoiceNumber === n)!;
const link: PaymentLinkRecord = { mode: "SIMULATED", id: "plink_sim_x", shortUrl: "https://simulated.invalid/x", amount: 265500, acceptPartial: true, firstMinPartialAmount: 90000, createdAt: "2026-09-25T12:00:00.000Z" };

describe("P0 · UTR / reference numbers are never money", () => {
  const SCREENSHOT = "[Screenshot] NEFT transaction successful. Beneficiary: Suvidha Corrugated. UTR: HDFCN52026091899. Status: Completed";

  it("exact SCP-1004 screenshot text yields no amount", () => {
    expect(extractAmounts(SCREENSHOT, 125100)).toEqual([]);
    const w = freshWorld();
    expect(byNumber(w, "SCP-1004").understanding?.extractedAmounts).toEqual([]);
  });

  it("identifiers after UTR / txn / ref / account / GSTIN are skipped; real amounts kept", () => {
    expect(extractAmounts("Ref no 4471882 paid")).toEqual([]);
    expect(extractAmounts("GSTIN 27AAKCS8841R1Z3 galat hai")).toEqual([]);
    expect(extractAmounts("₹2,40,000 transferred, txn id 998877665").map((a) => a.amount)).toEqual([240000]);
    expect(extractAmounts("A/c 50100234567 mein 75,000 bheja").map((a) => a.amount)).toEqual([75000]);
    expect(extractAmounts("50000")).toEqual([]); // bare number without money context
    expect(extractAmounts("payment of 50000 bhej diya").map((a) => a.amount)).toEqual([50000]);
    expect(extractAmounts("₹2 per box zyada hai")).toEqual([]); // unit rate
  });

  it("implausible amounts are flagged by the invariant layer", () => {
    const u = classifyDemo({ primaryEvidence: { id: "e", type: "BUYER_MESSAGE", text: "₹90K aaj, baaki 15 ke baad", timestamp: "2026-09-25T05:35:00.000Z" }, supportingEvidence: [], invoice: { invoiceNumber: "X", amount: 265500, outstandingAmount: 265500, dueAt: "" }, buyerName: "B" });
    const bad: CaseUnderstanding = { ...u, extractedAmounts: [{ rawText: "52026091899", amount: 52026091899, role: "PAID" }] };
    expect(validateUnderstanding(bad, { amount: 125100, outstandingAmount: 125100 })[0].code).toBe("AMOUNT_IMPLAUSIBLE");
  });
});

describe("P0 · review choices come from the case's own candidates", () => {
  const w = freshWorld();
  const labels = (n: string) => reviewOptions(w, byNumber(w, n)).primary.map((o) => o.label);

  it("SCP-1004 (buyer says paid) offers payment confirmation, not paperwork/dispute", () => {
    expect(labels("SCP-1004")).toEqual(["Payment confirmed in our ledger", "Not received — resume follow-up"]);
  });
  it("SCP-1022 (after the 15th) offers promise / cash plan", () => {
    expect(labels("SCP-1022")).toEqual(["Promise to pay", "Cash constraint — set up a plan", "No blocker — resume follow-up"]);
    const ptp = reviewOptions(w, byNumber(w, "SCP-1022")).primary[0];
    expect(ptp.kind === "CLASSIFY" && ptp.defaultDate).toBe("2026-10-16");
  });
  it("SCP-1053 (PO mismatch) offers paperwork / dispute", () => {
    expect(labels("SCP-1053").slice(0, 2)).toEqual(["Paperwork issue", "Commercial dispute"]);
  });
  it("recording a ledger payment resolves the paid-claim review, once", () => {
    const c = byNumber(w, "SCP-1004");
    let w2 = recordMerchantPayment(w, c.id, c.outstandingAmount, "ledger-1");
    w2 = recordMerchantPayment(w2, c.id, c.outstandingAmount, "ledger-1");
    expect(w2.cases[c.id].currentState).toBe("RESOLVED");
    expect(w2.cases[c.id].evidence.filter((e) => e.type === "PAYMENT_EVENT")).toHaveLength(1);
  });
});

describe("P0 · bank matching tiers", () => {
  const w = freshWorld();
  it("amount + payer without an invoice reference is only POSSIBLE → Needs review", () => {
    const c = byNumber(w, "SCP-1009");
    expect(c.currentState).toBe("NEEDS_REVIEW");
    expect(c.transitions.at(-1)?.reasonCode).toBe("POSSIBLE_BANK_MATCH");
    const credit = c.evidence.find((e) => e.type === "BANK_CREDIT")!;
    expect(credit.structuredExtraction?.kind === "BANK_CREDIT" && matchCredit(credit.structuredExtraction.data, c).strength).toBe("POSSIBLE");
  });
  it("amount + invoice reference is STRONG → Paid but unmatched", () => {
    expect(w.cases[HERO.paid].currentState).toBe("PAID_UNMATCHED");
    expect(byNumber(w, "SCP-1002").currentState).toBe("PAID_UNMATCHED");
  });
  it("a possible match is never auto-reconciled; the merchant decides", () => {
    const c = byNumber(w, "SCP-1009");
    const m = actionsFor(w, c.id).find((a) => a.type === "MATCH_PAYMENT")!;
    expect(m.status).toBe("REVIEW_REQUIRED");
    expect(reminderGate(w, c).decision).toBe("BLOCK");
  });
});

describe("P0 · financial consistency invariants", () => {
  it("SCP-1016: ₹1 lakh offered on ₹48,400 outstanding → AMOUNT_EXCEEDS_OUTSTANDING", () => {
    const c = byNumber(freshWorld(), "SCP-1016");
    expect(c.outstandingAmount).toBe(48400);
    expect(c.currentState).toBe("NEEDS_REVIEW");
    expect(c.transitions.at(-1)?.reasonCode).toBe("AMOUNT_EXCEEDS_OUTSTANDING");
    expect(c.transitions.at(-1)?.humanReadableReason).toMatch(/₹1,00,000 but only ₹48,400 is outstanding/);
  });
  it("split / remainder / disputed bounds", () => {
    const base = classifyDemo({ primaryEvidence: { id: "e", type: "BUYER_MESSAGE", text: "ok", timestamp: "2026-09-25T05:35:00.000Z" }, supportingEvidence: [], invoice: { invoiceNumber: "X", amount: 100000, outstandingAmount: 100000, dueAt: "" }, buyerName: "B" });
    const inv = { amount: 100000, outstandingAmount: 100000 };
    const codes = (amts: CaseUnderstanding["extractedAmounts"], state: CaseUnderstanding["proposedState"] = "CASH_CONSTRAINED") =>
      validateUnderstanding({ ...base, proposedState: state, extractedAmounts: amts }, inv).map((i) => i.code);
    expect(codes([{ rawText: "a", amount: 60000, role: "IMMEDIATE" }, { rawText: "b", amount: 60000, role: "REMAINDER" }])).toContain("SPLIT_EXCEEDS_OUTSTANDING");
    expect(codes([{ rawText: "a", amount: 100000, role: "IMMEDIATE" }])).toContain("IMMEDIATE_COVERS_OUTSTANDING");
    expect(codes([{ rawText: "a", amount: 120000, role: "DISPUTED" }], "COMMERCIAL_DISPUTE")).toContain("DISPUTED_EXCEEDS_OUTSTANDING");
    expect(codes([{ rawText: "a", amount: 40000, role: "IMMEDIATE" }, { rawText: "b", amount: 60000, role: "REMAINDER" }])).toEqual([]);
  });
});

describe("P1 · assessment snapshots separate from transitions", () => {
  it("IMS corroboration updates the assessment without a second transition", () => {
    const c = freshWorld().cases[HERO.gst];
    expect(c.transitions.filter((t) => t.toState === "PAPERWORK_BLOCKED")).toHaveLength(1);
    const kinds = (c.assessments ?? []).map((a) => a.kind);
    expect(kinds).toEqual(["INITIAL", "CORROBORATED"]);
    expect(c.assessments!.at(-1)!.evidenceStrength).toBe("CORROBORATED");
    expect(c.assessments![0].evidenceStrength).toBe("SINGLE_SOURCE");
  });
});

describe("P1 · temporal semantics", () => {
  it("lower bounds and ambiguity never become promise dates", () => {
    expect(promiseDeadlineDate({ rawText: "15 ke baad", type: "AFTER_DATE", lowerBound: "2026-10-15", confidenceBand: "HIGH" })).toBeUndefined();
    expect(promiseDeadlineDate({ rawText: "parso", type: "AMBIGUOUS", confidenceBand: "NEEDS_REVIEW" })).toBeUndefined();
    expect(promiseDeadlineDate({ rawText: "weekend tak", type: "DATE_RANGE", upperBound: "2026-09-27", confidenceBand: "HIGH" })).toEqual({ date: "2026-09-27", precision: "DEADLINE" });
    expect(temporalKind({ type: "RELATIVE_DATE", confidenceBand: "HIGH", normalizedDate: "2026-09-28" })).toBe("EXACT");
  });
  it("a remainder date derived from 'after the 15th' is marked and must be confirmed; merchant edit clears it", () => {
    const w = freshWorld();
    const plan = w.cases[HERO.cash].paymentPlan!;
    expect(plan.installments[1].dateSource).toBe("PROPOSED_FROM_LOWER_BOUND");
    const a = actionsFor(w, HERO.cash).find((x) => x.type === "CREATE_PART_PAYMENT_LINK")!;
    const w2 = editPartPaymentPlan(w, a.id, { immediateAmount: 90000, remainderDate: "2026-10-16" });
    const a2 = actionsFor(w2, HERO.cash).filter((x) => x.type === "CREATE_PART_PAYMENT_LINK").at(-1)!;
    expect(w2.cases[HERO.cash].paymentPlan!.installments[1].dateSource).toBe("MERCHANT_SET");
    expect(a2.policyEvaluation.reasonCodes).not.toContain("REMAINDER_DATE_CONFIRMED");
  });
});

describe("P1 · explicit followUpSuppressedUntil", () => {
  it("promise suppression is stored and enforced by policy, then cleared on resume", () => {
    const w = freshWorld();
    const c = w.cases[HERO.ptp];
    expect(c.followUpSuppressedUntil).toBe(c.promiseToPay!.deadlineAt);
    expect(reminderGate(w, c).reasonCodes).toContain("FOLLOW_UP_SUPPRESSED");
    const after = advanceClock(w, istDateTime("2026-09-30", 9, 0));
    expect(after.cases[HERO.ptp].followUpSuppressedUntil).toBeUndefined();
    expect(reminderGate(after, after.cases[HERO.ptp]).decision).toBe("ALLOW");
  });
});

describe("P1 · partial-payment accounting", () => {
  it("a partial payment during a promise does not resolve the invoice", () => {
    const w = simulatePayment(freshWorld(), HERO.ptp, 50000, { paymentId: "p1" });
    expect(w.cases[HERO.ptp].currentState).toBe("PROMISE_TO_PAY");
    expect(w.cases[HERO.ptp].outstandingAmount).toBe(184080 - 50000);
  });
  it("an overpayment floors outstanding at zero and is flagged", () => {
    const w = simulatePayment(freshWorld(), HERO.ptp, 200000, { paymentId: "p2" });
    const c = w.cases[HERO.ptp];
    expect(c.outstandingAmount).toBe(0);
    expect(c.currentState).toBe("RESOLVED");
    expect(c.evidence.some((e) => /exceeds the/.test(e.rawContent))).toBe(true);
  });
  it("payments on a child receivable never touch the disputed parent", () => {
    let w = freshWorld();
    const split = actionsFor(w, "inv-scp-1026").find((a) => a.type === "CREATE_CHILD_INVOICE")!;
    w = approveAction(w, split.id);
    const childId = w.cases["inv-scp-1026"].childInvoiceIds![0];
    w = simulatePayment(w, childId, 150000, { paymentId: "c1" });
    expect(w.cases[childId].currentState).toBe("RESOLVED");
    expect(w.cases["inv-scp-1026"].outstandingAmount).toBe(50000);
    expect(w.cases["inv-scp-1026"].currentState).toBe("COMMERCIAL_DISPUTE");
  });
});

describe("P1 · idempotent execution", () => {
  it("double approval of a split creates one child", () => {
    let w = freshWorld();
    const split = actionsFor(w, "inv-scp-1026").find((a) => a.type === "CREATE_CHILD_INVOICE")!;
    w = approveAction(w, split.id);
    w = approveAction(w, split.id);
    expect(w.cases["inv-scp-1026"].childInvoiceIds).toHaveLength(1);
  });
  it("double confirm-match reconciles once", () => {
    let w = freshWorld();
    const m = actionsFor(w, HERO.paid).find((a) => a.type === "MATCH_PAYMENT")!;
    w = approveAction(w, m.id);
    const n = w.cases[HERO.paid].transitions.length;
    w = approveAction(w, m.id);
    expect(w.cases[HERO.paid].transitions).toHaveLength(n);
  });
  it("the same payment event and bank credit are applied once; link completion is retry-safe", () => {
    let w = freshWorld();
    const a = actionsFor(w, HERO.cash).find((x) => x.type === "CREATE_PART_PAYMENT_LINK")!;
    w = editPartPaymentPlan(w, a.id, { immediateAmount: 90000, remainderDate: "2026-10-16" });
    const a2 = actionsFor(w, HERO.cash).filter((x) => x.type === "CREATE_PART_PAYMENT_LINK").at(-1)!;
    w = completePaymentLink(beginExecution(approveAction(w, a2.id), a2.id), a2.id, link);
    const timers = w.timers.length;
    w = completePaymentLink(w, a2.id, link);
    expect(w.timers).toHaveLength(timers);
    w = simulatePayment(w, HERO.cash, 90000, { paymentId: "rzp_1" });
    w = simulatePayment(w, HERO.cash, 90000, { paymentId: "rzp_1" });
    expect(w.cases[HERO.cash].outstandingAmount).toBe(175500);
    const credit = { id: "dup", source: "Bank statement import (synthetic)", data: { amount: 1000, payerName: "X", reference: "Y", valueDate: w.clock, bankTxnId: "UTR-DUP-1" } };
    w = receiveBankCredit(receiveBankCredit(w, credit), credit);
    expect(w.bankFeed.filter((f) => f.evidence.structuredExtraction?.kind === "BANK_CREDIT" && f.evidence.structuredExtraction.data.bankTxnId === "UTR-DUP-1")).toHaveLength(1);
  });
  it("a classification with the same idempotency key applies once", () => {
    let w = freshWorld();
    w = classifyCase(w, HERO.review, "COMMERCIAL_DISPUTE", { idempotencyKey: "k1" });
    w = classifyCase(w, HERO.review, "PAPERWORK_BLOCKED", { idempotencyKey: "k1" });
    expect(w.cases[HERO.review].currentState).toBe("COMMERCIAL_DISPUTE");
    expect(w.labelledReviewSet).toHaveLength(1);
  });
});

describe("P1 · policy snapshotted with the action and re-checked at approval", () => {
  it("stores the thresholds used", () => {
    const a = actionsFor(freshWorld(), HERO.cash).find((x) => x.type === "CREATE_PART_PAYMENT_LINK")!;
    expect(a.policyEvaluation.policySnapshot.minPartPaymentAmount).toBe(50000);
    expect(a.policyEvaluation.policyVersion).toBe("merchant-policy@v1");
  });
  it("approval against a stale policy re-evaluates and refuses if now outside policy", () => {
    let w = freshWorld();
    const a = actionsFor(w, HERO.cash).find((x) => x.type === "CREATE_PART_PAYMENT_LINK")!;
    // Simulate a policy change that did NOT re-evaluate open actions (e.g. a race).
    w = { ...w, policy: { ...w.policy, minPartPaymentAmount: 100000, version: 2 } };
    w = approveAction(w, a.id);
    expect(w.actions[a.id].status).toBe("BLOCKED");
    expect(w.actions[a.id].result).toMatch(/policy changed/);
    expect(w.actions[a.id].policyEvaluation.policyVersion).toBe("merchant-policy@v2");
  });
  it("updatePolicy re-evaluates open proposals too", () => {
    const w = updatePolicy(freshWorld(), { maxExtensionDays: 10 });
    const a = actionsFor(w, HERO.cash).find((x) => x.type === "CREATE_PART_PAYMENT_LINK")!;
    expect(a.status).toBe("BLOCKED");
  });
});

describe("P1 · evaluation snapshot is independent of demo state", () => {
  it("mutating a demo world does not change M/N", () => {
    const before = computeWrongChaseReport();
    let demo = freshWorld();
    demo = advanceClock(demo, istDateTime("2026-11-01", 0, 0));
    demo = classifyCase(demo, HERO.review, "PAPERWORK_BLOCKED");
    void demo;
    const after = computeWrongChaseReport();
    expect({ M: after.M, N: after.N, snap: after.snapshotAt }).toEqual({ M: before.M, N: before.N, snap: before.snapshotAt });
  });
});
