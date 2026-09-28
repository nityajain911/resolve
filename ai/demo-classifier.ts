/**
 * DemoCaseClassifier — deterministic, lexicon-based, no model or network.
 *
 * This is what the demo and the synthetic invoice book run on so the product is
 * reproducible and never depends on an external API. It is NOT an LLM and is
 * labelled as such in the UI. It returns exactly the same CaseUnderstanding schema
 * as the live provider adapter (ai/live-classifier.ts).
 *
 * It is conservative by design: mixed or unrecognised signals go to NEEDS_REVIEW.
 */
import type { CaseUnderstanding, ExtractedAmount, InvoiceState, TemporalExpression } from "@/domain/types";
import { extractAmounts, withDerivedRemainder } from "./amounts";
import type { ClassifierInput, SyncCaseClassifier } from "./classifier";
import { extractTemporalExpressions } from "./temporal";
import { formatINR } from "@/domain/money";
import { formatDate, istDate } from "@/domain/time";

export const DEMO_CLASSIFIER_VERSION = "demo-lexicon-v1";

const RE = {
  gstin: /\b(gstin|gstn|gst ?no\.?|gst number|gst num|gst wrong|gst incorrect|gst mismatch)\b|\bgst\b.{0,8}\bgalat\b/,
  po: /\b(po|p\.o\.|purchase order)\b/,
  poProblem: /\b(po|p\.o\.|purchase order)\b.{0,25}\b(missing|nahi|nhi|chahiye|required|not (mentioned|quoted|there)|number|no\.?|quote|expired|galat|wrong)\b|\b(without|bina)\b.{0,10}\b(po|purchase order)\b/,
  format: /\b(invoice|bill)\b.{0,20}\b(format|template)\b|\bformat\b.{0,15}\b(galat|wrong|reject|sahi nahi)\b/,
  docs: /\b(e-?way ?bill|delivery challan|challan|grn|hsn|lr copy|pod|proof of delivery|signed copy|msme certificate|tax invoice copy|original invoice|hard copy|coc|certificate of analysis|coa)\b/,
  invoiceRejected: /\b(invoice|bill)\b.{0,20}\b(reject|rejected|galat|wrong|incorrect|return kar)\b|\breject kar (raha|rahe|diya)\b|\baccounts? (ne )?reject\b/,
  address: /\b(address|pata)\b.{0,15}\b(galat|wrong|incorrect)\b/,
  dispute: /\b(damage|damaged|defect|defective|kharab|toota|tuta|broken|leak|leakage|quality (issue|problem|kharab)|short supply|short qty|short quantity|kam (maal|aaya|aya|supply|qty)|quantity (issue|kam|short|less)|rate (galat|wrong|zyada|jyada|mismatch|difference|issue)|price (mismatch|wrong|difference|issue)|not as per (order|sample|spec)|return (kar|karenge|kiya)|debit note|dispute|disputed|rejected (maal|goods|boxes|cartons|material|lot))\b|\b\d+\s*(boxes|cartons|pcs|pieces|units|rolls)\b.{0,20}\b(reject|damage|damaged|kharab|short|return)/,
  ambiguousHold: /\b(mismatch|park|parked|parking|on hold|hold (par|pe|kiya)|query (hai|raised|aayi)|issue hai|problem hai|clarification|discrepancy)\b/,
  paymentClaim: /\b(already paid|paid (already|on|via|by|last)|payment (kar|ho) (di|diya|gaya|gayi|chuka|chuke)|payment done|payment (is |has been )?(made|sent|released|processed)|we have paid|have paid|bhej (diya|chuke|di|dia)|transfer (kar diya|ho gaya|done|kiya)|transferred|neft (kiya|done|kar diya|ho gaya)|rtgs (kiya|done|kar diya)|utr|cheque (de diya|diya|bheja|handed|given|deposit)|cash (de diya|diya|mein diya|paid))\b/,
  tds: /\btds\b/,
  cash: /\b(cash crunch|cash flow|cashflow|funds? (tight|nahi|nhi|issue|short|problem|crunch)|paisa nahi|paise nahi|paisa tight|liquidity|part payment|part-payment|partial payment|installment|instalment|kisht|kishton|thoda thoda|split (kar|payment|karke)|in parts|tukdon)\b/,
  futureVerb: /\b(kar denge|kar dunga|kar doonga|kar dege|kar dengey|denge|dunga|doonga|dege|karenge|karunga|bhejenge|bhej denge|bhej dunga|clear karenge|clear kar denge|release karenge|release kar denge|ho jayega|hojayega|ho jaega|ho jaayega|hoga|will (pay|clear|release|transfer|process|send|make)|shall (pay|release)|going to (pay|release)|pay (by|on)|payment (by|on))\b/,
  ack: /^(ok|okay|k|noted|sure|thik hai|theek hai|haan|ha|ji|yes|received|acknowledged|thanks|thank you)[.! ]*$/,
  check: /\b(check (kar|karke|karta|karti|karenge|with)|will check|checking|dekhta|dekhte|dekh ke|looking into|let me check|forgot|bhool gaya|bhool gaye|missed it|sorry for the delay)\b/,
};

