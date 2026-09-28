/**
 * A COMPETENT RULES BASELINE — a stronger comparison than "remind everyone".
 *
 * Uses only observable data (like Resolve), and no classifier:
 *   1. Ledger check: skip invoices reconciled as paid.
 *   2. Deterministic STRONG bank matching (amount + invoice reference).
 *   3. Keyword suppression: any buyer text mentioning payment made, a dispute,
 *      or a document problem suppresses the reminder.
 *
 * Reported next to Resolve so the page shows what Resolve adds over simple rules,
 * not only over blind reminders.
 */
import { buildGroundTruth } from "@/data/synthetic/ground-truth";
import { buildInvoiceBook, DEFAULT_SEED } from "@/data/synthetic/invoice-book";
import { matchCredit } from "@/domain/matching";
import type { InvoiceCase } from "@/domain/types";
import { computeWrongChaseReport } from "./wrong-chase";

export const RULES_BASELINE_KEYWORDS =
  /\b(paid|payment (kar|ho) (diya|di|gaya)|bhej diya|utr|neft|rtgs|transferred|damage|damaged|defect|defective|quality|dispute|reject|rejected|galat|wrong|incorrect|gstin|gst|po|challan|grn|hsn|short|return|debit note|tds)\b/i;

const TEXT_TYPES = ["BUYER_MESSAGE", "BUYER_EMAIL", "VOICE_NOTE_TRANSCRIPT", "SCREENSHOT_TEXT"];

export interface BaselineRow {
  invoiceId: string;
  invoiceNumber: string;
  suppressed: boolean;
  why?: "LEDGER_PAID" | "STRONG_BANK_MATCH" | "KEYWORD";
}

export function computeRulesBaseline(seed = DEFAULT_SEED): BaselineRow[] {
  const book = buildInvoiceBook(seed);
  const buyers = Object.fromEntries(book.buyers.map((b) => [b.buyerId, b]));
  return book.invoices.map((inv) => {
    const paid = inv.evidence
      .filter((e) => e.type === "PAYMENT_EVENT" && e.structuredExtraction?.kind === "PAYMENT_EVENT" && e.structuredExtraction.data.reconciled)
      .reduce((s, e) => s + (e.structuredExtraction?.kind === "PAYMENT_EVENT" ? e.structuredExtraction.data.amount : 0), 0);
    const outstanding = Math.max(0, inv.amount - paid);
    const base = { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber };
    if (outstanding <= 0) return { ...base, suppressed: true, why: "LEDGER_PAID" as const };
    const asCase = {
      invoiceNumber: inv.invoiceNumber,
      amount: inv.amount,
      outstandingAmount: outstanding,
      issuedAt: inv.issuedAt,
      buyerContext: buyers[inv.buyerId],
    } as unknown as InvoiceCase;
    if (book.bankFeed.some((b) => matchCredit(b.data, asCase).strength === "STRONG")) {
      return { ...base, suppressed: true, why: "STRONG_BANK_MATCH" as const };
    }
    if (inv.evidence.some((e) => TEXT_TYPES.includes(e.type) && RULES_BASELINE_KEYWORDS.test(e.rawContent))) {
      return { ...base, suppressed: true, why: "KEYWORD" as const };
    }
    return { ...base, suppressed: false };
  });
}

export interface BaselineComparison {
  M: number;
  reminderOnly: { blocked: number; unnecessaryPauses: number };
  rules: { blocked: number; unnecessaryPauses: number; avoidableHandled: number };
  resolve: { blocked: number; unnecessaryPauses: number; avoidableHandled: number };
  avoidableTotal: number;
  resolveOnly: { invoiceNumber: string; note: string }[];
  rulesOnly: { invoiceNumber: string; note: string }[];
  /** Cases the keyword rule suppressed but where the right action differed (e.g. promise/plan needed). */
  keywordFalsePauses: { invoiceNumber: string; note: string }[];
}

export function compareBaselines(seed = DEFAULT_SEED): BaselineComparison {
  const resolve = computeWrongChaseReport(seed);
  const rules = new Map(computeRulesBaseline(seed).map((r) => [r.invoiceId, r]));
  const truth = buildGroundTruth(seed);
  const wrong = resolve.rows.filter((r) => r.wrongChase);
  const rulesBlocks = (id: string) => rules.get(id)!.suppressed && rules.get(id)!.why !== "LEDGER_PAID";
  const unnecessary = (id: string) => truth[id].trueBlocker === "NONE" && !truth[id].actuallyPaid;
  const open = resolve.rows.filter((r) => r.baselineChases);
  return {
    M: resolve.M,
    reminderOnly: { blocked: 0, unnecessaryPauses: 0 },
    rules: {
      blocked: wrong.filter((r) => rulesBlocks(r.invoiceId)).length,
      unnecessaryPauses: open.filter((r) => rulesBlocks(r.invoiceId) && unnecessary(r.invoiceId)).length,
      avoidableHandled: open.filter((r) => r.avoidable && rulesBlocks(r.invoiceId)).length,
    },
    resolve: { blocked: resolve.N, unnecessaryPauses: resolve.unnecessaryPauses.length, avoidableHandled: resolve.avoidable.blocked },
    avoidableTotal: resolve.avoidable.total,
    resolveOnly: wrong.filter((r) => r.resolveBlocks && !rulesBlocks(r.invoiceId)).map((r) => ({ invoiceNumber: r.invoiceNumber, note: r.truthNote })),
    rulesOnly: wrong.filter((r) => !r.resolveBlocks && rulesBlocks(r.invoiceId)).map((r) => ({ invoiceNumber: r.invoiceNumber, note: r.truthNote })),
    keywordFalsePauses: open.filter((r) => rulesBlocks(r.invoiceId) && unnecessary(r.invoiceId)).map((r) => ({ invoiceNumber: r.invoiceNumber, note: r.truthNote })),
  };
}
