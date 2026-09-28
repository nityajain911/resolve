import { classifyDemo } from "@/ai/demo-classifier";
import { buildInvoiceBook } from "@/data/synthetic/invoice-book";
import { createWorld } from "@/domain/engine";

export const ctx = { classify: classifyDemo };
export const HERO = {
  gst: "inv-scp-1057",
  cash: "inv-scp-1049",
  ptp: "inv-scp-1061",
  review: "inv-scp-1053",
  paid: "inv-scp-1042",
};
export function freshWorld() {
  return createWorld(buildInvoiceBook(), ctx);
}
