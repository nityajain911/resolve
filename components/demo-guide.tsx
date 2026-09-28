"use client";

import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useResolve } from "@/lib/store";
import { Button } from "./ui";

export const DEMO_STEPS = [
  { t: "0–10s", title: "Command centre", href: "/", line: "Simulated Receivables Agent handoff: these invoices are still unpaid after standard reminders and calls. Resolve groups them by what is actually blocking payment." },
  { t: "10–35s", title: "GSTIN blocker", href: "/cases/inv-scp-1057", line: "Buyer: “GSTIN galat hai”. Imported IMS evidence supports it. Resolve pauses the chase, routes to Accounts and drafts a correction — approval required." },
  { t: "35–60s", title: "Cash constraint", href: "/cases/inv-scp-1049", line: "“₹90K aaj, baaki 15 ke baad.” Amounts and dates extracted; the policy engine checks the plan. Approve → part-payment link (test-mode or clearly simulated)." },
  { t: "60–75s", title: "Promise to pay", href: "/cases/inv-scp-1061", line: "“Monday tak kar denge.” Buyer kept 3 of 3 promises, so Resolve waits. Advance the clock: promise missed → follow-up resumes, history becomes 3 of 4." },
  { t: "75–82s", title: "Needs review", href: "/cases/inv-scp-1053", line: "“Accounts ne park kiya, PO mismatch.” Paperwork or dispute? Resolve won't guess — no buyer message until a person classifies it." },
  { t: "82–90s", title: "Impact", href: "/evaluation", line: "Reminder-only would make M wrong chases; Resolve blocked N of them — computed from the book, with honest misses. Cash uplift is a pilot metric, not a prototype claim." },
];

export function DemoGuide() {
  const { demoStep, setDemoStep, setDemoMode } = useResolve();
  const router = useRouter();
  const step = DEMO_STEPS[demoStep];
  const go = (i: number) => {
    const n = Math.max(0, Math.min(DEMO_STEPS.length - 1, i));
    setDemoStep(n);
    router.push(DEMO_STEPS[n].href);
  };
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-white shadow-[0_-8px_24px_rgba(11,27,63,0.08)]">
      <div className="mx-auto flex max-w-[1400px] items-center gap-5 px-6 py-3">
        <div className="flex items-center gap-1">
          {DEMO_STEPS.map((s, i) => (
            <button
              key={s.title}
              onClick={() => go(i)}
              className={`h-1.5 w-8 rounded-full ${i <= demoStep ? "bg-brand" : "bg-line"}`}
              aria-label={`Step ${i + 1}: ${s.title}`}
            />
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-brand-600">
            Demo {demoStep + 1}/{DEMO_STEPS.length} · {step.t} · {step.title}
          </div>
          <div className="truncate text-sm text-ink-2" title={step.line}>
            {step.line}
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => go(demoStep - 1)} disabled={demoStep === 0}>
          <ChevronLeft className="h-4 w-4" aria-hidden /> Back
        </Button>
        <Button size="sm" onClick={() => go(demoStep + 1)} disabled={demoStep === DEMO_STEPS.length - 1}>
          Next <ChevronRight className="h-4 w-4" aria-hidden />
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setDemoMode(false)} aria-label="Close demo guide">
          <X className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}
