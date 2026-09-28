/**
 * HIDDEN GROUND TRUTH for the synthetic invoice book.
 *
 * ONLY the evaluation harness (/evaluation) may import this module. Decision code
 * in /domain, /ai, /integrations and the app store must never read it — enforced
 * by tests/ground-truth-isolation.test.ts.
 */
import { DEFAULT_SEED, generateSyntheticBook, type GroundTruth } from "./generator";

export type { GroundTruth };

export function buildGroundTruth(seed = DEFAULT_SEED): Record<string, GroundTruth> {
  return Object.fromEntries(generateSyntheticBook(seed).hidden.map((g) => [g.invoiceId, g]));
}
