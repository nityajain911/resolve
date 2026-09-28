"use client";

import clsx from "clsx";
import { Clock, FastForward, Play, RotateCcw } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { formatIst } from "@/domain/time";
import { nextPendingTimer } from "@/domain/timers";
import { useResolve } from "@/lib/store";
import { DemoGuide } from "./demo-guide";
import { Button, SimLabel } from "./ui";

const NAV = [
  { href: "/", label: "Command centre" },
  { href: "/policy", label: "Policy & controls" },
  { href: "/evaluation", label: "Evaluation & impact" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const { world, reset, advanceDays, advanceClock, toasts, demoMode, setDemoMode, status } = useResolve();
  const path = usePathname();
  const next = nextPendingTimer(world.timers);

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-30 border-b border-line bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] items-center gap-6 px-6 py-3">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm font-bold text-white">R</span>
            <span className="leading-tight">
              <span className="block text-[15px] font-semibold tracking-tight">Resolve</span>
              <span className="block whitespace-nowrap text-[11px] text-ink-3">Agent Studio concept</span>
            </span>
          </Link>
          <nav className="flex items-center gap-1">
            {NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className={clsx(
                  "whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium",
                  (n.href === "/" ? path === "/" || path.startsWith("/cases") : path.startsWith(n.href)) ? "bg-brand-50 text-brand-600" : "text-ink-2 hover:bg-line-2",
                )}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-line bg-canvas px-2.5 py-1.5" title="Demo clock (Asia/Kolkata). Advancing it fires scheduled timers.">
              <Clock className="h-4 w-4 text-ink-3" aria-hidden />
              <span className="num whitespace-nowrap text-sm font-medium">{formatIst(world.clock)}</span>
              <SimLabel>Demo clock</SimLabel>
            </div>
            <Button variant="secondary" size="sm" onClick={() => advanceDays(1)} title="Advance demo clock by one day">
              +1 day
            </Button>
            {next && (
              <Button variant="secondary" size="sm" onClick={() => advanceClock(new Date(new Date(next.fireAt).getTime() + 60000).toISOString())} title={`Next timer: ${formatIst(next.fireAt)}`}>
                <FastForward className="h-3.5 w-3.5" aria-hidden /> Next timer
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={reset} title="Reset invoice states, timers, approvals, simulated payments and the demo clock">
              <RotateCcw className="h-3.5 w-3.5" aria-hidden /> Reset demo
            </Button>
            <Button variant={demoMode ? "primary" : "secondary"} size="sm" onClick={() => setDemoMode(!demoMode)}>
              <Play className="h-3.5 w-3.5" aria-hidden /> Demo mode
            </Button>
          </div>
        </div>
        <div className="border-t border-line-2 bg-canvas/60">
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-6 py-1.5 text-[11px] text-ink-3">
            <span className="font-medium text-ink-2">Prototype — nothing here is live:</span>
            <SimLabel>Synthetic invoice book</SimLabel>
            <SimLabel>Simulated Receivables Agent handoff</SimLabel>
            <SimLabel>Simulated buyer messages</SimLabel>
            <SimLabel>Imported synthetic IMS evidence</SimLabel>
            <SimLabel>{status?.razorpayMode === "TEST_MODE" ? "Test-mode Razorpay Payment Links" : "Simulated payment links"}</SimLabel>
            <SimLabel>Simulated payment events</SimLabel>
            <span className="ml-auto">Classifier: {status?.classifier ?? "demo-lexicon-v1 (deterministic)"}</span>
          </div>
        </div>
      </header>

      <main className={clsx("mx-auto w-full max-w-[1400px] flex-1 px-6 py-6", demoMode && "pb-40")}>{children}</main>

      {demoMode && <DemoGuide />}

      <div className="pointer-events-none fixed right-6 top-28 z-50 flex w-96 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={clsx(
              "pointer-events-auto rounded-lg border px-3.5 py-2.5 text-sm shadow-lg",
              t.tone === "ok" && "border-emerald-200 bg-white text-ink",
              t.tone === "warn" && "border-amber-300 bg-amber-50 text-amber-950",
              t.tone === "error" && "border-rose-300 bg-rose-50 text-rose-900",
            )}
          >
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
