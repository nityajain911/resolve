"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { use, useState } from "react";
import { ContextPanel } from "@/components/case/context-panel";
import { DecisionPanel } from "@/components/case/decision-panel";
import { Simulator } from "@/components/case/simulator";
import { Timeline } from "@/components/case/timeline";
import { Card, Eyebrow, StateBadge } from "@/components/ui";
import { formatINR } from "@/domain/money";
import { useResolve } from "@/lib/store";

export default function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { world } = useResolve();
  const [highlight, setHighlight] = useState<string[]>([]);
  const c = world.cases[id];

  if (!c) {
    return (
      <div className="card p-8 text-center">
        <div className="font-medium">Invoice case not found.</div>
        <Link className="mt-2 inline-block text-sm text-brand-600" href="/">Back to command centre</Link>
      </div>
    );
  }

  const onWhy = (ids: string[]) => {
    setHighlight([...ids]);
    const first = ids.map((x) => document.getElementById(`ev-${x}`)).find(Boolean);
    first?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/" className="rounded-lg p-1.5 text-ink-3 hover:bg-line-2" aria-label="Back">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <h1 className="text-xl font-semibold tracking-tight">{c.buyerContext.name}</h1>
        <span className="num text-ink-3">{c.invoiceNumber}</span>
        <span className="num font-medium">{formatINR(c.outstandingAmount)}</span>
        <StateBadge state={c.currentState} />
        {c.demoLabel && <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Demo: {c.demoLabel}</span>}
      </div>
      <div className="grid grid-cols-[280px_minmax(0,1fr)_400px] items-start gap-5">
        <ContextPanel world={world} c={c} />
        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <Eyebrow>Case timeline · audit trail</Eyebrow>
            <span className="text-[11px] text-ink-3">{c.transitions.length} state changes · {c.evidence.length} evidence items</span>
          </div>
          <Timeline world={world} c={c} highlight={highlight} onWhy={onWhy} />
        </Card>
        <div className="sticky top-32 space-y-4">
          <DecisionPanel world={world} c={c} onWhy={onWhy} />
          <Simulator c={c} />
        </div>
      </div>
    </div>
  );
}
