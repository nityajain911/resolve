import type { Evidence, InvoiceCase } from "./types";

/**
 * Split a partially disputed invoice WITHOUT giving one invoice two states.
 *
 * The parent keeps COMMERCIAL_DISPUTE with only the disputed amount outstanding.
 * A child receivable is created for the undisputed amount in FOLLOW_UP_ACTIVE,
 * linked via parentInvoiceId. Invariant: parent.outstanding + child.outstanding
 * equals the parent's outstanding before the split.
 */
export class SplitError extends Error {}

export function splitInvoice(
  parent: InvoiceCase,
  disputedAmount: number,
  ctx: { now: string; childId: string; noteEvidenceId: string; childEvidenceId: string; childTransitionId: string },
): { parent: InvoiceCase; child: InvoiceCase; note: Evidence } {
  if (parent.currentState !== "COMMERCIAL_DISPUTE") throw new SplitError("Only a disputed invoice can be split");
  if (parent.parentInvoiceId) throw new SplitError("A child receivable cannot be split again");
  if (!(disputedAmount > 0 && disputedAmount < parent.outstandingAmount)) {
    throw new SplitError("Disputed amount must be greater than zero and less than the outstanding amount");
  }
  const undisputed = parent.outstandingAmount - disputedAmount;
  const suffix = String.fromCharCode(65 + (parent.childInvoiceIds?.length ?? 0));

  const note: Evidence = {
    id: ctx.noteEvidenceId,
    invoiceId: parent.id,
    type: "MANUAL_NOTE",
    timestamp: ctx.now,
    source: "Resolve split (merchant-approved)",
    rawContent: `Split approved: ₹${disputedAmount} remains disputed on ${parent.invoiceNumber}; ₹${undisputed} moved to child receivable ${parent.invoiceNumber}-${suffix}.`,
    isSynthetic: false,
  };
  parent.evidence.push(note);
  parent.outstandingAmount = disputedAmount;
  parent.disputedAmount = disputedAmount;
  parent.childInvoiceIds = [...(parent.childInvoiceIds ?? []), ctx.childId];
  parent.updatedAt = ctx.now;

  const childEvidence: Evidence = { ...note, id: ctx.childEvidenceId, invoiceId: ctx.childId };
  const child: InvoiceCase = {
    ...structuredClone(parent),
    id: ctx.childId,
    invoiceNumber: `${parent.invoiceNumber}-${suffix}`,
    amount: undisputed,
    outstandingAmount: undisputed,
    currentState: "FOLLOW_UP_ACTIVE",
    stateEnteredAt: ctx.now,
    evidence: [childEvidence],
    transitions: [
      {
        id: ctx.childTransitionId,
        invoiceId: ctx.childId,
        fromState: null,
        toState: "FOLLOW_UP_ACTIVE",
        timestamp: ctx.now,
        triggerType: "SPLIT",
        evidenceIds: [childEvidence.id],
        initiatedBy: "MERCHANT",
        reasonCode: "UNDISPUTED_PORTION_SPLIT",
        humanReadableReason: `Undisputed portion split from ${parent.invoiceNumber}; standard follow-up applies.`,
      },
    ],
    parentInvoiceId: parent.id,
    childInvoiceIds: undefined,
    disputedAmount: undefined,
    promiseToPay: undefined,
    paymentPlan: undefined,
    workflow: { followUpPaused: false },
    understanding: undefined,
    reviewCandidates: undefined,
    isDemoHero: false,
    demoLabel: undefined,
    createdAt: ctx.now,
    updatedAt: ctx.now,
  };
  return { parent, child, note };
}
