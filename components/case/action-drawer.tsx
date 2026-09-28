"use client";

import { Check, Pencil, X } from "lucide-react";
import { useState } from "react";
import { formatINR } from "@/domain/money";
import { formatDate } from "@/domain/time";
import type { InvoiceCase, ResolutionAction } from "@/domain/types";
import { useResolve } from "@/lib/store";
import { Button, ConfidenceBadge, Eyebrow, PolicyBadge, SimLabel, StateBadge } from "../ui";

/** Screen 3 — review drawer for sensitive (financial / buyer-facing) actions. */
export function ActionDrawer({ action, c, onClose }: { action: ResolutionAction; c: InvoiceCase; onClose: () => void }) {
  const { approve, reject, editPlan, busy, status } = useResolve();
  const plan = c.paymentPlan;
  const [editing, setEditing] = useState(false);
  const [amt, setAmt] = useState(String(plan?.installments[0]?.amount ?? ""));
  const [date, setDate] = useState(plan?.installments[1]?.dueDate ?? "");
  const src = c.evidence.find((e) => e.id === plan?.sourceEvidenceId);
  const u = c.understanding;
  const pe = action.policyEvaluation;
  const open = action.status === "REVIEW_REQUIRED" || action.status === "PROPOSED" || action.status === "BLOCKED";

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/20" onClick={onClose}>
      <aside className="flex h-full w-[520px] flex-col overflow-y-auto bg-white shadow-2xl" onClick={(e) => e.stopPropagation()} aria-label="Action review">
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <div>
            <Eyebrow>Action review · {c.invoiceNumber}</Eyebrow>
            <div className="mt-0.5 text-lg font-semibold">Part-payment plan</div>
          </div>
          <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-line-2" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-5 px-6 py-5">
          <section>
            <Eyebrow>Buyer requested</Eyebrow>
            <blockquote className="mt-1.5 rounded-lg border-l-4 border-orange-400 bg-orange-50/50 px-3 py-2 text-[15px] font-medium">“{src?.rawContent}”</blockquote>
            <div className="mt-1 text-xs text-ink-3">{src?.source} · <SimLabel>Simulated buyer message</SimLabel></div>
          </section>

          <section>
            <Eyebrow>Resolve interpreted</Eyebrow>
            <div className="mt-1.5 flex items-center gap-2">
              <StateBadge state="CASH_CONSTRAINED" />
              {u && <ConfidenceBadge band={u.confidenceBand} />}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
              {plan?.installments.map((i, n) => (
                <div key={i.id} className="rounded-lg border border-line p-2.5">
                  <div className="text-xs text-ink-3">{n === 0 ? "Pay now" : "Remainder"}</div>
                  <div className="num text-lg font-semibold">{formatINR(i.amount)}</div>
                  <div className="text-xs text-ink-2">{i.dueDate ? `by ${formatDate(i.dueDate)}` : "date needed"}</div>
                  {i.dateSource === "PROPOSED_FROM_LOWER_BOUND" && <div className="mt-0.5 text-[11px] font-medium text-amber-800">Proposed from an “after” condition — confirm</div>}
                  {i.dateSource === "MERCHANT_SET" && <div className="mt-0.5 text-[11px] text-ink-3">Set by merchant</div>}
                </div>
              ))}
            </div>
            {u?.temporalExpressions.filter((t) => t.type === "AFTER_DATE").map((t, i) => (
              <div key={i} className="mt-1.5 text-xs text-ink-2">
                “{t.rawText}” is an <b>after-date</b> condition (≥ {t.lowerBound && formatDate(t.lowerBound)}), not an exact date. Resolve proposes the next day; edit if you agreed otherwise.
              </div>
            ))}
          </section>

          {editing && (
            <section className="rounded-lg border border-brand-100 bg-brand-50/40 p-3">
              <Eyebrow>Edit plan</Eyebrow>
              <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
                <label className="block">
                  <span className="text-xs text-ink-3">Pay now (₹)</span>
                  <input className="num mt-1 w-full rounded-md border border-line px-2 py-1.5" inputMode="numeric" value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^\d]/g, ""))} />
                </label>
                <label className="block">
                  <span className="text-xs text-ink-3">Remainder by</span>
                  <input type="date" className="num mt-1 w-full rounded-md border border-line px-2 py-1.5" value={date} onChange={(e) => setDate(e.target.value)} />
                </label>
              </div>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => { editPlan(action.id, Number(amt), date); setEditing(false); onClose(); }} disabled={!amt || !date}>
                  Save & re-check policy
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </div>
            </section>
          )}

          <section>
            <div className="flex items-center justify-between">
              <Eyebrow>Policy engine (deterministic)</Eyebrow>
              <span className="text-[11px] text-ink-3">{pe.policyVersion}</span>
            </div>
            <ul className="mt-2 space-y-1.5 text-sm">
              {pe.checks.map((ch) => (
                <li key={ch.code} className="flex items-start gap-2">
                  {ch.passed ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-label="passed" />
                  ) : (
                    <X className={`mt-0.5 h-4 w-4 shrink-0 ${ch.severity === "BLOCK" ? "text-rose-600" : "text-amber-600"}`} aria-label="not passed" />
                  )}
                  <span className={ch.passed ? "text-ink-2" : ch.severity === "BLOCK" ? "font-medium text-rose-800" : "font-medium text-amber-900"}>{ch.label}</span>
                </li>
              ))}
            </ul>
            <div className="mt-3 flex items-center gap-2 rounded-lg bg-canvas px-3 py-2 text-sm">
              <PolicyBadge decision={pe.decision} />
              <span className="text-ink-2">
                {pe.decision === "REVIEW_REQUIRED"
                  ? "Because review-first is on, a person must approve before anything is sent."
                  : pe.decision === "BLOCK"
                    ? "Outside merchant policy. The AI cannot override this — edit the plan or change policy."
                    : "Within policy."}
              </span>
            </div>
          </section>

          <section>
            <Eyebrow>Message that would accompany the link</Eyebrow>
            <div className="mt-1.5 rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink-2">
              Hi, as discussed, here is a payment link for {c.invoiceNumber}. You can pay {formatINR(plan?.installments[0]?.amount ?? 0)} now and the balance of {formatINR(plan?.installments[1]?.amount ?? 0)} by {plan?.installments[1]?.dueDate ? formatDate(plan.installments[1].dueDate, false) : "the agreed date"}. Thank you.
            </div>
            <div className="mt-1 text-[11px] text-ink-3">No pressure or false-urgency language. Buyer notifications are disabled in this prototype.</div>
          </section>

          <section className="text-xs text-ink-3">
            On approval: payment is re-checked, then a{" "}
            {status?.razorpayMode === "TEST_MODE" ? "Razorpay test-mode Payment Link (accept_partial, first_min_partial_amount)" : "clearly labelled simulated payment link (Razorpay test credentials not configured)"} is created.
          </section>
        </div>

        {open && (
          <div className="mt-auto flex gap-2 border-t border-line px-6 py-4">
            <Button onClick={async () => { await approve(action.id); onClose(); }} disabled={busy || action.status === "BLOCKED"}>
              <Check className="h-4 w-4" aria-hidden /> Approve
            </Button>
            <Button variant="secondary" onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4" aria-hidden /> Edit
            </Button>
            <Button variant="danger" onClick={() => { reject(action.id); onClose(); }}>
              <X className="h-4 w-4" aria-hidden /> Reject
            </Button>
          </div>
        )}
      </aside>
    </div>
  );
}
