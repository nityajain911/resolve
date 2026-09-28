/**
 * Classifier evaluation CLI.
 *
 *   npm run eval -- --set dev                 (development set — NOT held out)
 *   npm run eval -- --set heldout             (requires evaluation/heldout-cases.json)
 *   npm run eval -- --set heldout --provider live   (requires GROQ_API_KEY)
 *   add --publish to also write a frozen copy to evaluation/published/ (committed; shown in the UI)
 *
 * Writes evaluation/reports/<set>-<provider>-<timestamp>.json recording
 * promptVersion, promptHash, datasetHash, evaluationTimestamp and provider.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CLASSIFIER_PROMPT_VERSION, type CaseClassifier } from "@/ai/classifier";
import { DEMO_CLASSIFIER_VERSION, demoClassifier } from "@/ai/demo-classifier";
import { loadPrompt, loadPromptLock } from "@/ai/prompt-registry";
import { EVAL_DIR, loadDevelopmentCases, loadHeldoutCases } from "@/evaluation/heldout-loader";
import { evaluateClassifier } from "@/evaluation/metrics";

async function main() {
  const args = process.argv.slice(2);
  const get = (k: string, d: string) => {
    const i = args.indexOf(`--${k}`);
    return i >= 0 ? args[i + 1] : d;
  };
  const set = get("set", "dev");
  const providerName = get("provider", "demo");

  const prompt = loadPrompt(CLASSIFIER_PROMPT_VERSION);
  const lock = loadPromptLock()[CLASSIFIER_PROMPT_VERSION];
  if (!lock || lock.sha256 !== prompt.sha256) {
    throw new Error(`${CLASSIFIER_PROMPT_VERSION} does not match PROMPT_LOCK.json — create a new prompt version instead of editing a frozen one.`);
  }

  const loaded = set === "heldout" ? loadHeldoutCases() : loadDevelopmentCases();
  if (loaded.status === "PENDING") {
    console.log("Held-out evaluation pending: evaluation/heldout-cases.json not found. See evaluation/HELDOUT_INSTRUCTIONS.md.");
    return;
  }
  if (loaded.status === "INVALID") {
    console.error("Case file invalid:\n- " + loaded.errors.join("\n- "));
    process.exit(1);
  }
  if (set === "heldout" && loaded.file.meta.promptHashAtAuthoring && loaded.file.meta.promptHashAtAuthoring !== prompt.sha256) {
    console.warn("WARNING: held-out set was authored against a different prompt hash.");
  }

  let classifier: CaseClassifier = demoClassifier;
  if (providerName === "live") {
    if (!process.env.GROQ_API_KEY) throw new Error("--provider live requires GROQ_API_KEY");
    const { LiveCaseClassifier } = await import("@/ai/live-classifier");
    classifier = new LiveCaseClassifier({ patient: true });
  }

  const started = Date.now();
  const { predictions, providerErrors, metrics } = await evaluateClassifier(loaded.cases, classifier, (done, total, id, err) => {
    const s = Math.round((Date.now() - started) / 1000);
    console.log(`  [${String(done).padStart(2)}/${total}] ${id}${err ? `  PROVIDER ERROR: ${err}` : ""}  (${s}s)`);
  });
  const evaluationTimestamp = new Date().toISOString();
  const report = {
    set,
    heldOut: loaded.file.meta.heldOut,
    promptVersion: CLASSIFIER_PROMPT_VERSION,
    promptHash: prompt.sha256,
    promptAppliesToProvider: providerName === "live",
    datasetHash: loaded.datasetHash,
    evaluationTimestamp,
    provider: classifier.id,
    classifierVersion: providerName === "live" ? classifier.id : DEMO_CLASSIFIER_VERSION,
    datasetMeta: loaded.file.meta,
    metrics,
    providerErrors,
    predictions,
  };
  const out = path.join(EVAL_DIR, "reports", `${set}-${providerName}-${evaluationTimestamp.replace(/[:.]/g, "-")}.json`);
  writeFileSync(out, JSON.stringify(report, null, 2));
  if (args.includes("--publish")) {
    const pub = path.join(EVAL_DIR, "published", `${set}-${providerName}.json`);
    mkdirSync(path.dirname(pub), { recursive: true });
    writeFileSync(pub, JSON.stringify(report, null, 2));
    console.log(`Published: ${path.relative(process.cwd(), pub)}`);
  }

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  console.log(`${set.toUpperCase()} set${loaded.file.meta.heldOut ? "" : " (NOT HELD OUT)"} · ${metrics.n} cases · provider ${classifier.id}`);
  if (providerErrors.length) console.log(`Provider errors (excluded from metrics): ${providerErrors.length} — ${providerErrors.map((e) => e.caseId).join(", ")}`);
  console.log(`State accuracy ${pct(metrics.stateAccuracy)} · risk-weighted errors ${metrics.riskWeightedErrors} (HIGH ${metrics.errorsByTier.HIGH}, MOD ${metrics.errorsByTier.MODERATE}, LOW ${metrics.errorsByTier.LOW})`);
  console.log(`Temporal exact match ${metrics.temporal.correct}/${metrics.temporal.total} · ambiguous → review ${metrics.ambiguousHandling.routedToReview}/${metrics.ambiguousHandling.total}`);
  for (const s of metrics.perState) {
    const f = (v: number | null) => (v === null ? "  — " : v.toFixed(2));
    console.log(`  ${s.state.padEnd(20)} P ${f(s.precision)}  R ${f(s.recall)}  F1 ${f(s.f1)}  (n=${s.support})`);
  }
  console.log(`Report: ${path.relative(process.cwd(), out)}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
