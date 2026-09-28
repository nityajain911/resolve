import { formatINR } from "./money";
import type { BankCreditData, InvoiceCase } from "./types";

/**
 * Deterministic bank-credit matching. This is a RULE, not an AI capability.
 *
 * Tiers:
 *   STRONG   — amount matches AND the narration carries this invoice's number.
 *              → PAID_UNMATCHED (no buyer follow-up until reconciled)
 *   POSSIBLE — amount + known payer but no invoice reference, or a reference
 *              with a different amount. The buyer may have several invoices of the
 *              same amount, so this is NOT enough to call it paid.
 *              → NEEDS_REVIEW (merchant confirms or rejects the match)
 *   NONE     — no transition.
 */

export type MatchStrength = "STRONG" | "POSSIBLE" | "NONE";

export interface MatchResult {
  strength: MatchStrength;
  rationale: string[];
  amountMatches: boolean;
  payerMatches: boolean;
  referenceMatches: boolean;
}

const STOPWORDS = new Set(["pvt", "private", "ltd", "limited", "llp", "co", "company", "and", "the", "india", "industries"]);

export function normalizeName(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

function payerMatchesBuyer(payer: string, c: InvoiceCase): boolean {
  const payerTokens = new Set(normalizeName(payer));
  const names = [c.buyerContext.name, ...c.buyerContext.aliases];
  return names.some((n) => {
    const tokens = normalizeName(n);
    if (tokens.length === 0) return false;
    const overlap = tokens.filter((t) => payerTokens.has(t)).length;
    return overlap / tokens.length >= 0.66;
  });
}

function digits(s: string): string {
  return s.replace(/\D/g, "");
}

function referenceMatchesInvoice(reference: string, invoiceNumber: string): boolean {
  const invDigits = digits(invoiceNumber);
  if (invDigits.length < 3) return false;
  if (reference.toUpperCase().includes(invoiceNumber.toUpperCase())) return true;
  // Digits must stand alone (e.g. "SCP1042" or "INV 1042"), not sit inside a longer UTR.
  return new RegExp(`(?<!\\d)${invDigits}(?!\\d)`).test(reference);
}

export function matchCredit(credit: BankCreditData, c: InvoiceCase): MatchResult {
  const tolerance = 1; // ₹1 rounding tolerance
  const amountMatches =
    Math.abs(credit.amount - c.outstandingAmount) <= tolerance || Math.abs(credit.amount - c.amount) <= tolerance;
  const payerMatches = payerMatchesBuyer(credit.payerName, c);
  const referenceMatches = referenceMatchesInvoice(credit.reference, c.invoiceNumber);
  const creditAfterIssue = new Date(credit.valueDate).getTime() >= new Date(c.issuedAt).getTime();

  const rationale: string[] = [];
  rationale.push(
    amountMatches
      ? `Amount ${formatINR(credit.amount)} equals the invoice ${credit.amount === c.amount ? "amount" : "outstanding"}`
      : `Amount ${formatINR(credit.amount)} does not equal ${formatINR(c.outstandingAmount)} outstanding`,
  );
  rationale.push(
    payerMatches
      ? `Payer "${credit.payerName}" matches buyer ${c.buyerContext.name}`
      : `Payer "${credit.payerName}" is not a known name for ${c.buyerContext.name}`,
  );
  rationale.push(
    referenceMatches
      ? `Narration "${credit.reference}" contains invoice ${c.invoiceNumber}`
      : `Narration "${credit.reference}" has no invoice reference`,
  );
  if (!creditAfterIssue) rationale.push("Credit is dated before the invoice was issued");

  let strength: MatchStrength = "NONE";
  if (creditAfterIssue && amountMatches && referenceMatches) strength = "STRONG";
  else if (creditAfterIssue && ((amountMatches && payerMatches) || referenceMatches)) strength = "POSSIBLE";

  return { strength, rationale, amountMatches, payerMatches, referenceMatches };
}
