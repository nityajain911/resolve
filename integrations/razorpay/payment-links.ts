/**
 * Razorpay Payment Links adapter (server-only).
 *
 * Uses the official `razorpay` Node SDK: `instance.paymentLink.create(...)` with the
 * documented fields (amount in paise, currency, accept_partial,
 * first_min_partial_amount, reference_id, description, customer, notify,
 * reminder_enable, notes, expire_by).
 *
 * Safety: only TEST-mode keys (rzp_test_…) are ever used. If credentials are missing,
 * live, or the API errors, we fall back to a clearly labelled SIMULATED link.
 * Buyer notifications are disabled — this prototype never messages real people.
 */
import Razorpay from "razorpay";
import { toPaise } from "@/domain/money";
import type { PaymentLinkRecord } from "@/domain/types";

export interface CreateLinkRequest {
  invoiceNumber: string;
  outstandingAmount: number;
  firstMinPartialAmount: number;
  finalDate?: string; // YYYY-MM-DD
  customer: { name: string; email: string; contact: string };
  planId: string;
}

export type RazorpayMode = "TEST_MODE" | "SIMULATED";

export function razorpayConfig(): { mode: RazorpayMode; reason?: string } {
  const id = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!id || !secret) return { mode: "SIMULATED", reason: "Razorpay test credentials not configured" };
  if (!id.startsWith("rzp_test_")) return { mode: "SIMULATED", reason: "Only test-mode keys (rzp_test_…) are accepted by this prototype" };
  return { mode: "TEST_MODE" };
}

export function simulatedLink(req: CreateLinkRequest, reason: string, now = new Date()): PaymentLinkRecord {
  const id = `plink_SIM_${req.invoiceNumber.replace(/\W/g, "")}_${now.getTime().toString(36)}`;
  return {
    mode: "SIMULATED",
    id,
    shortUrl: `https://simulated.invalid/${id}`,
    amount: req.outstandingAmount,
    acceptPartial: true,
    firstMinPartialAmount: req.firstMinPartialAmount,
    createdAt: now.toISOString(),
    fallbackReason: reason,
  };
}

export async function createPartPaymentLink(req: CreateLinkRequest): Promise<PaymentLinkRecord> {
  const cfg = razorpayConfig();
  if (cfg.mode === "SIMULATED") return simulatedLink(req, cfg.reason!);
  try {
    const rzp = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID!, key_secret: process.env.RAZORPAY_KEY_SECRET! });
    const expireBy = req.finalDate
      ? Math.floor(new Date(`${req.finalDate}T23:59:59+05:30`).getTime() / 1000) + 7 * 86400
      : undefined;
    const link = await rzp.paymentLink.create({
      amount: toPaise(req.outstandingAmount),
      currency: "INR",
      accept_partial: true,
      first_min_partial_amount: toPaise(req.firstMinPartialAmount),
      reference_id: `${req.invoiceNumber}-${Date.now().toString(36)}`.slice(0, 40),
      description: `${req.invoiceNumber} — agreed part-payment plan (Resolve prototype, test mode)`,
      customer: req.customer,
      notify: { sms: false, email: false },
      reminder_enable: false,
      notes: { invoice: req.invoiceNumber, resolve_plan: req.planId, source: "resolve-prototype" },
      ...(expireBy ? { expire_by: expireBy } : {}),
    });
    return {
      mode: "TEST_MODE",
      id: String(link.id),
      shortUrl: String(link.short_url),
      amount: req.outstandingAmount,
      acceptPartial: true,
      firstMinPartialAmount: req.firstMinPartialAmount,
      createdAt: new Date().toISOString(),
    };
  } catch (err) {
    const e = err as { error?: { description?: string }; message?: string; statusCode?: number };
    const why = e?.error?.description ?? e?.message ?? "unknown error";
    return simulatedLink(req, `Razorpay test-mode API error (${e?.statusCode ?? "?"}): ${why}`);
  }
}
