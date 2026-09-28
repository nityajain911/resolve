"use client";

/**
 * Client-side demo store. The deterministic engine (/domain) runs in the browser on
 * the OBSERVABLE synthetic book; state is persisted per-browser in localStorage.
 * Server calls: /api/payment-links (Razorpay test mode or simulated) and
 * /api/classify (live model only if configured).
 *
 * This file must never import hidden ground truth (see tests/ground-truth-isolation.test.ts).
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { ClassifierInput } from "@/ai/classifier";
import { classifyDemo } from "@/ai/demo-classifier";
import { buildInvoiceBook } from "@/data/synthetic/invoice-book";
import type { BookEvidence } from "@/domain/book";
import * as engine from "@/domain/engine";
import { istDate } from "@/domain/time";
import type { CaseUnderstanding, InvoiceState, MerchantPolicy, PaymentLinkRecord, WorldState } from "@/domain/types";

const STORAGE_KEY = "resolve-demo-world-v3";
const ctx = { classify: classifyDemo };

function persist(w: WorldState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(w));
  } catch {
    /* storage unavailable — demo still works in memory */
  }
}

export function freshWorld(): WorldState {
  return engine.createWorld(buildInvoiceBook(), ctx);
}

export interface ServerStatus {
  razorpayMode: "TEST_MODE" | "SIMULATED";
  razorpayReason: string | null;
  classifier: string;
}

export interface Toast {
  id: number;
  tone: "ok" | "warn" | "error";
  text: string;
}

interface Store {
  world: WorldState;
  status: ServerStatus | null;
  toasts: Toast[];
  demoMode: boolean;
  demoStep: number;
  busy: boolean;
  setDemoMode: (on: boolean) => void;
  setDemoStep: (n: number) => void;
  reset: () => void;
  advanceClock: (toIso: string) => void;
  advanceDays: (days: number) => void;
  approve: (actionId: string) => Promise<void>;
  reject: (actionId: string) => void;
  editPlan: (actionId: string, immediateAmount: number, remainderDate: string) => void;
  markCorrectionIssued: (caseId: string) => void;
  classify: (caseId: string, state: InvoiceState, opts?: { note?: string; promiseDate?: string }) => void;
  simulatePayment: (caseId: string, amount: number) => void;
  addBuyerReply: (caseId: string, text: string, type?: BookEvidence["type"]) => Promise<void>;
  updatePolicy: (patch: Partial<Omit<MerchantPolicy, "version">>) => void;
  notify: (text: string, tone?: Toast["tone"]) => void;
}

const Ctx = createContext<Store | null>(null);

