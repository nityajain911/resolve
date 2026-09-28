/**
 * OBSERVABLE synthetic invoice book — the only synthetic export application code may use.
 * Hidden ground truth is stripped here and exposed solely via ./ground-truth.ts.
 */
import type { ObservableInvoiceBook } from "@/domain/book";
import { DEFAULT_SEED, generateSyntheticBook } from "./generator";

export { DEFAULT_SEED };

export function buildInvoiceBook(seed = DEFAULT_SEED): ObservableInvoiceBook {
  return structuredClone(generateSyntheticBook(seed).book);
}
