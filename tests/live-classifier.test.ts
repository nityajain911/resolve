import { describe, expect, it } from "vitest";
import { LIVE_MODEL, renderPrompt, UNDERSTANDING_JSON_SCHEMA } from "@/ai/live-classifier";
import { loadPrompt } from "@/ai/prompt-registry";

type Node = { type?: unknown; properties?: Record<string, Node>; required?: string[]; additionalProperties?: unknown; items?: Node };

function strictViolations(n: Node, path = "$"): string[] {
  const out: string[] = [];
  if (n.type === "object") {
    const keys = Object.keys(n.properties ?? {});
    if (n.additionalProperties !== false) out.push(`${path}: additionalProperties must be false`);
    const missing = keys.filter((k) => !(n.required ?? []).includes(k));
    if (missing.length) out.push(`${path}: not required: ${missing.join(", ")}`);
    for (const k of keys) out.push(...strictViolations(n.properties![k], `${path}.${k}`));
  }
  if (n.items) out.push(...strictViolations(n.items, `${path}[]`));
  return out;
}

describe("Groq live classifier", () => {
  it("defaults to openai/gpt-oss-120b", () => {
    if (!process.env.RESOLVE_LIVE_MODEL) expect(LIVE_MODEL).toBe("openai/gpt-oss-120b");
  });

  it("schema satisfies Groq strict-mode rules", () => {
    expect(strictViolations(UNDERSTANDING_JSON_SCHEMA as Node)).toEqual([]);
  });

  it("renders the frozen prompt with the message timestamp", () => {
    const text = renderPrompt(loadPrompt("case-classifier-v1").text, {
      primaryEvidence: { id: "e1", type: "BUYER_MESSAGE", text: "Monday tak kar denge", timestamp: "2026-09-24T09:40:00.000Z" },
      supportingEvidence: [],
      invoice: { invoiceNumber: "SCP-1061", amount: 184080, outstandingAmount: 184080, dueAt: "2026-09-10T18:29:00.000Z" },
      buyerName: "Vasundhara Home Care Ltd",
    });
    expect(text).toContain("2026-09-24T09:40:00.000Z");
    expect(text).toContain("Monday tak kar denge");
    expect(text).not.toMatch(/\{\{\w+\}\}/);
  });
});
