import { describe, expect, it } from "vitest";
import { ALLOWED_TRANSITIONS, assertTransition, canTransition, TransitionError } from "@/domain/state-machine";
import { INVOICE_STATES } from "@/domain/types";
import { freshWorld, HERO } from "./helpers";

describe("state machine", () => {
  it("defines transitions for every state and RESOLVED is terminal", () => {
    for (const s of INVOICE_STATES) expect(ALLOWED_TRANSITIONS[s]).toBeDefined();
    expect(ALLOWED_TRANSITIONS.RESOLVED).toHaveLength(0);
  });

  it("AI can never mark an invoice paid or resolved", () => {
    for (const s of INVOICE_STATES) {
      expect(canTransition(s, "PAID_UNMATCHED", "AI")).toBe(false);
      expect(canTransition(s, "RESOLVED", "AI")).toBe(false);
    }
  });

  it("only the merchant can classify out of NEEDS_REVIEW (except payment rules)", () => {
    expect(canTransition("NEEDS_REVIEW", "PAPERWORK_BLOCKED", "AI")).toBe(false);
    expect(canTransition("NEEDS_REVIEW", "PAPERWORK_BLOCKED", "MERCHANT")).toBe(true);
  });

  it("promise can only time out via TIMER or MERCHANT", () => {
    expect(canTransition("PROMISE_TO_PAY", "FOLLOW_UP_ACTIVE", "TIMER")).toBe(true);
    expect(canTransition("PROMISE_TO_PAY", "FOLLOW_UP_ACTIVE", "AI")).toBe(false);
  });

  it("rejects transitions without evidence, illegal edges, low-confidence AI moves", () => {
    const w = freshWorld();
    const c = structuredClone(w.cases["inv-scp-1029"]); // plain follow-up
    const ev = c.evidence[0].id;
    const base = { triggerType: "CLASSIFICATION" as const, reasonCode: "X", humanReadableReason: "x" };
    expect(() => assertTransition(c, { ...base, to: "PAPERWORK_BLOCKED", initiatedBy: "AI", evidenceIds: [], confidenceBand: "HIGH" })).toThrow(TransitionError);
    expect(() => assertTransition(c, { ...base, to: "PAPERWORK_BLOCKED", initiatedBy: "AI", evidenceIds: [ev], confidenceBand: "NEEDS_REVIEW" })).toThrow(/HIGH confidence/);
    expect(() => assertTransition(c, { ...base, to: "PAID_UNMATCHED", initiatedBy: "RULE", evidenceIds: [ev] })).toThrow(/bank credit/);
    expect(() => assertTransition(c, { ...base, to: "RESOLVED", initiatedBy: "MERCHANT", evidenceIds: [ev] })).toThrow(/outstanding/);
    expect(() => assertTransition(c, { ...base, to: "PAPERWORK_BLOCKED", initiatedBy: "AI", evidenceIds: [ev], confidenceBand: "HIGH" })).not.toThrow();
  });

  it("paperwork cannot resume follow-up before the correction is issued", () => {
    const w = freshWorld();
    const c = structuredClone(w.cases[HERO.gst]);
    expect(c.currentState).toBe("PAPERWORK_BLOCKED");
    expect(() =>
      assertTransition(c, { to: "FOLLOW_UP_ACTIVE", initiatedBy: "MERCHANT", triggerType: "MERCHANT_DECISION", evidenceIds: [c.evidence[0].id], reasonCode: "X", humanReadableReason: "x" }),
    ).toThrow(/correction/);
  });

  it("every case has exactly one state and every transition cites existing evidence", () => {
    const w = freshWorld();
    for (const id of w.caseOrder) {
      const c = w.cases[id];
      expect(INVOICE_STATES).toContain(c.currentState);
      expect(c.transitions.at(-1)!.toState).toBe(c.currentState);
      const evIds = new Set(c.evidence.map((e) => e.id));
      for (const t of c.transitions) {
        expect(t.evidenceIds.length).toBeGreaterThan(0);
        for (const e of t.evidenceIds) expect(evIds.has(e)).toBe(true);
      }
    }
  });
});