function norm(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/\bglt\b|\bgalath\b|\bghalat\b/g, "galat")
    .replace(/\bkr\b/g, "kar")
    .replace(/\bdnge\b|\bdenga\b/g, "denge")
    .replace(/\bbaad\b|\bbad\b/g, "baad")
    .replace(/\s+/g, " ")
    .trim();
}

function paperworkKind(t: string): CaseUnderstanding["entities"]["blockerKind"] | undefined {
  if (RE.gstin.test(t)) return "GSTIN";
  if (RE.poProblem.test(t)) return "PO";
  if (RE.format.test(t)) return "INVOICE_FORMAT";
  if (RE.docs.test(t) || RE.address.test(t)) return "SUPPORTING_DOC";
  if (RE.invoiceRejected.test(t)) return "INVOICE_FORMAT";
  return undefined;
}

function docsMentioned(t: string): string[] {
  const out: string[] = [];
  const m = t.match(RE.docs);
  if (m) out.push(m[0]);
  if (RE.gstin.test(t)) out.push("GSTIN");
  if (RE.po.test(t)) out.push("PO");
  return out;
}

function result(
  input: ClassifierInput,
  proposedState: InvoiceState,
  confidenceBand: "HIGH" | "NEEDS_REVIEW",
  conciseExplanation: string,
  extra: Partial<Pick<CaseUnderstanding, "extractedAmounts" | "temporalExpressions" | "entities" | "evidenceUsed">> = {},
): CaseUnderstanding {
  return {
    proposedState,
    confidenceBand,
    extractedAmounts: extra.extractedAmounts ?? [],
    temporalExpressions: extra.temporalExpressions ?? [],
    entities: extra.entities ?? {},
    evidenceUsed: extra.evidenceUsed ?? [input.primaryEvidence.id],
    conciseExplanation,
    provider: DEMO_CLASSIFIER_VERSION,
  };
}

function describeDate(t: TemporalExpression): string {
  if (t.normalizedDate) return formatDate(t.normalizedDate);
  if (t.type === "AFTER_DATE" && t.lowerBound) return `after ${formatDate(t.lowerBound)}`;
  if (t.upperBound) return `by ${formatDate(t.upperBound)}`;
  return `"${t.rawText}"`;
}

