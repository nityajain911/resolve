"use client";

import clsx from "clsx";
import { ArrowRight, Star } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EVIDENCE_ICON, Eyebrow, SimLabel, STATE_STYLE, StateBadge } from "@/components/ui";
import { lastEvidence, nextActionLabel } from "@/domain/engine";
import { formatCompactINR, formatINR } from "@/domain/money";
import { STATE_META } from "@/domain/state-machine";
import { daysOverdue, formatIst } from "@/domain/time";
import type { InvoiceState } from "@/domain/types";
import { useResolve } from "@/lib/store";

const GROUPS: InvoiceState[] = ["PAID_UNMATCHED", "PAPERWORK_BLOCKED", "CASH_CONSTRAINED", "PROMISE_TO_PAY", "NEEDS_REVIEW", "FOLLOW_UP_ACTIVE"];
const ORDER: InvoiceState[] = ["NEEDS_REVIEW", "PAID_UNMATCHED", "PAPERWORK_BLOCKED", "CASH_CONSTRAINED", "PROMISE_TO_PAY", "COMMERCIAL_DISPUTE", "FOLLOW_UP_ACTIVE", "RESOLVED"];

export default function CommandCentre() {
  const { world } = useResolve();
  const [filter, setFilter] = useState<InvoiceState | "ALL">("ALL");
  const cases = world.caseOrder.map((id) => world.cases[id]);

  const handoffAt = cases[0]?.receivablesHandoff.handedOffAt;
  const handedOff = cases.filter((c) => !c.parentInvoiceId);
  const handoffTotal = handedOff.reduce((s, c) => s + c.amount, 0);
  const openCases = cases.filter((c) => c.currentState !== "RESOLVED");
  const openTotal = openCases.reduce((s, c) => s + c.outstandingAmount, 0);

  const groups = new Map<InvoiceState, { n: number; amt: number }>();
  for (const c of cases) {
    const g = groups.get(c.currentState) ?? { n: 0, amt: 0 };
    g.n += 1;
    g.amt += c.outstandingAmount;
    groups.set(c.currentState, g);
  }

  const rows = cases
    .filter((c) => filter === "ALL" || c.currentState === filter)
    .sort((a, b) => Number(Boolean(b.isDemoHero)) - Number(Boolean(a.isDemoHero)) || ORDER.indexOf(a.currentState) - ORDER.indexOf(b.currentState) || b.outstandingAmount - a.outstandingAmount);

  return (
    <div className="space-y-6">
      <section className="flex items-end justify-between gap-6">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Resolve</h1>
          <p className="mt-1 text-lg leading-snug text-ink-2">
            Receivables Agent chases payment.
            <br />
            <span className="font-semibold text-ink">Resolve fixes what&apos;s preventing it.</span>
          </p>
        </div>
        <div className="text-right text-sm text-ink-3">
          <div>{world.merchantName}</div>
          <div className="text-xs">Demo persona: ₹20–100 Cr packaging manufacturer · 30–60 day B2B credit (assumption)</div>
        </div>
      </section>

      <section className="card overflow-hidden">
        <div className="flex items-center gap-2 border-b border-line-2 bg-brand-50/60 px-5 py-2.5">
          <SimLabel className="border-brand/30 bg-white text-brand-600">Simulated Receivables Agent handoff</SimLabel>
          {handoffAt && <span className="text-xs text-ink-3">Handed off {formatIst(handoffAt)} · no live integration</span>}
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-6 px-5 py-4">
          <div>
            <div className="text-xl font-semibold">
              <span className="num">{formatINR(handoffTotal)}</span> overdue across {handedOff.length} invoices remains after standard reminders and calls.
            </div>
            <div className="mt-1 text-sm text-ink-2">
              These invoices are still unpaid after standard follow-up. Resolve works out <em>why</em> each one is stuck, checks policy, and removes the blocker — or hands it back for normal follow-up.
              <span className="ml-1 num text-ink-3">Open now: {formatINR(openTotal)} on {openCases.length} invoices.</span>
            </div>
          </div>
          <FlowStrip />
        </div>
      </section>

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <Eyebrow>Invoices by current state · one state per invoice</Eyebrow>
          {filter !== "ALL" && (
            <button className="text-xs font-medium text-brand-600" onClick={() => setFilter("ALL")}>
              Clear filter
            </button>
          )}
        </div>
        <div className="grid grid-cols-6 gap-3">
          {GROUPS.map((s) => {
            const g = groups.get(s) ?? { n: 0, amt: 0 };
            const st = STATE_STYLE[s];
            const Icon = st.icon;
            return (
              <button
                key={s}
                onClick={() => setFilter(filter === s ? "ALL" : s)}
                className={clsx(
                  "card relative overflow-hidden p-4 text-left transition hover:shadow-md",
                  filter === s && "ring-2 ring-brand",
                  s === "NEEDS_REVIEW" && "border-dashed border-amber-400",
                )}
              >
                <span className={clsx("absolute inset-x-0 top-0 h-1", st.bar)} />
                <div className="flex items-center gap-1.5 text-sm font-medium text-ink-2">
                  <Icon className="h-4 w-4" aria-hidden /> {STATE_META[s].label}
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="num text-2xl font-semibold">{g.n}</span>
                  <span className="text-xs text-ink-3">invoices</span>
                </div>
                <div className="num text-sm text-ink-2">{formatCompactINR(g.amt)}</div>
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex gap-4 text-xs text-ink-3">
          {(["COMMERCIAL_DISPUTE", "RESOLVED"] as InvoiceState[]).map((s) => (
            <button key={s} onClick={() => setFilter(filter === s ? "ALL" : s)} className="hover:text-ink">
              {STATE_META[s].label}: <span className="num font-medium text-ink-2">{groups.get(s)?.n ?? 0}</span> · {formatCompactINR(groups.get(s)?.amt ?? 0)}
            </button>
          ))}
          <span className="ml-auto">No forecasts or recovery probabilities are shown — only current state.</span>
        </div>
      </section>

      <section className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-line bg-canvas text-left text-xs text-ink-3">
            <tr>
              <th className="px-4 py-2.5 font-medium">Buyer</th>
              <th className="px-3 py-2.5 font-medium">Invoice</th>
              <th className="px-3 py-2.5 text-right font-medium">Outstanding</th>
              <th className="px-3 py-2.5 text-right font-medium">Days overdue</th>
              <th className="px-3 py-2.5 font-medium">Resolve state</th>
              <th className="px-3 py-2.5 font-medium">Last evidence</th>
              <th className="px-3 py-2.5 font-medium">Next action</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const ev = lastEvidence(c);
              const EvIcon = ev ? EVIDENCE_ICON[ev.type].icon : null;
              return (
                <tr key={c.id} className={clsx("group border-b border-line-2 last:border-0 hover:bg-brand-50/40", c.isDemoHero && "bg-amber-50/30")}>
                  <td className="px-4 py-2.5">
                    <Link href={`/cases/${c.id}`} className="font-medium hover:text-brand-600">
                      {c.buyerContext.name}
                    </Link>
                    {c.isDemoHero && (
                      <span className="ml-2 inline-flex items-center gap-0.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900">
                        <Star className="h-2.5 w-2.5" aria-hidden /> {c.demoLabel}
                      </span>
                    )}
                    {c.parentInvoiceId && <span className="ml-2 text-[11px] text-ink-3">child of {world.cases[c.parentInvoiceId]?.invoiceNumber}</span>}
                  </td>
                  <td className="num whitespace-nowrap px-3 py-2.5 text-ink-2">{c.invoiceNumber}</td>
                  <td className="num px-3 py-2.5 text-right font-medium">{formatINR(c.outstandingAmount)}</td>
                  <td className="num px-3 py-2.5 text-right text-ink-2">{daysOverdue(c.dueAt, world.clock)}</td>
                  <td className="px-3 py-2.5">
                    <StateBadge state={c.currentState} />
                  </td>
                  <td className="max-w-[260px] px-3 py-2.5">
                    {ev && EvIcon ? (
                      <span className="flex items-center gap-1.5 text-ink-2" title={ev.rawContent}>
                        <EvIcon className="h-3.5 w-3.5 shrink-0 text-ink-3" aria-hidden />
                        <span className="truncate">{ev.rawContent}</span>
                      </span>
                    ) : (
                      <span className="text-ink-3">No reply after reminders</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-ink-2">{nextActionLabel(world, c)}</td>
                  <td className="pr-4">
                    <Link href={`/cases/${c.id}`} aria-label={`Open ${c.invoiceNumber}`}>
                      <ArrowRight className="h-4 w-4 text-ink-3 opacity-0 group-hover:opacity-100" aria-hidden />
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </div>
  );
}

function FlowStrip() {
  const steps = ["Receivables Agent", "Reminders + calls", "Still unpaid", "Resolve", "Understand blocker", "Policy check", "Resolve blocker"];
  return (
    <div className="flex items-center gap-1 text-[11px] font-medium">
      {steps.map((s, i) => (
        <span key={s} className="flex items-center gap-1">
          <span className={clsx("rounded-md px-2 py-1", i < 3 ? "bg-line-2 text-ink-3" : i === 3 ? "bg-brand text-white" : "bg-brand-50 text-brand-600")}>{s}</span>
          {i < steps.length - 1 && <ArrowRight className="h-3 w-3 text-ink-3" aria-hidden />}
        </span>
      ))}
    </div>
  );
}
