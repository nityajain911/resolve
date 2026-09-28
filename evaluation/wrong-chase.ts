/**
 * HEADLINE PROTOTYPE METRIC: wrong chases avoided — computed, never hardcoded.
 *
 * Strict definition (do not change silently — see EVALUATION_PROTOCOL.md):
 *   A WRONG CHASE occurs when the reminder-only baseline would send a collection
 *   message on an invoice that ground truth shows is
 *     (a) already paid, or
 *     (b) in active commercial dispute.
 *
 *   Reminder-only baseline: sends the next standard reminder on every escalated
 *   invoice that still shows an outstanding balance in the merchant ledger
 *   (i.e. not reconciled as paid).
 *
 *   Resolve "blocks" a chase when its policy gate for SEND_REMINDER does not return
 *   ALLOW for a state/payment/exclusion reason at the evaluation snapshot. Blocks
 *   caused only by the reminder frequency cap do not count.
 *
 * Secondary metric (reported separately): AVOIDABLE FOLLOW-UP additionally counts
 * invoices whose true blocker is paperwork.
 *
 * This module is part of the evaluation harness and is the ONLY consumer of hidden
 * ground truth. Resolve's decisions come from createWorld() on the observable book.
 */
import { classifyDemo } from "@/ai/demo-classifier";
import { buildGroundTruth } from "@/data/synthetic/ground-truth";
import { buildInvoiceBook, DEFAULT_SEED } from "@/data/synthetic/invoice-book";
import { createWorld, reminderGate } from "@/domain/engine";
import { STATE_META } from "@/domain/state-machine";
import type { InvoiceState } from "@/domain/types";

export const WRONG_CHASE_DEFINITION =
  "A wrong chase is a collection message the reminder-only baseline would send on an invoice that ground truth shows is already paid or in active commercial dispute.";

export interface ChaseRow {
  invoiceId: string;
  invoiceNumber: string;
  buyer: string;
  outstanding: number;
  resolveState: InvoiceState;
  baselineChases: boolean;
  wrongChase: boolean;
  wrongReason?: "ALREADY_PAID" | "ACTIVE_DISPUTE";
  resolveBlocks: boolean;
  blockReasons: string[];
  truthNote: string;
  signalObservable: boolean;
  unnecessaryPause: boolean;
  avoidable: boolean;
}

export interface WrongChaseReport {
  seed: number;
  definition: string;
  snapshotAt: string;
  totalInvoices: number;
  baselineChases: number;
  M: number;
  N: number;
  misses: ChaseRow[];
  blocked: ChaseRow[];
  unnecessaryPauses: ChaseRow[];
  avoidable: { total: number; blocked: number };
  rows: ChaseRow[];
  classifier: string;
}

export function computeWrongChaseReport(seed = DEFAULT_SEED): WrongChaseReport {
  const book = buildInvoiceBook(seed);
  const truth = buildGroundTruth(seed);
  const world = createWorld(book, { classify: classifyDemo });

  const rows: ChaseRow[] = book.invoices.map((inv) => {
    const c = world.cases[inv.id];
    const t = truth[inv.id];
    const baselineChases = c.outstandingAmount > 0; // ledger still shows it open
    const paid = t.actuallyPaid && !t.reconciledInLedger;
    const disputed = t.activeCommercialDispute;
    const wrongChase = baselineChases && (paid || disputed);
    const gate = reminderGate(world, c);
    const blockReasons = gate.reasonCodes.filter((r) => r !== "REMINDER_FREQUENCY_CAP" && r !== "ALL_CHECKS_PASSED");
    const resolveBlocks = gate.decision !== "ALLOW" && blockReasons.length > 0;
    return {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      buyer: c.buyerContext.name,
      outstanding: c.outstandingAmount,
      resolveState: c.currentState,
      baselineChases,
      wrongChase,
      wrongReason: wrongChase ? (paid ? "ALREADY_PAID" : "ACTIVE_DISPUTE") : undefined,
      resolveBlocks,
      blockReasons,
      truthNote: t.note,
      signalObservable: t.signalObservable,
      unnecessaryPause: baselineChases && resolveBlocks && t.trueBlocker === "NONE" && !t.actuallyPaid,
      avoidable: baselineChases && (paid || disputed || t.trueBlocker === "PAPERWORK"),
    };
  });

  const wrong = rows.filter((r) => r.wrongChase);
  return {
    seed,
    definition: WRONG_CHASE_DEFINITION,
    snapshotAt: world.clock,
    totalInvoices: rows.length,
    baselineChases: rows.filter((r) => r.baselineChases).length,
    M: wrong.length,
    N: wrong.filter((r) => r.resolveBlocks).length,
    misses: wrong.filter((r) => !r.resolveBlocks),
    blocked: wrong.filter((r) => r.resolveBlocks),
    unnecessaryPauses: rows.filter((r) => r.unnecessaryPause),
    avoidable: {
      total: rows.filter((r) => r.avoidable).length,
      blocked: rows.filter((r) => r.avoidable && r.resolveBlocks).length,
    },
    rows,
    classifier: "demo-lexicon-v1 (deterministic; developed alongside these synthetic messages)",
  };
}

export function describeState(s: InvoiceState): string {
  return STATE_META[s].label;
}
