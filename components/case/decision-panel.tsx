"use client";

import { CalendarClock, Check, ExternalLink, FastForward, Landmark, UserCheck, X } from "lucide-react";
import { useState } from "react";
import { actionsFor, reminderGate } from "@/domain/engine";
import { formatINR } from "@/domain/money";
import { STATE_META } from "@/domain/state-machine";
import { formatDate, formatIst } from "@/domain/time";
import type { InvoiceCase, InvoiceState, ResolutionAction, WorldState } from "@/domain/types";
import { useResolve } from "@/lib/store";
import { Button, Card, ConfidenceBadge, Eyebrow, PolicyBadge, SimLabel, StateBadge } from "../ui";
import { ActionDrawer } from "./action-drawer";
import { ReviewPanel } from "./review-panel";

const OPEN: ResolutionAction["status"][] = ["PROPOSED", "REVIEW_REQUIRED", "BLOCKED"];

export function DecisionPanel({ world, c, onWhy }: { world: WorldState; c: InvoiceCase; onWhy: (ids: string[]) => void }) {
  const actions = actionsFor(world, c.id);
  const open = (t: ResolutionAction["type"]) => actions.filter((a) => a.type === t && OPEN.includes(a.status)).at(-1);
  const gate = reminderGate(world, c);
  const u = c.understanding;
  const last = c.transitions.at(-1)!;
  const ruleDriven = last.initiatedBy !== "AI";
  const explanation = last.initiatedBy === "AI" && u ? u.conciseExplanation : last.humanReadableReason;
  const whyIds = last.initiatedBy === "AI" && u ? Array.from(new Set([...last.evidenceIds, ...u.evidenceUsed])) : last.evidenceIds;
  const firstFail = gate.checks.find((x) => !x.passed && x.code !== "REMINDER_FREQUENCY_CAP");

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <Eyebrow>Resolve decision</Eyebrow>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StateBadge state={c.currentState} size="lg" />
          {last.initiatedBy === "AI" && u ? (
            <ConfidenceBadge band={u.confidenceBand} />
          ) : (
            <span className="rounded-md bg-line-2 px-2 py-0.5 text-[11px] font-semibold text-ink-2">
              {last.initiatedBy === "RULE" ? "DETERMINISTIC RULE" : last.initiatedBy === "TIMER" ? "TIMER" : last.initiatedBy === "MERCHANT" ? "MERCHANT DECISION" : "PAYMENT EVENT"}
            </span>
          )}
        </div>
        <p className="mt-3 text-[15px] leading-snug">{explanation}</p>
        {c.assessments?.length ? (
          <div className="mt-1.5 text-xs text-ink-3">
            Evidence:{" "}
            {c.assessments.at(-1)!.evidenceStrength === "CORROBORATED"
              ? "corroborated by a second source"
              : c.assessments.at(-1)!.evidenceStrength === "CONFLICTING"
                ? "conflicting sources"
                : "single source"}
            {c.assessments.length > 1 && ` · assessment updated ${formatIst(c.assessments.at(-1)!.at)}`}
          </div>
        ) : null}
        <button className="mt-2 text-xs font-medium text-brand-600 hover:underline" onClick={() => onWhy(whyIds)}>
          Why? Show the evidence
        </button>
        {ruleDriven && last.initiatedBy === "RULE" && last.reasonCode === "BANK_CREDIT_STRONG_MATCH" && (
          <div className="mt-2 text-xs text-ink-3">Bank matching is a deterministic rule — not an AI capability.</div>
        )}
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <Eyebrow>Buyer follow-up (Receivables Agent)</Eyebrow>
          <PolicyBadge decision={gate.decision} />
        </div>
        <div className="mt-1.5 text-sm text-ink-2">
          {gate.decision === "ALLOW" ? "Standard follow-up may continue." : firstFail?.label ?? "Blocked by policy."}
        </div>
      </Card>

      <StateActions world={world} c={c} open={open} />
      <Reclassify c={c} />
    </div>
  );
}

