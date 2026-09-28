/**
 * Versioned prompt registry (server/Node only). Prompts are immutable once frozen:
 * PROMPT_LOCK.json records the SHA-256 of each frozen version.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const PROMPTS_DIR = path.join(process.cwd(), "ai", "prompts");

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function loadPrompt(version: string): { version: string; text: string; sha256: string } {
  const text = readFileSync(path.join(PROMPTS_DIR, `${version}.md`), "utf8");
  return { version, text, sha256: sha256(text) };
}

export function loadPromptLock(): Record<string, { sha256: string; frozenAt: string; note?: string }> {
  return JSON.parse(readFileSync(path.join(PROMPTS_DIR, "PROMPT_LOCK.json"), "utf8"));
}
