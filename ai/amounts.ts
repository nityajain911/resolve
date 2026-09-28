/**
 * Rupee amount extraction from buyer text: "₹90K", "90k", "1.5L", "1.5 lakh",
 * "Rs 50,000", "₹2,40,000", "50%" (of outstanding), "aadha" (half).
 * Each amount gets a role from nearby words in the same clause.
 */
import type { AmountRole, ExtractedAmount } from "@/domain/types";

const UNIT: Record<string, number> = {
  k: 1e3, thousand: 1e3, hazar: 1e3, hazaar: 1e3, hajar: 1e3,
  l: 1e5, lac: 1e5, lacs: 1e5, lakh: 1e5, lakhs: 1e5, lk: 1e5,
  cr: 1e7, crore: 1e7, crores: 1e7,
};

const ROLE_WORDS: [AmountRole, RegExp][] = [
  ["DISPUTED", /\b(damage|damaged|defect|defective|kharab|toota|broken|reject|rejected|dispute|disputed|short|kam|return|wrong rate|galat rate)\b/],
  ["REMAINDER", /\b(baaki|baki|balance|remaining|rest|remainder|bacha|bachi)\b/],
  ["IMMEDIATE", /\b(aaj|aj|abhi|now|today|turant|pehle|first|right away|immediately)\b/],
  ["PAID", /\b(paid|bheja|bhej diya|transfer|transferred|kar diya|neft|rtgs|imps|sent|deducted|kaat|kata)\b/],
  ["UNDISPUTED", /\b(undisputed|release|clear|baaki ka|rest of)\b/],
];

function roleFor(clause: string): AmountRole {
  for (const [role, re] of ROLE_WORDS) if (re.test(clause)) return role;
  return "UNSPECIFIED";
}

function clauses(text: string): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  const re = /[,;.]|\b(and|aur|but|lekin|par)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // don't split decimals like 1.5
    if (m[0] === "." && /\d/.test(text[m.index - 1] ?? "") && /\d/.test(text[m.index + 1] ?? "")) continue;
    // don't split thousands separators like 2,40,000
    if (m[0] === "," && /\d/.test(text[m.index - 1] ?? "") && /\d/.test(text[m.index + 1] ?? "")) continue;
    out.push({ start: last, end: m.index });
    last = m.index + m[0].length;
  }
  out.push({ start: last, end: text.length });
  return out;
}

export function extractAmounts(rawText: string, outstanding?: number): ExtractedAmount[] {
  const text = rawText.toLowerCase().replace(/\s+/g, " ");
  const cls = clauses(text);
  const clauseAt = (i: number) => {
    const c = cls.find((c) => i >= c.start && i < c.end) ?? cls[cls.length - 1];
    return text.slice(c.start, c.end);
  };
  const out: ExtractedAmount[] = [];
  const re = /(₹|rs\.?|inr)?\s*(\d[\d,]*(?:\.\d+)?)\s*(crores?|cr|lakhs?|lacs?|lac|lk|l|thousand|hazaa?r|hajar|k)?\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const [full, currency, num, unit] = m;
    const before = text.slice(Math.max(0, m.index - 6), m.index);
    if (/(inv|po|utr|#|no\.?|-)\s*$/.test(before)) continue; // invoice / PO / UTR numbers
    const after = text.slice(m.index + full.length, m.index + full.length + 12);
    if (/^\s*(%|percent)/.test(after)) continue;
    if (!unit && /^\s*(st|nd|rd|th|tareekh|tarikh|date|ke baad|ke bad|tak|ko|din|days?|boxes|cartons|pcs|units|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)/.test(after)) continue;
    const value = Number(num.replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const hasComma = num.includes(",");
    const amount = unit ? value * (UNIT[unit] ?? UNIT[unit.replace(/s$/, "")] ?? 1) : value;
    if (!currency && !unit && !hasComma && amount < 1000) continue; // bare small numbers are not amounts
    out.push({ rawText: full.trim(), amount: Math.round(amount), role: roleFor(clauseAt(m.index)) });
  }
  if (outstanding) {
    const pct = /(\d{1,3})\s*(%|percent|pratishat)/g;
    while ((m = pct.exec(text))) {
      const p = Number(m[1]);
      if (p > 0 && p < 100) out.push({ rawText: m[0], amount: Math.round((outstanding * p) / 100), role: roleFor(clauseAt(m.index)) });
    }
    const half = /\b(aadha|aadhe|adha|half)\b/.exec(text);
    if (half) out.push({ rawText: half[0], amount: Math.round(outstanding / 2), role: roleFor(clauseAt(half.index)) });
  }
  return out;
}

/**
 * Derive the remainder of a split-payment request from the outstanding balance
 * when the buyer only says "baaki" (the rest) without a number.
 */
export function withDerivedRemainder(amounts: ExtractedAmount[], text: string, outstanding: number): ExtractedAmount[] {
  const imm = amounts.find((a) => a.role === "IMMEDIATE");
  const hasRemainderWord = /\b(baaki|baki|balance|remaining|rest|remainder)\b/i.test(text);
  if (imm && hasRemainderWord && !amounts.some((a) => a.role === "REMAINDER") && imm.amount < outstanding) {
    return [...amounts, { rawText: "baaki (derived from outstanding)", amount: outstanding - imm.amount, role: "REMAINDER" }];
  }
  // Disputed amount stated → undisputed portion derives from outstanding.
  const disputed = amounts.find((a) => a.role === "DISPUTED");
  if (disputed && !amounts.some((a) => a.role === "UNDISPUTED") && disputed.amount < outstanding) {
    return [...amounts, { rawText: "rest of invoice (derived)", amount: outstanding - disputed.amount, role: "UNDISPUTED" }];
  }
  return amounts;
}
