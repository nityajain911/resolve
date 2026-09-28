import type { CaseUnderstanding, EvidenceType } from "@/domain/types";

/**
 * CaseClassifier contract. Every provider (deterministic demo, live LLM) must
 * return the same CaseUnderstanding schema. A classifier only UNDERSTANDS the case;
 * it cannot change state or execute anything. The engine applies its output
 * through the state machine and the policy engine.
 */
export interface ClassifierEvidence {
  id: string;
  type: EvidenceType;
  text: string;
  timestamp: string; // ISO — relative dates resolve against THIS, not the device clock
}

export interface ClassifierInput {
  primaryEvidence: ClassifierEvidence;
  supportingEvidence: ClassifierEvidence[];
  invoice: {
    invoiceNumber: string;
    amount: number;
    outstandingAmount: number;
    dueAt: string;
  };
  buyerName: string;
}

export interface CaseClassifier {
  readonly id: string;
  classify(input: ClassifierInput): Promise<CaseUnderstanding>;
}

export interface SyncCaseClassifier extends CaseClassifier {
  classifySync(input: ClassifierInput): CaseUnderstanding;
}

export const CLASSIFIER_PROMPT_VERSION = "case-classifier-v1";
