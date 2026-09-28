"use client";

import { useState } from "react";
import { formatINR } from "@/domain/money";
import { reviewOptions, type ReviewOption } from "@/domain/review-options";
import { STATE_META } from "@/domain/state-machine";
import { formatIst } from "@/domain/time";
import type { InvoiceCase, WorldState } from "@/domain/types";
import { useResolve } from "@/lib/store";
import { Button, Card, SimLabel } from "../ui";

/** NEEDS_REVIEW panel. Options are derived from THIS case's candidates and evidence — never a fixed set. */
export function ReviewPanel({ world, c }: { world: WorldState; c: InvoiceCase }) {
  const store = useResolve();
  const { primary, other } = reviewOptions(world, c);
  const [note, setNote] = useState("");
  const [showOther, setShowOther] = useState(false);
  const [dates, setDates] = useState<Record<string, string>>({});
  // Stable per displayed version: a double click re-sends the same key and is a no-op.
  const version = `${c.id}:${c.transitions.length}:${c.evidence.length}`;
  const reason = c.transitions.at(-1)?.reasonCode;
  const issues = c.understanding?.validationIssues ?? [];
  const credit = [...c.evidence].reverse().find((e) => e.type === "BANK_CREDIT");
  const creditData = credit?.structuredExtraction?.kind === "BANK_CREDIT" ? credit.structuredExtraction.data : undefined;

  const run = (o: ReviewOption) => {
    const key = `${version}:${o.id}`;
    if (o.kind === "CONFIRM_MATCH") return store.approve(o.actionId);
    if (o.kind === "REJECT_MATCH") return store.reject(o.actionId);
    if (o.kind === "RECORD_PAYMENT") return store.recordMerchantPayment(c.id, o.amount, key);
    const date = o.requiresDate ? dates[o.id] ?? o.defaultDate : undefined;
    if (o.requiresDate && !date) return store.notify("Choose a date first", "warn");
    store.classify(c.id, o.state, { note: note || undefined, promiseDate: date, idempotencyKey: key });
  };

  const render = (o: ReviewOption, i: number, secondary = false) => (
    <div key={o.id} className="rounded-lg border border-line p-2.5">
      <div className="flex items-center justify-between gap-2">
        <Button size="sm" variant={!secondary && i === 0 ? "primary" : "secondary"} onClick={() => run(o)}>
          {o.label}
        </Button>
        {o.kind === "CLASSIFY" && o.requiresDate && (
          <input
            type="date"
            aria-label="Promise date"
            className="num rounded-md border border-line px-2 py-1 text-xs"
            value={dates[o.id] ?? o.defaultDate ?? ""}
            onChange={(e) => setDates({ ...dates, [o.id]: e.target.value })}
          />
        )}
      </div>
      <div className="mt-1 text-[11px] text-ink-3">
        {o.description}
        {o.kind === "CLASSIFY" && o.requiresDate && o.defaultDate && " Date pre-filled from the buyer's words — confirm it."}
      </div>
    </div>
  );

  return (
    <Card className="border-dashed border-amber-400 p-4">
      <div className="font-semibold">Needs review</div>
      <div className="mt-1 text-sm text-ink-2">No buyer message will be sent until this is classified.</div>
      {issues.length > 0 && (
        <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-900">
          <div className="font-semibold">Consistency check failed · {issues[0].code}</div>
          {issues.map((i) => <div key={i.code + i.message}>{i.message}</div>)}
        </div>
      )}
      {reason === "POSSIBLE_BANK_MATCH" && creditData && (
        <div className="mt-2 rounded-lg border border-line bg-canvas px-3 py-2 text-xs">
          <div className="font-semibold text-ink">Possible match only <SimLabel>Synthetic bank credit</SimLabel></div>
          <div className="mt-0.5 text-ink-2">{formatINR(creditData.amount)} from {creditData.payerName} · “{creditData.reference}” · {formatIst(creditData.valueDate, { time: false })}</div>
          <div className="text-ink-3">Amount and payer match, but there is no invoice reference — it may pay a different invoice.</div>
        </div>
      )}
      {c.reviewCandidates?.length ? (
        <div className="mt-2 text-xs text-ink-3">Could be: {c.reviewCandidates.map((s) => STATE_META[s].label).join(" · ")}</div>
      ) : null}
      <div className="mt-3 space-y-2">{primary.map((o, i) => render(o, i))}</div>
      {other.length > 0 && (
        <div className="mt-2">
          <button className="text-xs font-medium text-ink-3 hover:text-ink" onClick={() => setShowOther(!showOther)}>
            {showOther ? "Hide" : "Other classification…"}
          </button>
          {showOther && <div className="mt-2 space-y-2">{other.map((o, i) => render(o, i, true))}</div>}
        </div>
      )}
      <textarea className="mt-3 w-full rounded-md border border-line px-2 py-1.5 text-sm" rows={2} placeholder="Note for the audit trail (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-1 text-[11px] text-ink-3">Your choice is recorded as a merchant decision and added to the labelled review set. Nothing retrains automatically.</div>
    </Card>
  );
}
