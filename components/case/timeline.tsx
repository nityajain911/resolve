"use client";

import clsx from "clsx";
import { ArrowRight, Timer } from "lucide-react";
import { actionsFor } from "@/domain/engine";
import { formatINR } from "@/domain/money";
import { formatIst } from "@/domain/time";
import type { Evidence, InvoiceCase, ResolutionAction, ScheduledEvent, StateTransition, WorldState } from "@/domain/types";
import { EVIDENCE_ICON, PolicyBadge, SimLabel, StateBadge } from "../ui";

type Item =
  | { at: string; order: number; kind: "evidence"; ev: Evidence }
  | { at: string; order: number; kind: "transition"; t: StateTransition }
  | { at: string; order: number; kind: "action"; a: ResolutionAction; phase: "proposed" | "decided" }
  | { at: string; order: number; kind: "timer"; tm: ScheduledEvent; phase: "scheduled" | "fired" };

const ACTION_LABEL: Record<ResolutionAction["type"], string> = {
  MATCH_PAYMENT: "Match payment",
  STOP_FOLLOW_UP: "Stop follow-up",
  ROUTE_TO_ACCOUNTS: "Route to Accounts",
  DRAFT_CORRECTION: "Draft correction",
  CREATE_PART_PAYMENT_LINK: "Part-payment link",
  WAIT_UNTIL_DATE: "Wait until date",
  RESUME_FOLLOW_UP: "Resume follow-up",
  REQUEST_HUMAN_REVIEW: "Request human review",
  CREATE_CHILD_INVOICE: "Split invoice",
  SEND_REMINDER: "Send reminder",
};

const INITIATOR: Record<string, string> = { AI: "AI classification", RULE: "Rule", MERCHANT: "Merchant", TIMER: "Timer", PAYMENT_EVENT: "Payment event" };

export function Timeline({ world, c, highlight, onWhy }: { world: WorldState; c: InvoiceCase; highlight: string[]; onWhy: (ids: string[]) => void }) {
  const items: Item[] = [];
  let o = 0;
  for (const ev of c.evidence) items.push({ at: ev.timestamp, order: o++, kind: "evidence", ev });
  for (const t of c.transitions) items.push({ at: t.timestamp, order: o++, kind: "transition", t });
  for (const a of actionsFor(world, c.id)) {
    items.push({ at: a.createdAt, order: o++, kind: "action", a, phase: "proposed" });
    if (a.executedAt && a.executedAt !== a.createdAt) items.push({ at: a.executedAt, order: o++, kind: "action", a, phase: "decided" });
  }
  for (const tm of world.timers.filter((t) => t.invoiceId === c.id)) {
    items.push({ at: tm.createdAt, order: o++, kind: "timer", tm, phase: "scheduled" });
    if (tm.firedAt) items.push({ at: tm.firedAt, order: o++, kind: "timer", tm, phase: "fired" });
  }
  items.sort((a, b) => a.at.localeCompare(b.at) || a.order - b.order);

  return (
    <ol className="relative space-y-3 before:absolute before:bottom-2 before:left-[15px] before:top-2 before:w-px before:bg-line">
      {items.map((it, i) => (
        <li key={i} className="relative flex gap-3">
          <Node it={it} />
          <div className="min-w-0 flex-1 pb-1">{render(it, highlight, onWhy)}</div>
        </li>
      ))}
    </ol>
  );
}

function Node({ it }: { it: Item }) {
  const key = it.kind === "evidence" ? it.ev.type : it.kind === "transition" ? "TRANSITION" : it.kind === "timer" ? "TIMER" : "ACTION";
  const Icon = EVIDENCE_ICON[key].icon;
  return (
    <span
      className={clsx(
        "relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full border bg-white",
        it.kind === "transition" ? "border-brand text-brand" : "border-line text-ink-3",
      )}
    >
      <Icon className="h-4 w-4" aria-hidden />
    </span>
  );
}

function Meta({ at, label, extra }: { at: string; label: string; extra?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
      <span className="font-semibold uppercase tracking-wide text-ink-2">{label}</span>
      <span className="num">{formatIst(at)}</span>
      {extra}
    </div>
  );
}

