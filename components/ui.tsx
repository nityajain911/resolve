"use client";

import clsx from "clsx";
import {
  Ban, Banknote, Bot, CalendarClock, CircleCheck, CircleHelp, FileText, FileWarning, FlaskConical, Landmark,
  Mail, MessageSquare, Mic, RefreshCw, Scale, ScanText, ShieldCheck, Timer, TriangleAlert, UserCheck, Wallet,
  type LucideIcon,
} from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { STATE_META } from "@/domain/state-machine";
import type { ConfidenceBand, EvidenceType, InvoiceState, PolicyDecision } from "@/domain/types";

export const STATE_STYLE: Record<InvoiceState, { chip: string; dot: string; icon: LucideIcon; bar: string }> = {
  FOLLOW_UP_ACTIVE: { chip: "bg-sky-50 text-sky-800 ring-sky-200", dot: "bg-sky-500", icon: RefreshCw, bar: "bg-sky-500" },
  PAID_UNMATCHED: { chip: "bg-teal-50 text-teal-800 ring-teal-200", dot: "bg-teal-500", icon: Landmark, bar: "bg-teal-500" },
  PAPERWORK_BLOCKED: { chip: "bg-amber-50 text-amber-900 ring-amber-300", dot: "bg-amber-500", icon: FileWarning, bar: "bg-amber-500" },
  CASH_CONSTRAINED: { chip: "bg-orange-50 text-orange-900 ring-orange-200", dot: "bg-orange-500", icon: Wallet, bar: "bg-orange-500" },
  PROMISE_TO_PAY: { chip: "bg-violet-50 text-violet-800 ring-violet-200", dot: "bg-violet-500", icon: CalendarClock, bar: "bg-violet-500" },
  NEEDS_REVIEW: { chip: "bg-white text-amber-900 ring-amber-400 ring-2 ring-dashed", dot: "bg-amber-400", icon: CircleHelp, bar: "bg-amber-300" },
  COMMERCIAL_DISPUTE: { chip: "bg-rose-50 text-rose-800 ring-rose-200", dot: "bg-rose-500", icon: Scale, bar: "bg-rose-500" },
  RESOLVED: { chip: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-500", icon: CircleCheck, bar: "bg-emerald-500" },
};

export function StateBadge({ state, size = "sm" }: { state: InvoiceState; size?: "sm" | "lg" }) {
  const s = STATE_STYLE[state];
  const Icon = s.icon;
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full font-medium ring-1",
        s.chip,
        state === "NEEDS_REVIEW" && "border border-dashed border-amber-500 ring-0",
        size === "lg" ? "px-3 py-1 text-sm" : "px-2 py-0.5 text-xs",
      )}
    >
      <Icon className={size === "lg" ? "h-4 w-4" : "h-3.5 w-3.5"} aria-hidden />
      {STATE_META[state].label}
    </span>
  );
}

export function PolicyBadge({ decision }: { decision: PolicyDecision }) {
  const map = {
    ALLOW: { cls: "bg-emerald-50 text-emerald-800 ring-emerald-200", icon: ShieldCheck, label: "Allowed" },
    REVIEW_REQUIRED: { cls: "bg-amber-50 text-amber-900 ring-amber-300", icon: UserCheck, label: "Review required" },
    BLOCK: { cls: "bg-rose-50 text-rose-800 ring-rose-200", icon: Ban, label: "Blocked" },
  }[decision];
  const Icon = map.icon;
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1", map.cls)}>
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {map.label}
    </span>
  );
}

export function ConfidenceBadge({ band }: { band: ConfidenceBand }) {
  return band === "HIGH" ? (
    <span className="inline-flex items-center gap-1 rounded-md bg-ink px-2 py-0.5 text-[11px] font-semibold tracking-wide text-white">HIGH CONFIDENCE</span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded-md border border-dashed border-amber-500 px-2 py-0.5 text-[11px] font-semibold tracking-wide text-amber-900">
      <TriangleAlert className="h-3 w-3" aria-hidden /> NEEDS REVIEW
    </span>
  );
}

/** Visible, tasteful label for anything simulated or synthetic. */
export function SimLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded border border-dashed border-slate-300 bg-slate-50 px-1.5 py-0.5 text-[11px] font-medium text-slate-600", className)}>
      <FlaskConical className="h-3 w-3" aria-hidden />
      {children}
    </span>
  );
}

export const EVIDENCE_ICON: Record<EvidenceType | "TIMER" | "TRANSITION" | "ACTION" | "ASSESSMENT", { icon: LucideIcon; label: string }> = {
  BUYER_MESSAGE: { icon: MessageSquare, label: "Message" },
  BUYER_EMAIL: { icon: Mail, label: "Email" },
  VOICE_NOTE_TRANSCRIPT: { icon: Mic, label: "Voice note" },
  SCREENSHOT_TEXT: { icon: ScanText, label: "Screenshot" },
  BANK_CREDIT: { icon: Landmark, label: "Bank" },
  PAYMENT_EVENT: { icon: Banknote, label: "Payment" },
  IMS_IMPORT: { icon: FileText, label: "IMS" },
  INVOICE_DATA: { icon: FileText, label: "Invoice" },
  MANUAL_NOTE: { icon: FileText, label: "Note" },
  MERCHANT_OVERRIDE: { icon: UserCheck, label: "Merchant" },
  TIMER: { icon: Timer, label: "Timer" },
  TRANSITION: { icon: RefreshCw, label: "State" },
  ACTION: { icon: Bot, label: "Action" },
  ASSESSMENT: { icon: ShieldCheck, label: "Assessment" },
};

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md" }) {
  return (
    <button
      {...props}
      className={clsx(
        "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
        variant === "primary" && "bg-brand text-white shadow-sm hover:bg-brand-600",
        variant === "secondary" && "border border-line bg-white text-ink hover:bg-canvas",
        variant === "ghost" && "text-ink-2 hover:bg-line-2",
        variant === "danger" && "border border-rose-200 bg-white text-rose-700 hover:bg-rose-50",
        className,
      )}
    />
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("card", className)}>{children}</div>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={clsx("text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-3", className)}>{children}</div>;
}
