import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { Card, Eyebrow, SimLabel, StateBadge } from "@/components/ui";
import { CLASSIFIER_PROMPT_VERSION } from "@/ai/classifier";
import { classifyDemo, demoClassifier } from "@/ai/demo-classifier";
import { loadPrompt, loadPromptLock } from "@/ai/prompt-registry";
import { buildInvoiceBook } from "@/data/synthetic/invoice-book";
import { createWorld } from "@/domain/engine";
import { formatINR } from "@/domain/money";
import { STATE_META } from "@/domain/state-machine";
import { formatIst } from "@/domain/time";
import { INVOICE_STATES } from "@/domain/types";
import { COST_MATRIX_EXAMPLES, errorRisk, RISK_WEIGHT } from "@/evaluation/cost-matrix";
import { EVAL_DIR, loadDevelopmentCases, loadHeldoutCases } from "@/evaluation/heldout-loader";
import { evaluateClassifier, type ClassifierMetrics } from "@/evaluation/metrics";
import { computeWrongChaseReport } from "@/evaluation/wrong-chase";

export const dynamic = "force-dynamic";

function latestReport(set: string, provider: string) {
  const dir = path.join(EVAL_DIR, "reports");
  if (!existsSync(dir)) return null;
  const f = readdirSync(dir).filter((x) => x.startsWith(`${set}-${provider}-`) && x.endsWith(".json")).sort().at(-1);
  return f ? JSON.parse(readFileSync(path.join(dir, f), "utf8")) : null;
}

const pct = (x: number | null) => (x === null ? "—" : `${Math.round(x * 100)}%`);

