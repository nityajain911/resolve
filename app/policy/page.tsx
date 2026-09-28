"use client";

import clsx from "clsx";
import { ArrowRight, Lock } from "lucide-react";
import { useState } from "react";
import { Button, Card, Eyebrow, StateBadge } from "@/components/ui";
import { formatINR } from "@/domain/money";
import { policyVersion } from "@/domain/policy";
import { formatIst } from "@/domain/time";
import type { MerchantPolicy } from "@/domain/types";
import { useResolve } from "@/lib/store";

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={clsx("relative h-6 w-11 rounded-full transition", on ? "bg-brand" : "bg-line")}
    >
      <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition", on ? "left-[22px]" : "left-0.5")} />
      <span className="sr-only">{on ? "On" : "Off"}</span>
    </button>
  );
}

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line-2 py-3.5 last:border-0">
      <div>
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="text-xs text-ink-3">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function NumberField({ value, onCommit, prefix, suffix }: { value: number; onCommit: (n: number) => void; prefix?: string; suffix?: string }) {
  const [v, setV] = useState(String(value));
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm">
      {prefix}
      <input
        className="num w-24 text-right outline-none"
        value={v}
        inputMode="numeric"
        onChange={(e) => setV(e.target.value.replace(/[^\d]/g, ""))}
        onBlur={() => v !== String(value) && v !== "" && onCommit(Number(v))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {suffix}
    </span>
  );
}

