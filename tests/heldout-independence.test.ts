import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("held-out drafting independence", () => {
  const src = readFileSync(path.join(process.cwd(), "scripts/draft-heldout.ts"), "utf8");
  // Code only (comments stripped): imports and file reads must not touch the prompt or dev set.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  it("never imports or reads the classifier prompt or the development set", () => {
    expect(code).not.toMatch(/ai\/prompts|prompt-registry|case-classifier|development-cases|loadDevelopmentCases|demo-classifier|live-classifier/);
  });
  it("drafts with a different model family than the evaluated model", () => {
    expect(src).toMatch(/qwen\/qwen3\.8-27b/);
    expect(src).toMatch(/must differ from the evaluated model/);
  });
});
