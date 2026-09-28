import { afterEach, describe, expect, it } from "vitest";
import { parseImsCsv } from "@/integrations/ims-import/parse";
import { createPartPaymentLink, razorpayConfig } from "@/integrations/razorpay/payment-links";

const req = { invoiceNumber: "SCP-1049", outstandingAmount: 265500, firstMinPartialAmount: 90000, customer: { name: "X", email: "ap@x.example", contact: "+919900000000" }, planId: "plan-1" };

describe("Razorpay adapter", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("falls back to a labelled simulated link without credentials", async () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    const link = await createPartPaymentLink(req);
    expect(link.mode).toBe("SIMULATED");
    expect(link.fallbackReason).toMatch(/not configured/);
    expect(link.firstMinPartialAmount).toBe(90000);
  });

  it("refuses live keys", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_live_abc";
    process.env.RAZORPAY_KEY_SECRET = "s";
    expect(razorpayConfig().mode).toBe("SIMULATED");
  });
});

describe("IMS CSV import", () => {
  it("parses rows and reports bad actions", () => {
    const csv = 'supplier_gstin,invoice_number,action,remark\n27AAKCS8841R1Z3,SCP-1057,Rejected,"Incorrect GSTIN"\n27AAKCS8841R1Z3,SCP-1001,Maybe,';
    const r = parseImsCsv(csv, "ims.csv");
    expect(r.rows).toEqual([{ gstinOfSupplier: "27AAKCS8841R1Z3", invoiceNumber: "SCP-1057", action: "REJECTED", remark: "Incorrect GSTIN", importedFile: "ims.csv" }]);
    expect(r.errors).toHaveLength(1);
  });
});