export function ResolveProvider({ children }: { children: ReactNode }) {
  const [world, setWorld] = useState<WorldState>(freshWorld);
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [demoMode, setDemoModeState] = useState(false);
  const [demoStep, setDemoStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const worldRef = useRef(world);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as WorldState;
        if (saved?.caseOrder?.length) {
          worldRef.current = saved;
          // Hydrating from browser storage after mount (SSR renders the fresh seeded book).
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setWorld(saved);
        }
      }
      if (localStorage.getItem("resolve-demo-mode") === "1") setDemoModeState(true);
    } catch {
      /* storage unavailable — fresh demo */
    }
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setStatus({ razorpayMode: "SIMULATED", razorpayReason: "Server status unavailable", classifier: "demo-lexicon-v1 (deterministic)" }));
  }, []);

  const notify = useCallback((text: string, tone: Toast["tone"] = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, tone, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  const run = useCallback(
    (fn: (w: WorldState) => WorldState, ok?: string) => {
      try {
        const next = fn(worldRef.current);
        worldRef.current = next;
        setWorld(next);
        persist(next);
        if (ok) notify(ok);
        return next;
      } catch (e) {
        notify(e instanceof Error ? e.message : String(e), "error");
        return null;
      }
    },
    [notify],
  );

  const approve = useCallback(
    async (actionId: string) => {
      const a = worldRef.current.actions[actionId];
      if (!a) return;
      const approved = run((w) => engine.approveAction(w, actionId));
      if (!approved || a.type !== "CREATE_PART_PAYMENT_LINK") {
        if (approved) notify("Approved");
        return;
      }
      // Buyer-facing: re-check payment + policy immediately before sending.
      const executing = run((w) => engine.beginExecution(w, actionId));
      if (!executing) return;
      const act = executing.actions[actionId];
      if (act.status === "BLOCKED") {
        notify(act.result ?? "Blocked at send time", "warn");
        return;
      }
      const c = executing.cases[act.invoiceId];
      const plan = c.paymentPlan!;
      setBusy(true);
      let link: PaymentLinkRecord;
      try {
        const res = await fetch("/api/payment-links", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            invoiceNumber: c.invoiceNumber,
            outstandingAmount: c.outstandingAmount,
            firstMinPartialAmount: plan.installments[0].amount,
            finalDate: plan.installments[1]?.dueDate,
            customer: { name: c.buyerContext.name, email: c.buyerContext.contact.email, contact: c.buyerContext.contact.phone },
            planId: plan.id,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? "Link creation failed");
        link = body.link;
      } catch (e) {
        link = {
          mode: "SIMULATED",
          id: `plink_SIM_${c.invoiceNumber.replace(/\W/g, "")}`,
          shortUrl: `https://simulated.invalid/plink_SIM_${c.invoiceNumber.replace(/\W/g, "")}`,
          amount: c.outstandingAmount,
          acceptPartial: true,
          firstMinPartialAmount: plan.installments[0].amount,
          createdAt: new Date().toISOString(),
          fallbackReason: `Server unavailable: ${e instanceof Error ? e.message : e}`,
        };
      } finally {
        setBusy(false);
      }
      run((w) => engine.completePaymentLink(w, actionId, link), link.mode === "TEST_MODE" ? "Razorpay test-mode link created" : "Simulated payment link created");
    },
    [run, notify],
  );

  const addBuyerReply = useCallback(
    async (caseId: string, text: string, type: BookEvidence["type"] = "BUYER_MESSAGE") => {
      const w = worldRef.current;
      const c = w.cases[caseId];
      const e: BookEvidence = { type, timestamp: w.clock, source: "Simulated buyer message (typed in demo)", rawContent: text, isSynthetic: true };
      let understanding: CaseUnderstanding | undefined;
      if (status?.classifier.startsWith("live")) {
        setBusy(true);
        try {
          const input: ClassifierInput = {
            primaryEvidence: { id: "pending", type, text, timestamp: w.clock },
            supportingEvidence: c.evidence.filter((x) => ["BUYER_MESSAGE", "BUYER_EMAIL", "VOICE_NOTE_TRANSCRIPT", "SCREENSHOT_TEXT", "IMS_IMPORT"].includes(x.type)).map((x) => ({ id: x.id, type: x.type, text: x.rawContent, timestamp: x.timestamp })),
            invoice: { invoiceNumber: c.invoiceNumber, amount: c.amount, outstandingAmount: c.outstandingAmount, dueAt: c.dueAt },
            buyerName: c.buyerContext.name,
          };
          const res = await fetch("/api/classify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
          understanding = (await res.json()).understanding;
        } catch {
          understanding = undefined; // fall back to the deterministic classifier inside the engine
        } finally {
          setBusy(false);
        }
      }
      run((cur) => engine.ingestEvidence(cur, ctx, caseId, e, understanding), "Buyer reply added and classified");
    },
    [run, status],
  );

  const store: Store = useMemo(
    () => ({
      world,
      status,
      toasts,
      demoMode,
      demoStep,
      busy,
      notify,
      setDemoMode: (on) => {
        setDemoModeState(on);
        try {
          localStorage.setItem("resolve-demo-mode", on ? "1" : "0");
        } catch {
          /* ignore */
        }
      },
      setDemoStep,
      reset: () => {
        const w = freshWorld();
        worldRef.current = w;
        setWorld(w);
        persist(w);
        setDemoStep(0);
        notify("Demo reset — same seed, same invoice book");
      },
      advanceClock: (to) => run((w) => engine.advanceClock(w, to)),
      advanceDays: (days) =>
        run((w) => engine.advanceClock(w, new Date(new Date(w.clock).getTime() + days * 86400000).toISOString()), `Demo clock → ${istDate(new Date(new Date(worldRef.current.clock).getTime() + days * 86400000).toISOString())}`),
      approve,
      reject: (id) => run((w) => engine.rejectAction(w, id), "Rejected — recorded in the audit trail"),
      editPlan: (id, amt, date) => run((w) => engine.editPartPaymentPlan(w, id, { immediateAmount: amt, remainderDate: date }), "Plan updated — policy re-evaluated"),
      markCorrectionIssued: (id) => run((w) => engine.markCorrectionIssued(w, id), "Correction marked issued"),
      classify: (id, s, opts) => run((w) => engine.classifyCase(w, id, s, opts), "Classified · added to labelled review set"),
      simulatePayment: (id, amt) => run((w) => engine.simulatePayment(w, id, amt), "Simulated payment event recorded"),
      addBuyerReply,
      updatePolicy: (patch) => run((w) => engine.updatePolicy(w, patch), "Policy updated"),
    }),
    [world, status, toasts, demoMode, demoStep, busy, notify, run, approve, addBuyerReply],
  );

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useResolve(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useResolve outside ResolveProvider");
  return s;
}
