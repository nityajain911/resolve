import type {
  BankCreditData,
  BuyerContext,
  Evidence,
  InvoiceData,
  ReceivablesHandoff,
} from "./types";

/**
 * The OBSERVABLE invoice book handed to Resolve. This is everything a real
 * deployment could see: invoices, reminder history, captured buyer messages,
 * imported bank statements, imported IMS exports and payment events.
 *
 * Hidden ground truth (why an invoice is really unpaid) is NOT part of this type
 * and lives only in data/synthetic/ground-truth.ts for the evaluation harness.
 */
export type BookEvidence = Omit<Evidence, "id" | "invoiceId">;

export interface BookInvoice {
  id: string;
  invoiceNumber: string;
  buyerId: string;
  amount: number;
  issuedAt: string;
  dueAt: string;
  handoff: ReceivablesHandoff;
  invoiceData: InvoiceData;
  evidence: BookEvidence[];
  isDemoHero?: boolean;
  demoLabel?: string;
}

export interface BookBankCredit {
  id: string;
  source: string;
  data: BankCreditData;
}

export interface ObservableInvoiceBook {
  seed: number;
  merchantId: string;
  merchantName: string;
  /** When the simulated Receivables Agent handed these invoices to Resolve. */
  handoffAt: string;
  /** Demo clock at the start of the walkthrough. */
  demoStartAt: string;
  buyers: BuyerContext[];
  invoices: BookInvoice[];
  bankFeed: BookBankCredit[];
}
