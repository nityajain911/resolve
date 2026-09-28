/**
 * Held-out set import + validation (server/Node only).
 *
 * evaluation/heldout-cases.json must be authored SEPARATELY, after the classifier
 * prompt is frozen — see evaluation/HELDOUT_INSTRUCTIONS.md. If it is absent the UI
 * shows "Held-out evaluation pending" and no accuracy figure.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { EVIDENCE_TYPES, INVOICE_STATES } from "@/domain/types";
import { hashDataset } from "./hashing";
import { TEMPORAL_CATEGORIES, type CaseFile, type HeldoutCase } from "./types";

export const EVAL_DIR = path.join(process.cwd(), "evaluation");
export const HELDOUT_PATH = path.join(EVAL_DIR, "heldout-cases.json");
export const DEV_PATH = path.join(EVAL_DIR, "development-cases.json");

const TEMPORAL_TYPES = ["EXACT_DATE", "DATE_RANGE", "AFTER_DATE", "RELATIVE_DATE", "AMBIGUOUS"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateCases(raw: unknown): { cases: HeldoutCase[]; errors: string[] } {
  const errors: string[] = [];
  const file = raw as Partial<CaseFile>;
  if (!file || typeof file !== "object" || !Array.isArray(file.cases)) {
    return { cases: [], errors: ["File must be an object with a `cases` array (and a `meta` object)"] };
  }
  const ids = new Set<string>();
  file.cases.forEach((c, i) => {
    const at = `cases[${i}]${c?.id ? ` (${c.id})` : ""}`;
    if (!c || typeof c !== "object") return errors.push(`${at}: not an object`);
    if (typeof c.id !== "string" || !c.id) errors.push(`${at}: id required`);
    else if (ids.has(c.id)) errors.push(`${at}: duplicate id`);
    else ids.add(c.id);
    if (typeof c.message !== "string") errors.push(`${at}: message must be a string`);
    if (typeof c.messageTimestamp !== "string" || Number.isNaN(Date.parse(c.messageTimestamp))) {
      errors.push(`${at}: messageTimestamp must be an ISO timestamp`);
    }
    if (!INVOICE_STATES.includes(c.expectedState)) errors.push(`${at}: expectedState must be one of ${INVOICE_STATES.join(", ")}`);
    if (!Array.isArray(c.expectedExtractedAmounts) || c.expectedExtractedAmounts.some((a) => typeof a !== "number")) {
      errors.push(`${at}: expectedExtractedAmounts must be an array of numbers (rupees)`);
    }
    const t = c.expectedTemporalExpression;
    if (t !== null && t !== undefined) {
      if (!TEMPORAL_TYPES.includes(t.type)) errors.push(`${at}: expectedTemporalExpression.type invalid`);
      for (const k of ["normalizedDate", "lowerBound", "upperBound"] as const) {
        if (t[k] !== undefined && !ISO_DATE.test(t[k]!)) errors.push(`${at}: ${k} must be YYYY-MM-DD`);
      }
    } else if (t === undefined) {
      errors.push(`${at}: expectedTemporalExpression required (use null when none)`);
    }
    if (c.temporalCategory && !TEMPORAL_CATEGORIES.includes(c.temporalCategory)) errors.push(`${at}: unknown temporalCategory`);
    for (const e of c.optionalSupportingEvidence ?? []) {
      if (!EVIDENCE_TYPES.includes(e.type)) errors.push(`${at}: supporting evidence type ${e.type} invalid`);
    }
    if (typeof c.notes !== "string") errors.push(`${at}: notes required (may be empty)`);
  });
  return { cases: errors.length ? [] : (file.cases as HeldoutCase[]), errors };
}

export type LoadResult =
  | { status: "PENDING" }
  | { status: "INVALID"; errors: string[] }
  | { status: "LOADED"; file: CaseFile; cases: HeldoutCase[]; datasetHash: string };

export function loadCaseFile(p: string): LoadResult {
  if (!existsSync(p)) return { status: "PENDING" };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(p, "utf8"));
  } catch (e) {
    return { status: "INVALID", errors: [`Invalid JSON: ${(e as Error).message}`] };
  }
  const { cases, errors } = validateCases(raw);
  if (errors.length) return { status: "INVALID", errors };
  return { status: "LOADED", file: raw as CaseFile, cases, datasetHash: hashDataset(cases) };
}

export function loadHeldoutCases(): LoadResult {
  const r = loadCaseFile(HELDOUT_PATH);
  if (r.status === "LOADED" && (r.file.meta?.heldOut !== true || r.file.meta?.set !== "heldout")) {
    return { status: "INVALID", errors: ["meta.set must be \"heldout\" and meta.heldOut must be true"] };
  }
  return r;
}

export function loadDevelopmentCases(): LoadResult {
  return loadCaseFile(DEV_PATH);
}
