import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildInvoiceBook } from "@/data/synthetic/invoice-book";

const ROOT = path.resolve(__dirname, "..");
const GROUND_TRUTH = path.join(ROOT, "data/synthetic/ground-truth.ts");
const GENERATOR = path.join(ROOT, "data/synthetic/generator.ts");

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

function importsOf(file: string): string[] {
  const src = readFileSync(file, "utf8");
  const specs = [...src.matchAll(/(?:from\s+|import\s*\(\s*|import\s+)["']([^"']+)["']/g)].map((m) => m[1]);
  return specs.map((s) => resolveImport(file, s)).filter((x): x is string => Boolean(x));
}

function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    if (/\.(ts|tsx)$/.test(f)) stack.push(...importsOf(f));
  }
  return seen;
}

const rel = (p: string) => path.relative(ROOT, p);

describe("hidden ground truth isolation", () => {
  it("decision code (/domain, /ai, /integrations) never reaches synthetic data or the evaluation harness", () => {
    const offenders: string[] = [];
    for (const f of ["domain", "ai", "integrations"].flatMap((d) => walk(path.join(ROOT, d)))) {
      for (const dep of reachable(f)) {
        const r = rel(dep);
        if (r.startsWith("data/") || r.startsWith("evaluation/")) offenders.push(`${rel(f)} → ${r}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("app store, components and API routes never import ground truth or the generator directly", () => {
    const offenders: string[] = [];
    const files = ["lib", "components", "app/api"].flatMap((d) => walk(path.join(ROOT, d)));
    for (const f of files) {
      for (const dep of reachable(f)) {
        if (dep === GROUND_TRUTH || rel(dep).startsWith("evaluation/")) offenders.push(`${rel(f)} → ${rel(dep)}`);
      }
      for (const dep of importsOf(f)) if (dep === GENERATOR) offenders.push(`${rel(f)} imports generator directly`);
    }
    expect(offenders).toEqual([]);
  });

  it("only /evaluation (and tests) import ground-truth.ts", () => {
    const importers = walk(ROOT)
      .filter((f) => !f.includes("node_modules") && !f.includes(`${path.sep}.next${path.sep}`))
      .filter((f) => importsOf(f).includes(GROUND_TRUTH))
      .map(rel)
      .filter((r) => !r.startsWith("evaluation/") && !r.startsWith("tests/") && !r.startsWith("scripts/"));
    expect(importers).toEqual([]);
  });

  it("the observable book carries no ground-truth fields", () => {
    const json = JSON.stringify(buildInvoiceBook());
    for (const key of ["trueBlocker", "actuallyPaid", "activeCommercialDispute", "archetype", "signalObservable", "reconciledInLedger"]) {
      expect(json).not.toContain(key);
    }
  });
});
