/**
 * Draft CANDIDATE held-out cases with a DIFFERENT model family than the one evaluated.
 *
 *   npm run heldout:draft            → evaluation/heldout-candidates.json  (NOT an evaluation set)
 *   (human reviews / corrects every label)
 *   npm run heldout:promote -- --reviewed-by "Your Name"   → evaluation/heldout-cases.json
 *
 * Independence rules enforced here and by tests/heldout-independence.test.ts:
 *   - the drafting model is qwen/qwen3.8-27b, not the evaluated openai/gpt-oss-120b;
 *   - this script never reads the classifier prompt (ai/prompts) or development-cases.json;
 *   - it prints only counts, so the classifier developer does not see the cases.
 * Labels drafted by a model are NOT ground truth until a person has reviewed them.
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import Groq from "groq-sdk";
import { validateCases } from "@/evaluation/heldout-loader";
import type { CaseFile, HeldoutCase } from "@/evaluation/types";

const DRAFT_MODEL = process.env.HELDOUT_DRAFT_MODEL ?? "qwen/qwen3.8-27b";
const OUT = path.join(process.cwd(), "evaluation", "heldout-candidates.json");

const BRIEF = `You are writing an evaluation set of buyer replies to payment reminders for an Indian B2B
manufacturer (packaging). Buyers are Indian companies. Replies arrive on WhatsApp/email and may be English,
Hindi written in Latin script, or Hinglish, often short, with spelling mistakes and no punctuation.

For each case write a realistic reply, a message timestamp (ISO 8601 UTC; vary weekdays, times of day, month
ends and weekends between 2026-09-01 and 2026-12-31), and the CORRECT expected labels:

expectedState — the state an accounts team should route the invoice to:
  FOLLOW_UP_ACTIVE   no blocker stated (acknowledgement, "will check", or a promise with no date)
  PAID_UNMATCHED     buyer says they already paid
  PAPERWORK_BLOCKED  a document / tax-data problem blocks processing (wrong GSTIN, missing/wrong PO,
                     invoice format rejected, missing challan / e-way bill / GRN document, HSN issue)
  CASH_CONSTRAINED   buyer asks to split / extend with an amount now AND a date for the rest
  PROMISE_TO_PAY     a clear promise with a precise day ("Monday tak", "5 Oct ko", "kal")
  COMMERCIAL_DISPUTE buyer disputes goods, quantity, quality or rate
  NEEDS_REVIEW       genuinely ambiguous or mixed, or a date that cannot be resolved safely

Date conventions (resolve against the message timestamp in Asia/Kolkata, UTC+05:30):
  - kal = tomorrow; in past tense ("kar diya tha") = yesterday
  - parso = day after tomorrow ONLY with a clear future verb ("kar dunga", "denge"); otherwise AMBIGUOUS
  - "<weekday>" = next occurrence after the message date; if sent ON that weekday → AMBIGUOUS
  - "next <weekday>" is AMBIGUOUS if that occurrence falls in the same Monday–Sunday week as the message
  - "15 ke baad" / "after the 15th" = AFTER_DATE with lowerBound the next 15th on/after the message date;
    it is not an exact promise → NEEDS_REVIEW unless part of an amount-now-plus-rest split
  - "next week", "this week", "jaldi", "few days" = imprecise → NEEDS_REVIEW
expectedTemporalExpression: null if no time is mentioned, else {type, normalizedDate|lowerBound|upperBound,
  confidenceBand}. type ∈ EXACT_DATE, RELATIVE_DATE, DATE_RANGE, AFTER_DATE, AMBIGUOUS. Dates YYYY-MM-DD.
expectedExtractedAmounts: distinct rupee amounts as numbers ("90K" = 90000, "1.5L" = 150000), including the
  remainder derived from invoiceOutstanding when the buyer says "baaki"/"balance". Never include invoice,
  UTR, account or GST numbers.
Set invoiceOutstanding (rupees) on every case. Put a one-line justification in notes.`;

const BATCHES: { focus: string; temporalCategory?: string }[] = [
  { focus: "weekday references (Monday tak, somvar, by Friday, including sent-on-that-weekday cases)", temporalCategory: "WEEKDAY" },
  { focus: "kal / tomorrow, including past-tense kal", temporalCategory: "TOMORROW_KAL" },
  { focus: "parso, with and without future tense", temporalCategory: "PARSO" },
  { focus: "after-the-15th style (15 ke baad, 20 tareekh ke baad)", temporalCategory: "AFTER_15TH" },
  { focus: "next <weekday> (next Friday), across week boundaries", temporalCategory: "NEXT_FRIDAY" },
  { focus: "month and year boundaries (month end, 31 tak in 30-day months, dates in next month / January)", temporalCategory: "MONTH_BOUNDARY" },
  { focus: "weekend boundaries (weekend tak, weekend ke baad, Monday sent on Friday/Saturday)", temporalCategory: "WEEKEND_BOUNDARY" },
  { focus: "explicit dates (5 Oct, 12/10, 3rd Nov)", temporalCategory: "EXPLICIT_DATE" },
  { focus: "vague timing (jaldi, few days, next week)", temporalCategory: "VAGUE" },
  { focus: "paperwork problems (GSTIN, PO, format, challan, GRN, HSN) in varied wording" },
  { focus: "commercial disputes (damage, short supply, rate, quality), some partial with amounts" },
  { focus: "buyer claims already paid (UTR / NEFT / cheque / screenshot text), including reference numbers that must NOT be amounts" },
  { focus: "cash constraints and split requests with amounts, some exceeding the outstanding" },
  { focus: "no blocker: acknowledgements, 'will check', undated promises" },
  { focus: "mixed or ambiguous signals (on hold, PO mismatch, query raised, contradictory statements)" },
];

const caseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["cases"],
  properties: {
    cases: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["message", "messageTimestamp", "expectedState", "expectedExtractedAmounts", "expectedTemporalExpression", "expectedConfidenceBand", "invoiceOutstanding", "language", "notes"],
        properties: {
          message: { type: "string" },
          messageTimestamp: { type: "string" },
          expectedState: { type: "string", enum: ["FOLLOW_UP_ACTIVE", "PAID_UNMATCHED", "PAPERWORK_BLOCKED", "CASH_CONSTRAINED", "PROMISE_TO_PAY", "COMMERCIAL_DISPUTE", "NEEDS_REVIEW"] },
          expectedExtractedAmounts: { type: "array", items: { type: "number" } },
          expectedTemporalExpression: {
            type: ["object", "null"],
            additionalProperties: false,
            required: ["type", "normalizedDate", "lowerBound", "upperBound", "confidenceBand"],
            properties: {
              type: { type: "string", enum: ["EXACT_DATE", "RELATIVE_DATE", "DATE_RANGE", "AFTER_DATE", "AMBIGUOUS"] },
              normalizedDate: { type: ["string", "null"] },
              lowerBound: { type: ["string", "null"] },
              upperBound: { type: ["string", "null"] },
              confidenceBand: { type: "string", enum: ["HIGH", "NEEDS_REVIEW"] },
            },
          },
          expectedConfidenceBand: { type: "string", enum: ["HIGH", "NEEDS_REVIEW"] },
          invoiceOutstanding: { type: "number" },
          language: { type: "string", enum: ["EN", "HI", "HINGLISH"] },
          notes: { type: "string" },
        },
      },
    },
  },
} as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  if (!process.env.GROQ_API_KEY) throw new Error("GROQ_API_KEY required");
  if (DRAFT_MODEL === (process.env.RESOLVE_LIVE_MODEL ?? "openai/gpt-oss-120b")) {
    throw new Error("The drafting model must differ from the evaluated model.");
  }
  const perBatch = Number(process.argv[process.argv.indexOf("--per-batch") + 1]) || 6;
  const groq = new Groq({ apiKey: process.env.GROQ_API_KEY, maxRetries: 0 });
  const all: HeldoutCase[] = [];
  for (const [i, b] of BATCHES.entries()) {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const res = await groq.chat.completions.create({
          model: DRAFT_MODEL,
          messages: [
            { role: "system", content: BRIEF },
            { role: "user", content: `Write ${perBatch} distinct cases focused on: ${b.focus}. Mix languages and styles. Make at least a third of them tricky.` },
          ],
          response_format: { type: "json_schema", json_schema: { name: "heldout_cases", strict: true, schema: caseSchema } },
        });
        const parsed = JSON.parse(res.choices[0]?.message?.content ?? "{}") as { cases?: Record<string, unknown>[] };
        for (const [j, c] of (parsed.cases ?? []).entries()) {
          const t = c.expectedTemporalExpression as Record<string, unknown> | null;
          all.push({
            ...(c as unknown as HeldoutCase),
            id: `ho-${String(i + 1).padStart(2, "0")}-${j + 1}`,
            temporalCategory: b.temporalCategory as HeldoutCase["temporalCategory"],
            expectedTemporalExpression: t
              ? (Object.fromEntries(Object.entries(t).filter(([, v]) => v !== null)) as unknown as HeldoutCase["expectedTemporalExpression"])
              : null,
          });
        }
        console.log(`batch ${i + 1}/${BATCHES.length}: ${parsed.cases?.length ?? 0} drafted`);
        break;
      } catch (e) {
        if (e instanceof Groq.RateLimitError) {
          const m = /try again in ([\d.]+)s/i.exec(e.message);
          await sleep((m ? Number(m[1]) * 1000 : 8000) + 500);
          continue;
        }
        console.error(`batch ${i + 1} failed: ${e instanceof Error ? e.message.slice(0, 160) : e}`);
        break;
      }
    }
  }
  const file: CaseFile = {
    meta: {
      set: "example",
      heldOut: false,
      authoredBy: `groq:${DRAFT_MODEL} (drafted blind: no access to the classifier prompt or development set)`,
      authoredAt: new Date().toISOString().slice(0, 10),
      warning: "CANDIDATES ONLY. Every label must be reviewed and corrected by a person, then promoted with `npm run heldout:promote`. Do not show these to the classifier developer before the evaluation is run.",
    },
    cases: all,
  };
  const { errors } = validateCases(file);
  writeFileSync(OUT, JSON.stringify(file, null, 2));
  console.log(`\nWrote ${all.length} candidate cases to ${path.relative(process.cwd(), OUT)} (${errors.length} schema problems to fix during review).`);
  console.log("Contents intentionally not printed. Review every label before promoting.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
