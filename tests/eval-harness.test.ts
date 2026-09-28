import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { demoClassifier } from "@/ai/demo-classifier";
import { loadPrompt, loadPromptLock, sha256 } from "@/ai/prompt-registry";
import { errorRisk } from "@/evaluation/cost-matrix";
import { canonicalJson, hashDataset } from "@/evaluation/hashing";
import { loadDevelopmentCases, loadHeldoutCases, validateCases } from "@/evaluation/heldout-loader";
import { computeMetrics, evaluateClassifier, scoreCase } from "@/evaluation/metrics";
import type { HeldoutCase } from "@/evaluation/types";

describe("prompt freeze + hashing", () => {
  it("case-classifier-v1 matches its frozen hash", () => {
    const lock = loadPromptLock();
    const p = loadPrompt("case-classifier-v1");
    expect(p.sha256).toBe(lock["case-classifier-v1"].sha256);
    expect(p.sha256).toBe(sha256(readFileSync(path.join(process.cwd(), "ai/prompts/case-classifier-v1.md"), "utf8")));
  });

  it("dataset hash is stable under key order and sensitive to content", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
    expect(hashDataset({ a: 1, b: 2 })).toBe(hashDataset({ b: 2, a: 1 }));
    expect(hashDataset({ a: 1 })).not.toBe(hashDataset({ a: 2 }));
  });
});

describe("held-out handling", () => {
  it("no held-out file → PENDING (no fake accuracy)", () => {
    expect(loadHeldoutCases().status).toBe("PENDING");
  });

  it("validates schema", () => {
    expect(validateCases({ cases: [{ id: "x" }] }).errors.length).toBeGreaterThan(0);
    const dev = loadDevelopmentCases();
    expect(dev.status).toBe("LOADED");
    if (dev.status === "LOADED") expect(dev.file.meta.heldOut).toBe(false);
  });
});

describe("metrics", () => {
  it("asymmetric costs", () => {
    expect(errorRisk("COMMERCIAL_DISPUTE", "FOLLOW_UP_ACTIVE")?.tier).toBe("HIGH");
    expect(errorRisk("PAPERWORK_BLOCKED", "FOLLOW_UP_ACTIVE")?.tier).toBe("HIGH");
    expect(errorRisk("FOLLOW_UP_ACTIVE", "PAPERWORK_BLOCKED")?.tier).toBe("MODERATE");
    expect(errorRisk("FOLLOW_UP_ACTIVE", "NEEDS_REVIEW")?.tier).toBe("LOW");
    expect(errorRisk("PROMISE_TO_PAY", "PROMISE_TO_PAY")).toBeNull();
  });

  it("per-state precision/recall and risk-weighted errors", () => {
    const u = (s: HeldoutCase["expectedState"]) => ({ proposedState: s, confidenceBand: "HIGH" as const, extractedAmounts: [], temporalExpressions: [], entities: {}, evidenceUsed: [], conciseExplanation: "", provider: "t" });
    const base = { message: "", messageTimestamp: "2026-09-25T05:30:00.000Z", expectedExtractedAmounts: [], expectedTemporalExpression: null, notes: "" };
    const preds = [
      scoreCase({ ...base, id: "1", expectedState: "COMMERCIAL_DISPUTE" }, u("FOLLOW_UP_ACTIVE")),
      scoreCase({ ...base, id: "2", expectedState: "FOLLOW_UP_ACTIVE" }, u("FOLLOW_UP_ACTIVE")),
      scoreCase({ ...base, id: "3", expectedState: "FOLLOW_UP_ACTIVE" }, u("NEEDS_REVIEW")),
    ];
    const m = computeMetrics(preds);
    const fu = m.perState.find((s) => s.state === "FOLLOW_UP_ACTIVE")!;
    expect(fu.precision).toBe(0.5);
    expect(fu.recall).toBe(0.5);
    expect(m.riskWeightedErrors).toBe(3 + 1);
  });

  it("development set (NOT held out) regression check", async () => {
    const dev = loadDevelopmentCases();
    if (dev.status !== "LOADED") throw new Error("dev set missing");
    const { predictions, metrics } = await evaluateClassifier(dev.cases, demoClassifier);
    const failing = predictions.filter((p) => !p.stateCorrect || p.temporalCorrect === false);
    expect(failing.map((f) => f.caseId)).toEqual([]);
    expect(metrics.ambiguousHandling.routedToReview).toBe(metrics.ambiguousHandling.total);
  });
});
