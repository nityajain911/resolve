"use client";

import { formatINR } from "@/domain/money";
import { daysOverdue, formatIst } from "@/domain/time";
import type { InvoiceCase, WorldState } from "@/domain/types";
import { Card, Eyebrow, SimLabel } from "../ui";

export function ContextPanel({ world, c }: { world: WorldState; c: InvoiceCase }) {
  const inv = c.evidence.find((e) => e.structuredExtraction?.kind === "INVOICE_DATA");
  const data = inv?.structuredExtraction?.kind === "INVOICE_DATA" ? inv.structuredExtraction.data : undefined;
  const h = c.receivablesHandoff;
  const ph = c.buyerContext.promiseHistory;
  const rows: [string, React.ReactNode][] = [
    ["Invoice", <span key="n" className="num font-medium">{c.invoiceNumber}</span>],
    ["Amount", <span key="a" className="num">{formatINR(c.amount)}</span>],
    ["Outstanding", <span key="o" className="num font-semibold">{formatINR(c.outstandingAmount)}</span>],
    ["Issued", formatIst(c.issuedAt, { time: false })],
    ["Due", formatIst(c.dueAt, { time: false })],
    ["Days overdue", <span key="d" className="num">{daysOverdue(c.dueAt, world.clock)}</span>],
    ["Billed GSTIN", <span key="g" className="num text-xs">{data?.billedGstin ?? "—"}</span>],
    ["PO", data?.poNumber ?? <span key="p" className="text-amber-700">not quoted</span>],
  ];
  return (
    <div className="space-y-4">
      <Card className="p-4">
        <Eyebrow>Invoice</Eyebrow>
        <dl className="mt-2 space-y-1.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-2">
              <dt className="text-ink-3">{k}</dt>
              <dd className="text-right">{v}</dd>
            </div>
          ))}
        </dl>
        {c.parentInvoiceId && <div className="mt-2 text-xs text-ink-3">Child receivable of {world.cases[c.parentInvoiceId]?.invoiceNumber}</div>}
        {c.childInvoiceIds?.length ? <div className="mt-2 text-xs text-ink-3">Split into: {c.childInvoiceIds.map((id) => world.cases[id]?.invoiceNumber).join(", ")}</div> : null}
      </Card>

      <Card className="p-4">
        <Eyebrow>Buyer</Eyebrow>
        <div className="mt-2 font-medium">{c.buyerContext.name}</div>
        <div className="text-xs text-ink-3">
          {c.buyerContext.city} · GSTIN <span className="num">{c.buyerContext.gstin}</span>
        </div>
        <div className="mt-3 rounded-lg bg-canvas px-3 py-2 text-sm">
          <div className="text-xs text-ink-3">Promise history (plain counts)</div>
          <div className="mt-0.5">
            {ph.made === 0 ? (
              "No previous promises"
            ) : (
              <>
                Kept <span className="num font-semibold">{ph.kept}</span> of <span className="num font-semibold">{ph.made}</span> previous promises
                {ph.broken > 0 && <span className="text-ink-3"> · {ph.broken} broken</span>}
              </>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-4">
        <div className="flex items-center justify-between">
          <Eyebrow>Receivables Agent history</Eyebrow>
          <SimLabel>Simulated</SimLabel>
        </div>
        <div className="mt-1 text-xs text-ink-2">
          {h.remindersSent} reminders · {h.callsMade} calls before handoff
        </div>
        <ul className="mt-2 space-y-1 text-xs">
          {h.reminderHistory.map((r, i) => (
            <li key={i} className="flex justify-between gap-2 text-ink-2">
              <span>
                <span className="font-medium">{r.channel}</span> · {r.outcome}
              </span>
              <span className="num shrink-0 text-ink-3">{formatIst(r.at, { time: false, weekday: false })}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