export default function PolicyPage() {
  const { world, updatePolicy } = useResolve();
  const p = world.policy;
  const set = (patch: Partial<Omit<MerchantPolicy, "version">>) => updatePolicy(patch);
  const buyers = Object.values(world.buyers).sort((a, b) => a.name.localeCompare(b.name));
  const [pick, setPick] = useState("");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Policy & controls</h1>
        <p className="mt-1 text-ink-2">Deterministic rules the merchant owns. The AI only proposes an understanding of the case — it cannot bypass any of these.</p>
      </div>

      <Card className="p-5">
        <Eyebrow>How a decision is made</Eyebrow>
        <div className="mt-3 grid grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] items-stretch gap-2">
          {[
            ["AI", "Understands the case", "Reads Hinglish / English replies, screenshots, voice-note text. Extracts amounts, dates and the likely blocker. Outputs HIGH or NEEDS REVIEW."],
            ["Policy engine", "Decides what is allowed", "Payment recheck, state gates, never-contact list, review-first, amount and date limits, contact caps. Returns ALLOW / REVIEW REQUIRED / BLOCK."],
            ["Workflow engine", "Executes / routes", "Explicit state transitions, timers, routing to Accounts or Sales, approvals, part-payment links."],
            ["Outcomes", "Update buyer + invoice", "Audit trail with evidence for every transition; plain-count promise history; labelled review set."],
          ].flatMap(([k, t, d], i, arr) => {
            const box = (
              <div key={k} className={clsx("rounded-lg border p-3", i === 1 ? "border-brand bg-brand-50" : "border-line bg-canvas")}>
                <div className="text-xs font-semibold uppercase tracking-wide text-ink-3">{k}</div>
                <div className="mt-0.5 font-semibold">{t}</div>
                <div className="mt-1 text-xs leading-relaxed text-ink-2">{d}</div>
              </div>
            );
            return i < arr.length - 1 ? [box, <ArrowRight key={`${k}-a`} className="h-4 w-4 self-center text-ink-3" aria-hidden />] : [box];
          })}
        </div>
      </Card>

      <div className="grid grid-cols-[1fr_380px] gap-6">
        <Card className="px-5 py-2">
          <div className="flex items-center justify-between pt-3">
            <Eyebrow>Merchant policy</Eyebrow>
            <span className="num text-xs text-ink-3">{policyVersion(p)}</span>
          </div>
          <Row title="Review-first" hint="Every buyer-facing plan needs merchant approval before it is sent.">
            <Toggle label="Review-first" on={p.reviewFirst} onChange={(v) => set({ reviewFirst: v })} />
          </Row>
          <Row title="Part payments allowed">
            <Toggle label="Part payments" on={p.allowPartPayments} onChange={(v) => set({ allowPartPayments: v })} />
          </Row>
          <Row title="Minimum part payment" hint={`Currently ${formatINR(p.minPartPaymentAmount)}`}>
            <NumberField key={p.minPartPaymentAmount} value={p.minPartPaymentAmount} prefix="₹" onCommit={(n) => set({ minPartPaymentAmount: n })} />
          </Row>
          <Row title="Maximum extension" hint="Latest date in a plan or wait, counted from today">
            <NumberField key={p.maxExtensionDays} value={p.maxExtensionDays} suffix="days" onCommit={(n) => set({ maxExtensionDays: n })} />
          </Row>
          <Row title="Corrected invoice" hint="Resolve drafts; it never issues tax documents">
            <span className="inline-flex items-center gap-1 text-sm font-medium"><Lock className="h-3.5 w-3.5" aria-hidden /> Approval required</span>
          </Row>
          <Row title="Credit note / invoice split" hint="Always requires approval">
            <span className="inline-flex items-center gap-1 text-sm font-medium"><Lock className="h-3.5 w-3.5" aria-hidden /> Approval required</span>
          </Row>
          <Row title="Promise grace period" hint="After the promised day ends, before follow-up resumes">
            <div className="flex gap-1">
              {[12, 24].map((h) => (
                <Button key={h} size="sm" variant={p.promiseGracePeriodHours === h ? "primary" : "secondary"} onClick={() => set({ promiseGracePeriodHours: h })}>
                  {h} hours
                </Button>
              ))}
            </div>
          </Row>
          <Row title="Reminder frequency cap" hint="Max standard reminders per 7 days">
            <NumberField key={p.reminderFrequencyCap} value={p.reminderFrequencyCap} suffix="/ week" onCommit={(n) => set({ reminderFrequencyCap: n })} />
          </Row>
          <Row title="Pause Resolve" hint="Blocks all buyer-facing actions; everything else needs manual action">
            <Toggle label="Pause Resolve" on={p.pauseAllAutomation} onChange={(v) => set({ pauseAllAutomation: v })} />
          </Row>
          <div className="py-3.5">
            <div className="text-sm font-medium">Never contact these buyers</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {p.excludedBuyerIds.length === 0 && <span className="text-xs text-ink-3">No buyers excluded.</span>}
              {p.excludedBuyerIds.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-800 ring-1 ring-rose-200">
                  {world.buyers[id]?.name}
                  <button aria-label="Remove" onClick={() => set({ excludedBuyerIds: p.excludedBuyerIds.filter((x) => x !== id) })}>×</button>
                </span>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <select className="rounded-md border border-line px-2 py-1 text-sm" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">Select buyer…</option>
                {buyers.filter((b) => !p.excludedBuyerIds.includes(b.buyerId)).map((b) => (
                  <option key={b.buyerId} value={b.buyerId}>{b.name}</option>
                ))}
              </select>
              <Button size="sm" variant="secondary" disabled={!pick} onClick={() => { set({ excludedBuyerIds: [...p.excludedBuyerIds, pick] }); setPick(""); }}>
                Add
              </Button>
            </div>
          </div>
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <Eyebrow>Hard rules (not configurable)</Eyebrow>
            <ul className="mt-2 space-y-1.5 text-sm text-ink-2">
              <li>Paid-but-unmatched → no buyer communication</li>
              <li>Paperwork blocked → no reminders</li>
              <li>Needs review → no buyer message</li>
              <li>Resolved → no collection action</li>
              <li>Payment detected right before send → block and re-evaluate</li>
              <li>AI cannot mark invoices paid or resolved</li>
              <li>No pressure or false-urgency language</li>
            </ul>
          </Card>
          <Card className="p-4">
            <Eyebrow>Labelled review set</Eyebrow>
            <p className="mt-1 text-xs text-ink-3">Merchant classifications are collected here for future evaluation. Nothing is retrained automatically; any prompt or model change must be evaluated first.</p>
            {world.labelledReviewSet.length === 0 ? (
              <div className="mt-3 text-sm text-ink-3">No merchant labels yet.</div>
            ) : (
              <ul className="mt-3 space-y-2">
                {world.labelledReviewSet.map((l, i) => (
                  <li key={i} className="rounded-lg border border-line p-2 text-xs">
                    <div className="font-medium">{world.cases[l.invoiceId]?.invoiceNumber}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      AI: {l.aiProposedState ? <StateBadge state={l.aiProposedState} /> : "—"} → Merchant: <StateBadge state={l.merchantState} />
                    </div>
                    <div className="mt-1 text-ink-3">{formatIst(l.labelledAt)}</div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