function render(it: Item, highlight: string[], onWhy: (ids: string[]) => void) {
  if (it.kind === "evidence") {
    const ev = it.ev;
    const lit = highlight.includes(ev.id);
    const isBuyer = ["BUYER_MESSAGE", "BUYER_EMAIL", "VOICE_NOTE_TRANSCRIPT", "SCREENSHOT_TEXT"].includes(ev.type);
    return (
      <div id={`ev-${ev.id}`} className={clsx("rounded-lg border px-3 py-2 transition", lit ? "flash border-amber-400 bg-amber-50/60 ring-2 ring-amber-300" : "border-line bg-white")}>
        <Meta at={ev.timestamp} label={EVIDENCE_ICON[ev.type].label} extra={<><span>· {ev.source}</span>{ev.isSynthetic && <SimLabel>Synthetic</SimLabel>}</>} />
        <div className={clsx("mt-1 text-sm", isBuyer ? "font-medium text-ink" : "text-ink-2")}>{isBuyer ? `“${ev.rawContent}”` : ev.rawContent}</div>
        {ev.attachmentName && <div className="mt-1 text-[11px] text-ink-3">Attachment: {ev.attachmentName}</div>}
        {ev.structuredExtraction?.kind === "UNDERSTANDING" && (
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
            {ev.structuredExtraction.data.extractedAmounts.map((a, i) => (
              <span key={i} className="rounded bg-line-2 px-1.5 py-0.5 text-ink-2">
                {a.role.toLowerCase()}: <span className="num font-medium">{formatINR(a.amount)}</span>
              </span>
            ))}
            {ev.structuredExtraction.data.temporalExpressions.map((t, i) => (
              <span key={i} className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-800">
                “{t.rawText}” → {t.type.replace("_", " ").toLowerCase()} {t.normalizedDate ?? (t.lowerBound ? `≥ ${t.lowerBound}` : "")}
                {t.confidenceBand === "NEEDS_REVIEW" ? " (needs review)" : ""}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }
  if (it.kind === "transition") {
    const t = it.t;
    return (
      <div className="rounded-lg border border-brand-100 bg-brand-50/50 px-3 py-2">
        <Meta at={t.timestamp} label="State change" extra={<span>· by {INITIATOR[t.initiatedBy]}{t.modelVersion ? ` (${t.modelVersion})` : ""}</span>} />
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {t.fromState ? <StateBadge state={t.fromState} /> : <span className="text-xs text-ink-3">Case opened</span>}
          <ArrowRight className="h-3.5 w-3.5 text-ink-3" aria-hidden />
          <StateBadge state={t.toState} />
          <code className="ml-1 text-[10px] text-ink-3">{t.reasonCode}</code>
        </div>
        <div className="mt-1 text-sm text-ink-2">{t.humanReadableReason}</div>
        <button className="mt-1 text-xs font-medium text-brand-600 hover:underline" onClick={() => onWhy(t.evidenceIds)}>
          Why? Show evidence ({t.evidenceIds.length})
        </button>
      </div>
    );
  }
  if (it.kind === "action") {
    const a = it.a;
    return (
      <div className="px-1 py-1">
        <Meta
          at={it.at}
          label={it.phase === "decided" ? "Executed" : "Action"}
          extra={it.phase === "proposed" ? <PolicyBadge decision={a.policyEvaluation.decision} /> : null}
        />
        <div className="text-sm text-ink-2">
          <span className="font-medium text-ink">{ACTION_LABEL[a.type]}</span> — {it.phase === "decided" ? a.result ?? a.summary : a.summary}
          {it.phase === "proposed" && <span className="ml-1 text-xs text-ink-3">[{a.status.replace("_", " ").toLowerCase()}{a.approvedBy ? ` · approved by ${a.approvedBy}` : ""}]</span>}
        </div>
      </div>
    );
  }
  const tm = it.tm;
  return (
    <div className="px-1 py-1">
      <Meta at={it.at} label={it.phase === "fired" ? "Timer fired" : "Timer set"} extra={<Timer className="h-3 w-3" aria-hidden />} />
      <div className="text-sm text-ink-2">
        {tm.kind === "PROMISE_DEADLINE" ? "Promise deadline check" : "Installment due check"} {it.phase === "scheduled" ? `for ${formatIst(tm.fireAt)}` : `— ${tm.outcome ?? ""}`}
        {it.phase === "scheduled" && tm.status === "CANCELLED" && <span className="ml-1 text-xs text-ink-3">(cancelled: {tm.outcome})</span>}
      </div>
    </div>
  );
}