function StateActions({ world, c, open }: { world: WorldState; c: InvoiceCase; open: (t: ResolutionAction["type"]) => ResolutionAction | undefined }) {
  const store = useResolve();
  const [drawer, setDrawer] = useState(false);

  switch (c.currentState) {
    case "PAID_UNMATCHED": {
      const a = open("MATCH_PAYMENT");
      const credit = c.evidence.find((e) => e.id === a?.payload?.creditEvidenceId);
      const data = credit?.structuredExtraction?.kind === "BANK_CREDIT" ? credit.structuredExtraction.data : undefined;
      return (
        <Card className="p-4">
          <div className="flex items-center gap-2 font-semibold"><Landmark className="h-4 w-4 text-teal-600" aria-hidden /> Possible payment already received.</div>
          {data && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
              <div className="rounded-lg border border-line p-2.5">
                <div className="text-xs text-ink-3">Bank credit <SimLabel>Synthetic</SimLabel></div>
                <div className="num font-semibold">{formatINR(data.amount)}</div>
                <div className="text-xs text-ink-2">{data.payerName}</div>
                <div className="text-[11px] text-ink-3">{data.reference} · {formatIst(data.valueDate, { time: false })}</div>
              </div>
              <div className="rounded-lg border border-line p-2.5">
                <div className="text-xs text-ink-3">Invoice</div>
                <div className="num font-semibold">{formatINR(c.outstandingAmount)}</div>
                <div className="text-xs text-ink-2">{c.buyerContext.name}</div>
                <div className="text-[11px] text-ink-3">{c.invoiceNumber}</div>
              </div>
            </div>
          )}
          <Eyebrow className="mt-3">Match rationale</Eyebrow>
          <ul className="mt-1 list-inside list-disc text-sm text-ink-2">
            {((a?.payload?.rationale as string[]) ?? []).map((r) => <li key={r}>{r}</li>)}
          </ul>
          <div className="mt-2 text-xs text-ink-3">No buyer follow-up until this is reconciled.</div>
          {a && (
            <div className="mt-3 flex gap-2">
              <Button onClick={() => store.approve(a.id)}><Check className="h-4 w-4" aria-hidden /> Confirm match</Button>
              <Button variant="secondary" onClick={() => store.reject(a.id)}>Not the same payment</Button>
            </div>
          )}
        </Card>
      );
    }
    case "PAPERWORK_BLOCKED": {
      const a = open("DRAFT_CORRECTION");
      const corr = c.workflow?.correction;
      const ims = c.evidence.find((e) => e.type === "IMS_IMPORT");
      return (
        <Card className="p-4">
          <div className="font-semibold">No follow-up will be sent until Accounts reviews the correction.</div>
          <div className="mt-1 text-sm text-ink-2">Routed to <b>Accounts</b>. Reminders paused.</div>
          {ims && (
            <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950">
              Imported IMS evidence supports the buyer&apos;s message.
              <div className="text-[11px] text-amber-800">IMS is an imported export — no live GST portal access. It corroborates; it does not prove payment is withheld.</div>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between">
            <Eyebrow>Correction request draft</Eyebrow>
            <span className="text-[11px] font-semibold text-amber-800">{corr?.status === "DRAFTED" ? "APPROVAL REQUIRED" : corr?.status}</span>
          </div>
          <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-canvas p-3 font-mono text-[11.5px] leading-relaxed text-ink-2">{corr?.draft}</pre>
          <div className="mt-3 flex flex-wrap gap-2">
            {a && corr?.status === "DRAFTED" && (
              <>
                <Button onClick={() => store.approve(a.id)}><UserCheck className="h-4 w-4" aria-hidden /> Approve correction (Accounts)</Button>
                <Button variant="secondary" onClick={() => store.reject(a.id)}>Reject draft</Button>
              </>
            )}
            {corr?.status === "APPROVED" && <Button onClick={() => store.markCorrectionIssued(c.id)}>Mark corrected invoice issued</Button>}
          </div>
          {corr?.status === "APPROVED" && <div className="mt-2 text-xs text-ink-3">Resolve never issues tax documents. Mark it issued once your billing system has done so; follow-up then resumes if still unpaid.</div>}
        </Card>
      );
    }
    case "CASH_CONSTRAINED": {
      const a = open("CREATE_PART_PAYMENT_LINK");
      const plan = c.paymentPlan;
      const nextInst = plan?.installments.find((i) => i.status === "PENDING");
      return (
        <Card className="p-4">
          <div className="font-semibold">Buyer asked to split the payment.</div>
          <div className="mt-2 space-y-1.5">
            {plan?.installments.map((i, n) => (
              <div key={i.id} className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
                <span>{n === 0 ? "Now" : "Remainder"} · {i.dueDate ? formatDate(i.dueDate) : "date needed"}</span>
                <span className="flex items-center gap-2">
                  <span className="num font-semibold">{formatINR(i.amount)}</span>
                  <span className={`text-[11px] font-semibold ${i.status === "PAID" ? "text-emerald-700" : i.status === "MISSED" ? "text-rose-700" : "text-ink-3"}`}>{i.status}</span>
                </span>
              </div>
            ))}
          </div>
          {a && (
            <div className="mt-3 flex items-center gap-2">
              <Button onClick={() => setDrawer(true)}>Review plan</Button>
              <PolicyBadge decision={a.policyEvaluation.decision} />
            </div>
          )}
          {plan?.paymentLink && (
            <div className="mt-3 rounded-lg border border-line bg-canvas p-3 text-sm">
              <div className="flex items-center gap-2">
                <SimLabel className={plan.paymentLink.mode === "TEST_MODE" ? "border-brand/40 text-brand-600" : ""}>
                  {plan.paymentLink.mode === "TEST_MODE" ? "Test-mode link" : "Simulated payment link"}
                </SimLabel>
                <span className="num text-xs text-ink-3">{plan.paymentLink.id}</span>
              </div>
              {plan.paymentLink.mode === "TEST_MODE" ? (
                <a className="mt-1 inline-flex items-center gap-1 text-brand-600 hover:underline" href={plan.paymentLink.shortUrl} target="_blank" rel="noreferrer">
                  {plan.paymentLink.shortUrl} <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              ) : (
                <div className="mt-1 text-xs text-ink-3">{plan.paymentLink.fallbackReason}</div>
              )}
              <div className="mt-1 text-xs text-ink-2">
                Link for {formatINR(plan.paymentLink.amount)} · partial payments on · first payment ≥ {formatINR(plan.paymentLink.firstMinPartialAmount ?? 0)}
              </div>
            </div>
          )}
          {plan?.status === "ACTIVE" && nextInst && (
            <div className="mt-3">
              <Button variant="secondary" onClick={() => store.simulatePayment(c.id, nextInst.amount, `pay:${nextInst.id}`)}>Simulate payment received · {formatINR(nextInst.amount)}</Button>
              <div className="mt-1 text-[11px] text-ink-3">Generates a clearly labelled simulated PAYMENT_EVENT — test payment completion may be unavailable on the account.</div>
            </div>
          )}
          {drawer && a && <ActionDrawer action={a} c={c} onClose={() => setDrawer(false)} />}
        </Card>
      );
    }
    case "PROMISE_TO_PAY": {
      const p = c.promiseToPay!;
      const h = c.buyerContext.promiseHistory;
      return (
        <Card className="p-4">
          <div className="flex items-center gap-2 font-semibold"><CalendarClock className="h-4 w-4 text-violet-600" aria-hidden /> Recommended action: WAIT</div>
          <p className="mt-1 text-[15px]">
            {h.made > 0 ? <>Buyer kept <b>{h.kept} of {h.made}</b> previous promises. </> : "No promise history yet. "}
            Resolve recommends waiting until <b>{formatDate(p.promisedDate)}</b>.
          </p>
          <div className="mt-2 text-sm text-ink-2">
            No buyer follow-up until <span className="num font-medium">{formatIst(c.followUpSuppressedUntil ?? p.deadlineAt)}</span>
            <span className="text-ink-3"> ({c.followUpSuppressedReason ?? `${formatDate(p.promisedDate)} + grace`})</span>.
          </div>
          <div className="mt-2 rounded-lg bg-canvas px-3 py-2 text-xs text-ink-2">
            At that moment a timer re-checks payment. If still unpaid → follow-up resumes automatically and the promise is recorded as broken.
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => store.advanceClock(new Date(new Date(p.deadlineAt).getTime() + 60000).toISOString())}>
              <FastForward className="h-4 w-4" aria-hidden /> Advance demo clock past deadline
            </Button>
            <Button variant="secondary" onClick={() => store.simulatePayment(c.id, c.outstandingAmount, `pay:${c.id}:${c.evidence.length}`)}>Simulate payment received</Button>
          </div>
        </Card>
      );
    }
    case "NEEDS_REVIEW":
      return <ReviewPanel world={world} c={c} />;
    case "COMMERCIAL_DISPUTE": {
      const a = open("CREATE_CHILD_INVOICE");
      return (
        <Card className="p-4">
          <div className="font-semibold">Collections paused — routed to Sales.</div>
          {c.disputedAmount && <div className="mt-1 text-sm text-ink-2">Disputed: <span className="num font-medium">{formatINR(c.disputedAmount)}</span></div>}
          {a && (
            <div className="mt-3 rounded-lg border border-line p-3">
              <div className="text-sm">{a.summary}</div>
              <div className="mt-1 text-[11px] text-ink-3">One invoice never has two states: the undisputed amount becomes a linked child receivable.</div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => store.approve(a.id)}>Approve split</Button>
                <Button size="sm" variant="secondary" onClick={() => store.reject(a.id)}>Reject</Button>
              </div>
            </div>
          )}
        </Card>
      );
    }
    case "FOLLOW_UP_ACTIVE": {
      const broken = c.transitions.at(-1)?.reasonCode;
      const h = c.buyerContext.promiseHistory;
      return (
        <Card className="p-4">
          {broken === "PROMISE_BROKEN" ? (
            <>
              <div className="font-semibold text-rose-800">Promise missed. Follow-up resumed.</div>
              <div className="mt-1 text-sm text-ink-2">Promises: {h.made} · Kept: {h.kept} · Broken: {h.broken}</div>
            </>
          ) : broken === "CORRECTION_ISSUED" ? (
            <div className="text-sm text-ink-2">Correction issued and the invoice is still unpaid — handed back to the Receivables Agent for standard follow-up.</div>
          ) : broken === "MATCH_REJECTED" || broken === "PLAN_REJECTED" ? (
            <div className="text-sm text-ink-2">Merchant decision recorded — standard follow-up resumes.</div>
          ) : broken === "PAYMENT_PLAN_MISSED" ? (
            <div className="font-semibold text-rose-800">Agreed installment missed. Follow-up resumed.</div>
          ) : (
            <div className="text-sm text-ink-2">No blocker found — handed back to the Receivables Agent for standard follow-up.</div>
          )}
        </Card>
      );
    }
    case "RESOLVED":
      return (
        <Card className="p-4">
          <div className="flex items-center gap-2 font-semibold text-emerald-800"><Check className="h-4 w-4" aria-hidden /> Paid and reconciled.</div>
          <div className="mt-1 text-sm text-ink-2">All collection actions are blocked for this invoice.</div>
        </Card>
      );
  }
}

function Reclassify({ c }: { c: InvoiceCase }) {
  const { classify } = useResolve();
  const [open, setOpen] = useState(false);
  const allowed: InvoiceState[] = ["PAPERWORK_BLOCKED", "CASH_CONSTRAINED", "PROMISE_TO_PAY", "COMMERCIAL_DISPUTE"];
  if (!allowed.includes(c.currentState)) return null;
  return (
    <div className="text-xs">
      <button className="font-medium text-ink-3 hover:text-ink" onClick={() => setOpen(!open)}>
        {open ? <X className="inline h-3 w-3" /> : null} Override classification…
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {allowed.filter((s) => s !== c.currentState && s !== "PROMISE_TO_PAY").map((s) => (
            <Button key={s} size="sm" variant="secondary" onClick={() => classify(c.id, s, { note: "Merchant override" })}>
              {STATE_META[s].label}
            </Button>
          ))}
          <Button size="sm" variant="secondary" onClick={() => classify(c.id, "NEEDS_REVIEW" as InvoiceState)}>Send to review</Button>
        </div>
      )}
    </div>
  );
}
