import { describe, expect, it } from "vitest";
import { buildInvoiceBook } from "@/data/synthetic/invoice-book";
import { computeWrongChaseReport } from "@/evaluation/wrong-chase";

describe("wrong-chase metric", () => {
  const r = computeWrongChaseReport();

  it("is internally consistent and computed from the book", () => {
    expect(r.M).toBe(r.rows.filter((x) => x.wrongChase).length);
    expect(r.N).toBe(r.rows.filter((x) => x.wrongChase && x.resolveBlocks).length);
    expect(r.misses.length).toBe(r.M - r.N);
    expect(r.totalInvoices).toBe(buildInvoiceBook().invoices.length);
  });

  it("is deliberately imperfect: some wrong chases are not observable", () => {
    expect(r.M).toBeGreaterThan(0);
    expect(r.N).toBeLessThan(r.M);
    expect(r.misses.some((m) => !m.signalObservable)).toBe(true);
    expect(r.misses.some((m) => /cash/i.test(m.truthNote))).toBe(true);
  });

  it("reports unnecessary pauses honestly", () => {
    expect(r.unnecessaryPauses.length).toBeGreaterThan(0);
  });

  it("is reproducible for the same seed", () => {
    const again = computeWrongChaseReport();
    expect({ M: again.M, N: again.N }).toEqual({ M: r.M, N: r.N });
    expect(JSON.stringify(buildInvoiceBook())).toBe(JSON.stringify(buildInvoiceBook()));
  });

  it("baseline does not chase invoices already reconciled in the ledger", () => {
    const kept = r.rows.find((x) => x.invoiceNumber === "SCP-1024")!;
    expect(kept.baselineChases).toBe(false);
    expect(kept.wrongChase).toBe(false);
  });
});
