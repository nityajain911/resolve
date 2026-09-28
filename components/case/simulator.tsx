"use client";

import { useState } from "react";
import type { InvoiceCase } from "@/domain/types";
import { useResolve } from "@/lib/store";
import { Button, Card, Eyebrow, SimLabel } from "../ui";

const SAMPLES = ["Monday tak kar denge", "parso kar dunga", "15 ke baad clear karenge", "next Friday", "kal afternoon", "Accounts ne park kiya, PO mismatch", "GSTIN galat hai", "Payment kar diya hai, UTR bhej raha hoon"];

export function Simulator({ c }: { c: InvoiceCase }) {
  const { addBuyerReply, simulatePayment, busy } = useResolve();
  const [text, setText] = useState("");
  const [amt, setAmt] = useState("");
  if (c.currentState === "RESOLVED") return null;
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <Eyebrow>Demo tools</Eyebrow>
        <SimLabel>Simulated inputs</SimLabel>
      </div>
      <label className="mt-2 block text-xs text-ink-3">New buyer reply (timestamped at the demo clock)</label>
      <textarea className="mt-1 w-full rounded-md border border-line px-2 py-1.5 text-sm" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Monday tak kar denge" />
      <div className="mt-1 flex flex-wrap gap-1">
        {SAMPLES.map((s) => (
          <button key={s} className="rounded bg-line-2 px-1.5 py-0.5 text-[11px] text-ink-2 hover:bg-line" onClick={() => setText(s)}>
            {s}
          </button>
        ))}
      </div>
      <Button size="sm" className="mt-2" disabled={!text.trim() || busy} onClick={async () => { await addBuyerReply(c.id, text.trim()); setText(""); }}>
        Add reply & classify
      </Button>
      <div className="mt-4 flex items-end gap-2">
        <label className="block flex-1">
          <span className="text-xs text-ink-3">Simulated payment event (₹)</span>
          <input className="num mt-1 w-full rounded-md border border-line px-2 py-1.5 text-sm" inputMode="numeric" value={amt} placeholder={String(c.outstandingAmount)} onChange={(e) => setAmt(e.target.value.replace(/[^\d]/g, ""))} />
        </label>
        <Button size="sm" variant="secondary" onClick={() => { simulatePayment(c.id, Number(amt || c.outstandingAmount)); setAmt(""); }}>
          Simulate payment received
        </Button>
      </div>
    </Card>
  );
}
