/**
 * IMS export import (CSV). IMS data is IMPORTED from a file the merchant downloads —
 * there is no live GST portal / IMS API integration. Imported rows only ever
 * corroborate buyer statements; a rejection alone never proves payment is withheld.
 *
 * Expected columns (case-insensitive): supplier_gstin, invoice_number, action, remark
 */
import type { ImsImportData } from "@/domain/types";

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (q && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else q = !q;
    } else if (ch === "," && !q) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export function parseImsCsv(csv: string, fileName: string): { rows: ImsImportData[]; errors: string[] } {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], errors: ["Empty file"] };
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase().replace(/\s+/g, "_"));
  const idx = (k: string) => header.indexOf(k);
  const need = ["supplier_gstin", "invoice_number", "action"];
  const missing = need.filter((k) => idx(k) < 0);
  if (missing.length) return { rows: [], errors: [`Missing columns: ${missing.join(", ")}`] };
  const rows: ImsImportData[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((l, i) => {
    const cells = splitCsvLine(l);
    const action = (cells[idx("action")] ?? "").toUpperCase();
    if (!["ACCEPTED", "REJECTED", "PENDING"].includes(action)) {
      errors.push(`Row ${i + 2}: unknown action "${cells[idx("action")]}"`);
      return;
    }
    rows.push({
      gstinOfSupplier: cells[idx("supplier_gstin")],
      invoiceNumber: cells[idx("invoice_number")],
      action: action as ImsImportData["action"],
      remark: idx("remark") >= 0 ? cells[idx("remark")] || undefined : undefined,
      importedFile: fileName,
    });
  });
  return { rows, errors };
}
