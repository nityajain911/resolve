import { describe, expect, it } from "vitest";
import { actionsFor, approveAction } from "@/domain/engine";
import { splitInvoice, SplitError } from "@/domain/split";
import { freshWorld } from "./helpers";

const SPLIT_CASE = "inv-scp-1026";

describe("split invoices", () => {
  it("partial dispute: parent keeps dispute, child is follow-up, amounts reconcile", () => {
    const w = freshWorld();
    const parent0 = w.cases[SPLIT_CASE];
    expect(parent0.currentState).toBe("COMMERCIAL_DISPUTE");
    const before = parent0.outstandingAmount;
    const a = actionsFor(w, SPLIT_CASE).find((x) => x.type === "CREATE_CHILD_INVOICE")!;
    expect(a.status).toBe("REVIEW_REQUIRED");
    const w2 = approveAction(w, a.id);
    const parent = w2.cases[SPLIT_CASE];
    const child = w2.cases[parent.childInvoiceIds![0]];
    expect(parent.currentState).toBe("COMMERCIAL_DISPUTE");
    expect(child.currentState).toBe("FOLLOW_UP_ACTIVE");
    expect(child.parentInvoiceId).toBe(parent.id);
    expect(parent.outstandingAmount).toBe(50000);
    expect(child.outstandingAmount).toBe(150000);
    expect(parent.outstandingAmount + child.outstandingAmount).toBe(before);
    expect(w2.caseOrder).toContain(child.id);
  });

  it("rejects invalid splits", () => {
    const w = freshWorld();
    const ctx = { now: w.clock, childId: "c", noteEvidenceId: "n", childEvidenceId: "ce", childTransitionId: "t" };
    expect(() => splitInvoice(structuredClone(w.cases["inv-scp-1029"]), 1000, ctx)).toThrow(SplitError);
    expect(() => splitInvoice(structuredClone(w.cases[SPLIT_CASE]), 200000, ctx)).toThrow(SplitError);
  });
});
