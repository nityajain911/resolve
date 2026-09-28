import { describe, expect, it } from "vitest";
import { reminderGate, updatePolicy, editPartPaymentPlan, actionsFor } from "@/domain/engine";
import { DEFAULT_POLICY, evaluateAction, toneViolations } from "@/domain/policy";
import { freshWorld, HERO } from "./helpers";

const status = (outstanding: number, newPaymentDetected = false) => ({ outstandingAmount: outstanding, newPaymentDetected, checkedAt: "2026-09-25T12:00:00.000Z" });

describe("policy engine", () => {
  const w = freshWorld();

  it("PAID_UNMATCHED blocks buyer follow-up", () => {
    const g = reminderGate(w, w.cases[HERO.paid]);
    expect(g.decision).toBe("BLOCK");
    expect(g.reasonCodes).toContain("STATE_PAID_UNMATCHED_BLOCKS_CONTACT");
  });

  it("PAPERWORK_BLOCKED blocks reminders", () => {
    const g = reminderGate(w, w.cases[HERO.gst]);
    expect(g.decision).toBe("BLOCK");
    expect(g.reasonCodes).toContain("STATE_PAPERWORK_BLOCKS_REMINDER");
  });

  it("NEEDS_REVIEW blocks any buyer message", () => {
    const c = w.cases[HERO.review];
    for (const type of ["SEND_REMINDER", "CREATE_PART_PAYMENT_LINK", "RESUME_FOLLOW_UP"] as const) {
      const pe = evaluateAction({ invoiceCase: c, proposedAction: { type }, merchantPolicy: DEFAULT_POLICY, latestPaymentStatus: status(c.outstandingAmount), now: w.clock });
      expect(pe.decision).toBe("BLOCK");
      expect(pe.reasonCodes).toContain("STATE_NEEDS_REVIEW_BLOCKS_CONTACT");
    }
  });

  it("RESOLVED blocks all collection actions", () => {
    const c = w.cases["inv-scp-1024"];
    expect(c.currentState).toBe("RESOLVED");
    const pe = evaluateAction({ invoiceCase: c, proposedAction: { type: "WAIT_UNTIL_DATE" }, merchantPolicy: DEFAULT_POLICY, latestPaymentStatus: status(0), now: w.clock });
    expect(pe.decision).toBe("BLOCK");
  });

  it("payment detected on recheck blocks a buyer-facing action", () => {
    const c = w.cases["inv-scp-1029"];
    const ok = evaluateAction({ invoiceCase: c, proposedAction: { type: "SEND_REMINDER" }, merchantPolicy: DEFAULT_POLICY, latestPaymentStatus: status(c.outstandingAmount), now: w.clock });
    expect(ok.decision).toBe("ALLOW");
    const pe = evaluateAction({ invoiceCase: c, proposedAction: { type: "SEND_REMINDER" }, merchantPolicy: DEFAULT_POLICY, latestPaymentStatus: status(c.outstandingAmount, true), now: w.clock });
    expect(pe.decision).toBe("BLOCK");
    expect(pe.reasonCodes).toContain("PAYMENT_RECHECK");
  });

  it("excluded buyers are blocked", () => {
    const c = w.cases["inv-scp-1029"];
    const pe = evaluateAction({ invoiceCase: c, proposedAction: { type: "SEND_REMINDER" }, merchantPolicy: { ...DEFAULT_POLICY, excludedBuyerIds: [c.buyerId] }, latestPaymentStatus: status(c.outstandingAmount), now: w.clock });
    expect(pe.decision).toBe("BLOCK");
    expect(pe.reasonCodes).toContain("BUYER_EXCLUDED");
  });

  it("part-payment: review-first → REVIEW_REQUIRED when within limits", () => {
    const a = actionsFor(w, HERO.cash).find((x) => x.type === "CREATE_PART_PAYMENT_LINK")!;
    expect(a.status).toBe("REVIEW_REQUIRED");
    expect(a.policyEvaluation.checks.filter((c) => c.severity === "BLOCK").every((c) => c.passed)).toBe(true);
    // "after the 15th" is a lower bound: the proposed remainder date must be confirmed, never assumed.
    expect(a.policyEvaluation.reasonCodes).toEqual(expect.arrayContaining(["REVIEW_FIRST", "REMAINDER_DATE_CONFIRMED"]));
  });

  it("part-payment below minimum or beyond max extension is blocked", () => {
    const a = actionsFor(w, HERO.cash).find((x) => x.type === "CREATE_PART_PAYMENT_LINK")!;
    const low = editPartPaymentPlan(w, a.id, { immediateAmount: 20_000, remainderDate: "2026-10-16" });
    const lowAction = actionsFor(low, HERO.cash).filter((x) => x.type === "CREATE_PART_PAYMENT_LINK").at(-1)!;
    expect(lowAction.status).toBe("BLOCKED");
    expect(lowAction.policyEvaluation.reasonCodes).toContain("MIN_PART_PAYMENT");
    const far = editPartPaymentPlan(w, a.id, { immediateAmount: 90_000, remainderDate: "2026-12-31" });
    const farAction = actionsFor(far, HERO.cash).filter((x) => x.type === "CREATE_PART_PAYMENT_LINK").at(-1)!;
    expect(farAction.status).toBe("BLOCKED");
    expect(farAction.policyEvaluation.reasonCodes).toContain("MAX_EXTENSION");
  });

  it("policy changes re-evaluate open actions", () => {
    const w2 = updatePolicy(w, { minPartPaymentAmount: 1_00_000 });
    const a = actionsFor(w2, HERO.cash).find((x) => x.type === "CREATE_PART_PAYMENT_LINK")!;
    expect(a.status).toBe("BLOCKED");
    expect(w2.policy.version).toBe(w.policy.version + 1);
  });

  it("flags pressure language", () => {
    expect(toneViolations("Final notice: pay immediately or face legal action")).not.toHaveLength(0);
    expect(toneViolations("Here is the payment link as discussed. Thank you.")).toHaveLength(0);
  });
});