export default async function EvaluationPage() {
  const r = computeWrongChaseReport();
  const prompt = loadPrompt(CLASSIFIER_PROMPT_VERSION);
  const lock = loadPromptLock()[CLASSIFIER_PROMPT_VERSION];
  const heldout = loadHeldoutCases();
  const dev = loadDevelopmentCases();
  const devResult = dev.status === "LOADED" ? await evaluateClassifier(dev.cases, demoClassifier) : null;
  const heldoutResult = heldout.status === "LOADED" ? await evaluateClassifier(heldout.cases, demoClassifier) : null;
  const liveReport = heldout.status === "LOADED" ? latestReport("heldout", "live") : null;

  const snapshot = createWorld(buildInvoiceBook(), { classify: classifyDemo });
  const byState = INVOICE_STATES.map((s) => ({ s, n: snapshot.caseOrder.filter((id) => snapshot.cases[id].currentState === s).length }));
  const buyers = Object.values(snapshot.buyers);
  const promisesMade = buyers.reduce((a, b) => a + b.promiseHistory.made, 0);
  const promisesKept = buyers.reduce((a, b) => a + b.promiseHistory.kept, 0);
  const activePromises = snapshot.caseOrder.filter((id) => snapshot.cases[id].promiseToPay?.status === "ACTIVE").length;

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Evaluation & impact</h1>
          <p className="mt-1 text-ink-2">Every number on this page is computed by code from the labelled synthetic invoice book or an evaluation file. Nothing is hardcoded.</p>
        </div>
        <div className="flex gap-2"><SimLabel>Synthetic invoice book · seed {r.seed}</SimLabel><SimLabel>Snapshot {formatIst(r.snapshotAt)}</SimLabel></div>
      </div>

      {/* 1. WRONG CHASE */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">1 · Can Resolve avoid the wrong chase?</h2>
        <Card className="p-5">
          <div className="text-sm text-ink-2"><b>Definition.</b> {r.definition} The reminder-only baseline sends the next standard reminder on every escalated invoice still open in the ledger ({r.baselineChases} of {r.totalInvoices}).</div>
          <div className="mt-5 grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-line bg-canvas p-4">
              <Eyebrow>Reminder-only baseline</Eyebrow>
              <div className="num mt-1 text-4xl font-semibold">{r.M}</div>
              <div className="text-sm text-ink-2">wrong chases (M)</div>
            </div>
            <div className="rounded-xl border border-brand bg-brand-50 p-4">
              <Eyebrow>Resolve</Eyebrow>
              <div className="num mt-1 text-4xl font-semibold text-brand-600">{r.N} <span className="text-xl text-ink-3">of {r.M}</span></div>
              <div className="text-sm text-ink-2">wrong chases blocked (N)</div>
            </div>
            <div className="rounded-xl border border-rose-200 bg-rose-50/60 p-4">
              <Eyebrow>Still missed</Eyebrow>
              <div className="num mt-1 text-4xl font-semibold text-rose-700">{r.M - r.N}</div>
              <div className="text-sm text-ink-2">not detected (M − N)</div>
            </div>
          </div>
          <p className="mt-4 text-[15px] font-medium">Resolve blocked {r.N} of {r.M} wrong chases in this labelled synthetic invoice book.</p>
          <p className="mt-1 text-xs text-ink-3">Resolve&apos;s decisions come only from observable evidence. Hidden ground truth is read solely by this evaluation harness. The classifier here is {r.classifier} — this measures the system design on synthetic data, not model accuracy.</p>
        </Card>

        <div className="grid grid-cols-2 gap-4">
          <Card className="p-5">
            <Eyebrow>Remaining misses — honest limits</Eyebrow>
            <ul className="mt-3 space-y-3">
              {r.misses.map((m) => (
                <li key={m.invoiceId} className="text-sm">
                  <div className="flex items-center gap-2"><span className="num font-medium">{m.invoiceNumber}</span><span className="text-ink-3">{m.buyer}</span><span className="ml-auto text-xs text-rose-700">{m.wrongReason === "ALREADY_PAID" ? "Already paid" : "Active dispute"}</span></div>
                  <div className="mt-0.5 text-ink-2">{m.truthNote}</div>
                  <div className="text-xs text-ink-3">{m.signalObservable ? "A signal existed but did not meet the deterministic rule." : "Resolve could not detect this because no bank, payment or buyer signal was available."}</div>
                </li>
              ))}
            </ul>
          </Card>
          <Card className="p-5">
            <Eyebrow>Wrong chases Resolve blocked</Eyebrow>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {r.blocked.map((b) => (
                  <tr key={b.invoiceId} className="border-b border-line-2 last:border-0">
                    <td className="num py-1.5 font-medium">{b.invoiceNumber}</td>
                    <td className="py-1.5 text-xs text-ink-3">{b.wrongReason === "ALREADY_PAID" ? "paid" : "disputed"}</td>
                    <td className="py-1.5"><StateBadge state={b.resolveState} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-4 border-t border-line pt-3 text-sm">
              <Eyebrow>Cost of caution</Eyebrow>
              <div className="mt-1 text-ink-2">Resolve also paused follow-up on <b>{r.unnecessaryPauses.length}</b> invoice(s) with no real blocker:</div>
              <ul className="mt-1 list-inside list-disc text-xs text-ink-2">
                {r.unnecessaryPauses.map((u) => <li key={u.invoiceId}><span className="num">{u.invoiceNumber}</span> ({STATE_META[u.resolveState].label}) — {u.truthNote}</li>)}
              </ul>
            </div>
            <div className="mt-3 border-t border-line pt-3 text-sm text-ink-2">
              <Eyebrow>Secondary metric · avoidable follow-up</Eyebrow>
              <div className="mt-1">Also counting invoices whose true blocker is paperwork: Resolve paused <b>{r.avoidable.blocked}</b> of <b>{r.avoidable.total}</b>. Reported separately — the headline definition does not change.</div>
            </div>
          </Card>
        </div>
      </section>

      {/* 2. CLASSIFIER */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">2 · Classifier evaluation</h2>
        <div className="grid grid-cols-[1fr_360px] gap-4">
          <Card className="p-5">
            {heldout.status === "PENDING" && (
              <div className="rounded-xl border border-dashed border-amber-400 bg-amber-50/50 p-5">
                <div className="text-lg font-semibold">Held-out evaluation pending</div>
                <p className="mt-1 text-sm text-ink-2">No independently authored held-out set has been imported, so no model accuracy is shown. Held-out cases must be written after the prompt is frozen, by someone other than the classifier developer — see <code>evaluation/HELDOUT_INSTRUCTIONS.md</code>.</p>
              </div>
            )}
            {heldout.status === "INVALID" && (
              <div className="rounded-xl border border-rose-300 bg-rose-50 p-5 text-sm">
                <div className="font-semibold">Held-out file is invalid</div>
                <ul className="mt-1 list-inside list-disc">{heldout.errors.slice(0, 8).map((e) => <li key={e}>{e}</li>)}</ul>
              </div>
            )}
            {heldout.status === "LOADED" && heldoutResult && (
              <MetricsView title={`Held-out set · ${heldout.cases.length} cases · demo classifier`} m={heldoutResult.metrics} meta={`Dataset ${heldout.datasetHash.slice(0, 12)} · authored by ${heldout.file.meta.authoredBy}`} />
            )}
            {liveReport && (
              <div className="mt-4 text-xs text-ink-3">Latest live-provider report: {liveReport.provider} · {liveReport.evaluationTimestamp} · state accuracy {pct(liveReport.metrics.stateAccuracy)} · risk-weighted errors {liveReport.metrics.riskWeightedErrors}</div>
            )}
            {devResult && (
              <div className="mt-5 border-t border-line pt-4">
                <div className="flex items-center gap-2">
                  <Eyebrow>Development set regression check</Eyebrow>
                  <span className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 ring-1 ring-rose-200">NOT HELD OUT</span>
                </div>
                <p className="mt-1 text-sm text-ink-2">
                  {devResult.predictions.filter((p) => p.stateCorrect).length} of {devResult.predictions.length} development cases pass. These were written while building the parser — passing them is a regression check, <b>not</b> an accuracy claim.
                </p>
              </div>
            )}
          </Card>
          <div className="space-y-4">
            <Card className="p-4 text-sm">
              <Eyebrow>Prompt freeze</Eyebrow>
              <div className="mt-2 space-y-1 text-ink-2">
                <div>Version <code className="text-ink">{CLASSIFIER_PROMPT_VERSION}</code></div>
                <div>SHA-256 <code className="num text-[11px] text-ink">{prompt.sha256.slice(0, 20)}…</code></div>
                <div>{lock?.sha256 === prompt.sha256 ? <span className="text-emerald-700">Matches PROMPT_LOCK.json (frozen {lock.frozenAt})</span> : <span className="text-rose-700">Does not match lock — create v2</span>}</div>
              </div>
              <p className="mt-2 text-xs text-ink-3">Once a held-out set has been evaluated, changing the prompt requires a new version and ideally a fresh held-out set.</p>
            </Card>
            <Card className="p-4">
              <Eyebrow>Asymmetric error costs (unitless)</Eyebrow>
              <table className="mt-2 w-full text-xs">
                <tbody>
                  {COST_MATRIX_EXAMPLES.map(({ expected, predicted }) => {
                    const e = errorRisk(expected, predicted)!;
                    return (
                      <tr key={expected + predicted} className="border-b border-line-2 last:border-0">
                        <td className="py-1.5">{STATE_META[expected].short} → {STATE_META[predicted].short}</td>
                        <td className={`py-1.5 text-right font-semibold ${e.tier === "HIGH" ? "text-rose-700" : e.tier === "MODERATE" ? "text-amber-700" : "text-ink-3"}`}>{e.tier} ({RISK_WEIGHT[e.tier]})</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="mt-2 text-[11px] text-ink-3">No rupee values are attached to errors.</p>
            </Card>
          </div>
        </div>
      </section>

      {/* 3. PILOT METRIC */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">3 · Pilot metric</h2>
        <Card className="border-brand p-5">
          <span className="rounded bg-brand px-2 py-0.5 text-[11px] font-bold tracking-wide text-white">PILOT METRIC</span>
          <div className="mt-2 text-xl font-semibold">Incremental cash collected within 30 days on invoices escalated after standard reminders failed.</div>
          <p className="mt-2 text-sm text-ink-2">The prototype does <b>not</b> simulate this result. Whether a buyer would pay after a resolution action depends on real behaviour, which synthetic data cannot honestly model.</p>
          <div className="mt-4 grid grid-cols-3 gap-3 text-sm">
            <div className="rounded-lg bg-canvas p-3"><b>Eligible</b><div className="text-ink-2">Invoices escalated after the Receivables Agent&apos;s standard reminders and calls fail.</div></div>
            <div className="rounded-lg bg-canvas p-3"><b>Randomise</b><div className="text-ink-2">Resolve cohort vs reminder-only holdout, at invoice or buyer level.</div></div>
            <div className="rounded-lg bg-canvas p-3"><b>Measure</b><div className="text-ink-2">Cash collected within 30 days of escalation; plus wrong chases and merchant review time as guardrails.</div></div>
          </div>
        </Card>
      </section>

      {/* 4. SUPPORTING */}
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">4 · Supporting countable metrics <span className="text-sm font-normal text-ink-3">(book snapshot at demo start)</span></h2>
        <div className="grid grid-cols-[1fr_320px] gap-4">
          <Card className="p-5">
            <Eyebrow>Invoices routed by state</Eyebrow>
            <div className="mt-3 flex flex-wrap gap-2">
              {byState.map(({ s, n }) => (
                <span key={s} className="inline-flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5"><StateBadge state={s} /><span className="num font-semibold">{n}</span></span>
              ))}
            </div>
            <div className="mt-3 text-xs text-ink-3">Needs review: {byState.find((x) => x.s === "NEEDS_REVIEW")?.n} invoices held back from any buyer message.</div>
          </Card>
          <Card className="p-5 text-sm">
            <Eyebrow>Promises & overrides</Eyebrow>
            <div className="mt-2 space-y-1 text-ink-2">
              <div>Closed promises across buyers: <b className="num">{promisesMade}</b> · kept <b className="num">{promisesKept}</b></div>
              <div>Active promises being waited on: <b className="num">{activePromises}</b></div>
              <div>Merchant overrides at snapshot: <b className="num">{snapshot.labelledReviewSet.length}</b> (live count on Policy page)</div>
              <div className="text-xs text-ink-3">Evidence-to-classification latency is not reported: synthetic timestamps do not support a meaningful measure.</div>
              <div className="num text-xs text-ink-3">Book total {formatINR(buildInvoiceBook().invoices.reduce((s, i) => s + i.amount, 0))}</div>
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
}

function MetricsView({ title, m, meta }: { title: string; m: ClassifierMetrics; meta: string }) {
  return (
    <div>
      <div className="font-semibold">{title}</div>
      <div className="text-xs text-ink-3">{meta}</div>
      <div className="mt-3 grid grid-cols-4 gap-3 text-sm">
        <div className="rounded-lg bg-canvas p-3"><div className="text-xs text-ink-3">State accuracy</div><div className="num text-xl font-semibold">{pct(m.stateAccuracy)}</div></div>
        <div className="rounded-lg bg-canvas p-3"><div className="text-xs text-ink-3">Risk-weighted errors</div><div className="num text-xl font-semibold">{m.riskWeightedErrors}</div><div className="text-[11px] text-ink-3">H {m.errorsByTier.HIGH} · M {m.errorsByTier.MODERATE} · L {m.errorsByTier.LOW}</div></div>
        <div className="rounded-lg bg-canvas p-3"><div className="text-xs text-ink-3">Relative-date exact match</div><div className="num text-xl font-semibold">{m.temporal.correct}/{m.temporal.total}</div></div>
        <div className="rounded-lg bg-canvas p-3"><div className="text-xs text-ink-3">Ambiguous → review</div><div className="num text-xl font-semibold">{m.ambiguousHandling.routedToReview}/{m.ambiguousHandling.total}</div></div>
      </div>
      <table className="mt-3 w-full text-xs">
        <thead className="text-left text-ink-3"><tr><th className="py-1">State</th><th>n</th><th>Precision</th><th>Recall</th><th>F1</th></tr></thead>
        <tbody>
          {m.perState.map((s) => (
            <tr key={s.state} className="border-t border-line-2"><td className="py-1">{STATE_META[s.state].label}</td><td className="num">{s.support}</td><td className="num">{pct(s.precision)}</td><td className="num">{pct(s.recall)}</td><td className="num">{s.f1 === null ? "—" : s.f1.toFixed(2)}</td></tr>
          ))}
        </tbody>
      </table>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-ink-3">
        {Object.entries(m.temporal.byCategory).map(([k, v]) => <span key={k} className="rounded bg-line-2 px-1.5 py-0.5">{k}: {v.correct}/{v.total}</span>)}
      </div>
    </div>
  );
}