export function classifyDemo(input: ClassifierInput): CaseUnderstanding {
  const primary = input.primaryEvidence;
  const outstanding = input.invoice.outstandingAmount;
  const imsList = [primary, ...input.supportingEvidence].filter((e) => e.type === "IMS_IMPORT");
  const imsRejected = imsList.find((e) => /reject/i.test(e.text));

  // IMS alone (no buyer statement): corroborating evidence only — never proof that payment is withheld.
  if (primary.type === "IMS_IMPORT") {
    if (imsRejected) {
      return result(
        input,
        "NEEDS_REVIEW",
        "NEEDS_REVIEW",
        `Imported IMS export shows the buyer rejected this invoice (${imsRejected.text.replace(/^.*?(remark|Remark)\s*:?\s*/, "remark: ")}). The buyer has not said this is holding payment.`,
        { entities: { blockerKind: "UNKNOWN", alternativeStates: ["PAPERWORK_BLOCKED", "FOLLOW_UP_ACTIVE"] } },
      );
    }
    return result(input, "FOLLOW_UP_ACTIVE", "HIGH", "Imported IMS export shows no rejection. No blocker found.");
  }

  const t = norm(primary.text);
  const temporal = extractTemporalExpressions(primary.text, primary.timestamp);
  let amounts: ExtractedAmount[] = withDerivedRemainder(extractAmounts(primary.text, outstanding), t, outstanding);
  const evidenceUsed = [primary.id];

  const paper = paperworkKind(t);
  const poMismatch = /\b(po|purchase order)\b.{0,20}\bmismatch\b|\bmismatch\b.{0,20}\b(po|purchase order)\b/.test(t);
  const dispute = RE.dispute.test(t);
  const hold = RE.ambiguousHold.test(t);
  const future = RE.futureVerb.test(t);
  const claim = RE.paymentClaim.test(t) && !future;
  const tds = RE.tds.test(t);
  const cashWords = RE.cash.test(t);
  const immediate = amounts.find((a) => a.role === "IMMEDIATE");
  const remainderMention = /\b(baaki|baki|balance|remaining|rest|remainder)\b/.test(t);
  const splitRequest = Boolean(immediate) && remainderMention;
  const firmDate = temporal.find((x) => x.confidenceBand === "HIGH" && x.type !== "AFTER_DATE" && x.type !== "AMBIGUOUS" && !(x.normalizedDate && x.normalizedDate < istDate(primary.timestamp)));
  const anyDate = temporal.length > 0;

  // 1. Mixed paperwork / dispute language — the classic ambiguous case.
  if (poMismatch || (paper && dispute) || (hold && !paper && !dispute && !claim && !cashWords)) {
    return result(
      input,
      "NEEDS_REVIEW",
      "NEEDS_REVIEW",
      poMismatch
        ? "Buyer says the invoice is on hold due to a PO mismatch. This could be a paperwork problem or a quantity/rate dispute."
        : paper && dispute
          ? "Buyer mentions both a document problem and a problem with the goods or price. The blocker is unclear."
          : "Buyer says the invoice is on hold but does not say why.",
      {
        extractedAmounts: amounts,
        temporalExpressions: temporal,
        entities: { blockerKind: "UNKNOWN", alternativeStates: ["PAPERWORK_BLOCKED", "COMMERCIAL_DISPUTE"], documents: docsMentioned(t) },
        evidenceUsed,
      },
    );
  }

  // 2. TDS short payment — a future flow; route to review.
  if (tds) {
    return result(
      input,
      "NEEDS_REVIEW",
      "NEEDS_REVIEW",
      "Buyer says payment was made net of TDS. The short payment needs reconciliation against the TDS certificate.",
      { extractedAmounts: amounts, temporalExpressions: temporal, entities: { blockerKind: "TDS", paymentClaimed: true, alternativeStates: ["PAID_UNMATCHED"] }, evidenceUsed },
    );
  }

  // 3. Payment claim — the classifier may only REPORT the claim; bank matching decides.
  if (claim) {
    return result(input, "PAID_UNMATCHED", "HIGH", "Buyer says the payment has already been made.", {
      extractedAmounts: amounts.map((a) => (a.role === "UNSPECIFIED" ? { ...a, role: "PAID" } : a)),
      temporalExpressions: temporal,
      entities: { blockerKind: "PAYMENT_CLAIM", paymentClaimed: true },
      evidenceUsed,
    });
  }

  // 4. Commercial dispute.
  if (dispute) {
    amounts = extractAmounts(primary.text, outstanding)
      .filter((a) => !a.rawText.includes("derived"))
      .map((a) => (a.role === "REMAINDER" ? { ...a, role: "UNDISPUTED" as const } : a));
    amounts = withDerivedRemainder(amounts, "", outstanding);
    const disputed = amounts.find((a) => a.role === "DISPUTED");
    return result(
      input,
      "COMMERCIAL_DISPUTE",
      "HIGH",
      disputed
        ? `Buyer disputes ${formatINR(disputed.amount)} of the invoice (goods or price) and indicates the rest is not disputed.`
        : "Buyer disputes the goods or price on this invoice.",
      { extractedAmounts: amounts, temporalExpressions: temporal, entities: { blockerKind: /rate|price/.test(t) ? "RATE" : /short|kam|quantity/.test(t) ? "QUANTITY" : "QUALITY" }, evidenceUsed },
    );
  }

  // 5. Paperwork blocker.
  if (paper) {
    const corroborated = imsRejected && (paper !== "GSTIN" || /gstin|gst/i.test(imsRejected.text));
    if (corroborated) evidenceUsed.push(imsRejected.id);
    const what: Record<string, string> = {
      GSTIN: "the GSTIN is incorrect",
      PO: "the PO reference is missing or wrong",
      INVOICE_FORMAT: "the invoice format was rejected",
      SUPPORTING_DOC: `a supporting document is missing (${docsMentioned(t)[0] ?? "document"})`,
    };
    return result(
      input,
      "PAPERWORK_BLOCKED",
      "HIGH",
      `Buyer states the invoice cannot be processed because ${what[paper] ?? "of a document problem"}.${corroborated ? " Imported IMS evidence contains the same reason." : ""}`,
      { extractedAmounts: amounts, temporalExpressions: temporal, entities: { blockerKind: paper, documents: docsMentioned(t) }, evidenceUsed },
    );
  }

  // 6. Cash constraint: a split / extension request.
  if (splitRequest || cashWords) {
    const remainderDate = temporal.find((x) => x.rawText !== immediate?.rawText && !["aaj", "aj", "abhi", "today"].includes(x.rawText));
    const precise = Boolean(immediate) && remainderMention && remainderDate && remainderDate.confidenceBand === "HIGH";
    if (precise) {
      return result(
        input,
        "CASH_CONSTRAINED",
        "HIGH",
        `Buyer offers ${formatINR(immediate!.amount)} now and the remaining ${formatINR(outstanding - immediate!.amount)} ${describeDate(remainderDate!)}.`,
        { extractedAmounts: amounts, temporalExpressions: temporal, entities: { blockerKind: "CASH_FLOW" }, evidenceUsed },
      );
    }
    return result(
      input,
      "NEEDS_REVIEW",
      "NEEDS_REVIEW",
      immediate
        ? `Buyer offers ${formatINR(immediate.amount)} now but gives no clear date for the rest.`
        : "Buyer indicates a cash constraint but does not propose amounts and dates.",
      { extractedAmounts: amounts, temporalExpressions: temporal, entities: { blockerKind: "CASH_FLOW", alternativeStates: ["CASH_CONSTRAINED", "PROMISE_TO_PAY"] }, evidenceUsed },
    );
  }

  // 7. Promise to pay.
  if (future || anyDate) {
    const after = temporal.find((x) => x.type === "AFTER_DATE");
    if (firmDate && !after) {
      return result(input, "PROMISE_TO_PAY", "HIGH", `Buyer promises payment by ${describeDate(firmDate)}.`, {
        extractedAmounts: amounts,
        temporalExpressions: temporal,
        entities: {},
        evidenceUsed,
      });
    }
    if (after) {
      return result(
        input,
        "NEEDS_REVIEW",
        "NEEDS_REVIEW",
        `Buyer indicates payment ${describeDate(after)}. This is not an exact promise date — confirm a date or treat it as an extension request.`,
        { extractedAmounts: amounts, temporalExpressions: temporal, entities: { alternativeStates: ["PROMISE_TO_PAY", "CASH_CONSTRAINED"] }, evidenceUsed },
      );
    }
    if (anyDate) {
      return result(
        input,
        "NEEDS_REVIEW",
        "NEEDS_REVIEW",
        `Buyer mentions a time ("${temporal[0].rawText}") that cannot be resolved to a safe promise date.`,
        { extractedAmounts: amounts, temporalExpressions: temporal, entities: { alternativeStates: ["PROMISE_TO_PAY"] }, evidenceUsed },
      );
    }
    return result(input, "FOLLOW_UP_ACTIVE", "HIGH", "Buyer says they will pay but gives no date. Standard follow-up continues.", {
      extractedAmounts: amounts,
      temporalExpressions: temporal,
      evidenceUsed,
    });
  }

  // 8. Acknowledgement / checking / forgot — no blocker.
  if (RE.ack.test(t) || RE.check.test(t) || t.length === 0) {
    return result(input, "FOLLOW_UP_ACTIVE", "HIGH", "Buyer acknowledged the reminder without stating a blocker.", { evidenceUsed });
  }

  return result(input, "NEEDS_REVIEW", "NEEDS_REVIEW", "The reply does not match a known blocker pattern. A person should read it.", {
    extractedAmounts: amounts,
    temporalExpressions: temporal,
    entities: { blockerKind: "UNKNOWN" },
    evidenceUsed,
  });
}

export class DemoCaseClassifier implements SyncCaseClassifier {
  readonly id = DEMO_CLASSIFIER_VERSION;
  classifySync(input: ClassifierInput): CaseUnderstanding {
    return classifyDemo(input);
  }
  async classify(input: ClassifierInput): Promise<CaseUnderstanding> {
    return classifyDemo(input);
  }
}

export const demoClassifier = new DemoCaseClassifier();
