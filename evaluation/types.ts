import type { ConfidenceBand, EvidenceType, InvoiceState, TemporalType } from "@/domain/types";

export const TEMPORAL_CATEGORIES = [
  "WEEKDAY",
  "TOMORROW_KAL",
  "PARSO",
  "AFTER_15TH",
  "NEXT_FRIDAY",
  "MONTH_BOUNDARY",
  "WEEKEND_BOUNDARY",
  "EXPLICIT_DATE",
  "VAGUE",
] as const;
export type TemporalCategory = (typeof TEMPORAL_CATEGORIES)[number];

export interface ExpectedTemporal {
  type: TemporalType;
  normalizedDate?: string;
  lowerBound?: string;
  upperBound?: string;
  confidenceBand?: ConfidenceBand;
}

/** Schema shared by development-cases.json and heldout-cases.json. */
export interface HeldoutCase {
  id: string;
  message: string;
  messageTimestamp: string; // ISO; relative dates resolve against this
  optionalSupportingEvidence?: { type: EvidenceType; text: string; timestamp?: string }[];
  expectedState: InvoiceState;
  expectedExtractedAmounts: number[];
  expectedTemporalExpression: ExpectedTemporal | null;
  expectedConfidenceBand?: ConfidenceBand;
  /** Needed for "50%", "baaki" etc. Defaults to ₹2,00,000. */
  invoiceOutstanding?: number;
  temporalCategory?: TemporalCategory;
  language?: "EN" | "HI" | "HINGLISH";
  notes: string;
}

export interface CaseFileMeta {
  set: "development" | "heldout" | "example";
  heldOut: boolean;
  authoredBy: string;
  authoredAt: string;
  /** The prompt version/hash that was frozen when these cases were authored. */
  promptVersionFrozen?: string;
  promptHashAtAuthoring?: string;
  warning?: string;
}

export interface CaseFile {
  meta: CaseFileMeta;
  cases: HeldoutCase[];
}
