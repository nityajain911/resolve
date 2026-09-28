/**
 * Deterministic synthetic invoice book generator (fixed seed).
 *
 * Produces two SEPARATE outputs:
 *   - `book`   : ObservableInvoiceBook — what Resolve is allowed to see.
 *   - `hidden` : ground truth per invoice — ONLY for the evaluation harness.
 *
 * Do not import this module from /domain, /ai or /integrations (enforced by
 * tests/ground-truth-isolation.test.ts). Application code should import the
 * observable book via ./invoice-book.ts.
 *
 * The book is deliberately NOT designed for Resolve to look perfect: some
 * invoices were already paid or disputed without any observable signal.
 */
import type { BookBankCredit, BookEvidence, BookInvoice, ObservableInvoiceBook } from "@/domain/book";
import { formatINR } from "@/domain/money";
import { addDays, istDateTime } from "@/domain/time";
import type { BuyerContext, EvidenceType, ReminderRecord } from "@/domain/types";

export const DEFAULT_SEED = 20260921;

export type TrueBlocker =
  | "NONE"
  | "ALREADY_PAID"
  | "PAPERWORK"
  | "CASH_CONSTRAINT"
  | "PROMISE"
  | "COMMERCIAL_DISPUTE"
  | "TDS_SHORT_PAYMENT";

export interface GroundTruth {
  invoiceId: string;
  archetype: string;
  trueBlocker: TrueBlocker;
  /** Buyer had in fact paid (fully or net of TDS) before the evaluation snapshot. */
  actuallyPaid: boolean;
  /** Payment already reconciled in the merchant ledger (baseline would not chase). */
  reconciledInLedger: boolean;
  activeCommercialDispute: boolean;
  /** Is there ANY observable evidence that could reveal the truth? */
  signalObservable: boolean;
  note: string;
}

// ---------------------------------------------------------------------------

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HANDOFF_DATE = "2026-09-21"; // Monday
const HANDOFF_AT = istDateTime(HANDOFF_DATE, 9, 0);
const DEMO_START_AT = istDateTime("2026-09-25", 17, 30); // Friday

const MERCHANT = { id: "merchant-suvidha", name: "Suvidha Corrugated Packaging Pvt Ltd", gstin: "27AAKCS8841R1Z3" };

type BuyerSeed = Omit<BuyerContext, "promiseHistory" | "contact" | "relationshipSince"> & {
  promises?: [number, number, number];
};

const BUYERS: BuyerSeed[] = [
  { buyerId: "B01", name: "Kesarbagh Foods Pvt Ltd", gstin: "09AAHCK4521M1Z6", city: "Lucknow", aliases: ["KESARBAGH FOODS"] },
  { buyerId: "B02", name: "Nilgiri Crest Beverages Pvt Ltd", gstin: "33AADCN7310P1Z2", city: "Coimbatore", aliases: ["NILGIRI CREST BEV"] },
  { buyerId: "B03", name: "Vasundhara Home Care Ltd", gstin: "24AABCV6120K1Z8", city: "Ahmedabad", aliases: ["VASUNDHARA HOMECARE"], promises: [3, 3, 0] },
  { buyerId: "B04", name: "Meghdoot Pharma Packs Pvt Ltd", gstin: "27AAECM3399H1Z4", city: "Nashik", aliases: ["MEGHDOOT PHARMA"] },
  { buyerId: "B05", name: "Acme Consumer Goods Ltd", gstin: "27AAACA5518Q1Z1", city: "Pune", aliases: ["ACME CONSUMER GOODS LTD", "ACME CONSUMER"] },
  { buyerId: "B06", name: "Ranthambore Spices Pvt Ltd", gstin: "08AAFCR2044D1Z7", city: "Jaipur", aliases: ["RANTHAMBORE SPICE"] },
  { buyerId: "B07", name: "Coastline Seafood Exports", gstin: "32AAGFC8812B1Z5", city: "Kochi", aliases: ["COASTLINE SEAFOOD"] },
  { buyerId: "B08", name: "Pinecone Personal Care Pvt Ltd", gstin: "06AAICP4107E1Z3", city: "Gurugram", aliases: ["PINECONE PERSONAL CARE"] },
  { buyerId: "B09", name: "Sabarmati Agro Industries", gstin: "24AAHFS9031L1Z9", city: "Mehsana", aliases: ["SABARMATI AGRO"] },
  { buyerId: "B10", name: "Deccan Bakers Pvt Ltd", gstin: "36AADCD1180N1Z2", city: "Hyderabad", aliases: ["DECCAN BAKERS"] },
  { buyerId: "B11", name: "Lotus Leaf Organics", gstin: "29AAKFL5563C1Z6", city: "Bengaluru", aliases: ["LOTUS LEAF ORGANIC"] },
  { buyerId: "B12", name: "Brahmaputra Tea Co", gstin: "18AAFCB7742M1Z8", city: "Guwahati", aliases: ["BRAHMAPUTRA TEA"] },
  { buyerId: "B13", name: "Konkan Cashew Processors", gstin: "27AAJFK2256G1Z0", city: "Ratnagiri", aliases: ["KONKAN CASHEW"] },
  { buyerId: "B14", name: "Aravalli Electricals Pvt Ltd", gstin: "06AAECA6618F1Z5", city: "Manesar", aliases: ["ARAVALLI ELECTRICAL"], promises: [2, 5, 3] },
  { buyerId: "B15", name: "Suryoday Ayurveda Ltd", gstin: "23AAGCS3321J1Z1", city: "Indore", aliases: ["SURYODAY AYURVEDA"] },
  { buyerId: "B16", name: "Gomti Pickles & Preserves", gstin: "09AAQFG8870A1Z4", city: "Kanpur", aliases: ["GOMTI PICKLES"], promises: [1, 2, 1] },
  { buyerId: "B17", name: "Narmada Beverages Pvt Ltd", gstin: "23AAECN4419R1Z6", city: "Jabalpur", aliases: ["NARMADA BEVERAGES"] },
  { buyerId: "B18", name: "Kaziranga Honey Co", gstin: "18AAHFK1182P1Z3", city: "Jorhat", aliases: ["KAZIRANGA HONEY"], promises: [4, 4, 0] },
  { buyerId: "B19", name: "Himgiri Mineral Water", gstin: "02AADFH9953K1Z7", city: "Solan", aliases: ["HIMGIRI MINERAL"] },
  { buyerId: "B20", name: "Malabar Coffee Works", gstin: "32AAFCM2277H1Z9", city: "Kozhikode", aliases: ["MALABAR COFFEE"] },
  { buyerId: "B21", name: "Satpura Pet Foods Pvt Ltd", gstin: "27AAHCS6614B1Z2", city: "Nagpur", aliases: ["SATPURA PET FOODS"] },
  { buyerId: "B22", name: "Chambal Chemicals Ltd", gstin: "08AABCC7730E1Z6", city: "Kota", aliases: ["CHAMBAL CHEMICALS"], promises: [1, 3, 2] },
  { buyerId: "B23", name: "Tungabhadra Edible Oils", gstin: "29AAGFT4481D1Z0", city: "Hospet", aliases: ["TUNGABHADRA OILS"] },
  { buyerId: "B24", name: "Indus Valley Snacks Pvt Ltd", gstin: "03AAFCI5539M1Z5", city: "Ludhiana", aliases: ["INDUS VALLEY SNACKS"] },
  { buyerId: "B25", name: "Mahanadi Dairy Products", gstin: "21AAJFM8826Q1Z8", city: "Cuttack", aliases: ["MAHANADI DAIRY"] },
  { buyerId: "B26", name: "Pushkar Rose Products", gstin: "08AAKFP3308L1Z1", city: "Ajmer", aliases: ["PUSHKAR ROSE"] },
];

// ---------------------------------------------------------------------------

type Msg = {
  text: string;
  date: string;
  hh: number;
  mm: number;
  type?: EvidenceType;
  source?: string;
};

interface Spec {
  key: string;
  archetype: string;
  buyerId: string;
  invoiceNumber?: string;
  amount?: number;
  dueDate?: string;
  messages?: Msg[];
  ims?: { date: string; action: "REJECTED" | "ACCEPTED"; remark?: string };
  billedGstinOverride?: string;
  poNumber?: string | null;
  bankCredit?: { date: string; amount?: number; amountFactor?: number; payerName: string; reference: string };
  razorpayPayment?: { date: string; hh: number };
  hero?: string;
  truth: Omit<GroundTruth, "invoiceId" | "archetype">;
}

const SRC = {
  whatsapp: "WhatsApp reply (captured)",
  email: "Email reply",
  voice: "Voice note (transcribed)",
  screenshot: "Screenshot (OCR text)",
};

const T = (
  trueBlocker: TrueBlocker,
  note: string,
  o: Partial<Omit<GroundTruth, "invoiceId" | "archetype" | "trueBlocker" | "note">> = {},
): Spec["truth"] => ({
  trueBlocker,
  note,
  actuallyPaid: o.actuallyPaid ?? false,
  reconciledInLedger: o.reconciledInLedger ?? false,
  activeCommercialDispute: o.activeCommercialDispute ?? false,
  signalObservable: o.signalObservable ?? true,
});

const SPECS: Spec[] = [
  // ---------------- HERO DEMO CASES ----------------
  {
    key: "hero-gst",
    archetype: "PAPERWORK_WITH_IMS",
    buyerId: "B01",
    invoiceNumber: "SCP-1057",
    amount: 318600,
    dueDate: "2026-09-04",
    billedGstinOverride: "09AAHCK4521M1Z9",
    messages: [{ text: "GSTIN galat hai, accounts reject kar raha hai", date: "2026-09-22", hh: 11, mm: 42 }],
    ims: { date: "2026-09-23", action: "REJECTED", remark: "Incorrect GSTIN" },
    hero: "GST / document blocker",
    truth: T("PAPERWORK", "Invoice billed to a wrong GSTIN; buyer's AP rejected it."),
  },
  {
    key: "hero-cash",
    archetype: "CASH_SPLIT_CLEAR",
    buyerId: "B02",
    invoiceNumber: "SCP-1049",
    amount: 265500,
    dueDate: "2026-08-28",
    messages: [{ text: "₹90K aaj, baaki 15 ke baad", date: "2026-09-25", hh: 11, mm: 5 }],
    hero: "Cash constraint",
    truth: T("CASH_CONSTRAINT", "Buyer's receivables are delayed; can pay part now."),
  },
  {
    key: "hero-ptp",
    archetype: "PROMISE_RELATIVE_WEEKDAY",
    buyerId: "B03",
    invoiceNumber: "SCP-1061",
    amount: 184080,
    dueDate: "2026-09-10",
    messages: [{ text: "Monday tak kar denge", date: "2026-09-24", hh: 15, mm: 10 }],
    hero: "Promise to pay",
    truth: T("PROMISE", "Payment run slipped; buyer intends to pay but the date is uncertain."),
  },
  {
    key: "hero-review",
    archetype: "MIXED_PO_MISMATCH",
    buyerId: "B04",
    invoiceNumber: "SCP-1053",
    amount: 142300,
    dueDate: "2026-09-01",
    messages: [{ text: "Accounts ne park kiya, PO mismatch", date: "2026-09-23", hh: 16, mm: 20 }],
    hero: "Mixed signal → Needs review",
    truth: T("COMMERCIAL_DISPUTE", "Delivered quantity was below PO quantity; buyer disputes the billed quantity.", {
      activeCommercialDispute: true,
    }),
  },
  {
    key: "hero-paid",
    archetype: "PAID_UNMATCHED_CLEAR",
    buyerId: "B05",
    invoiceNumber: "SCP-1042",
    amount: 240000,
    dueDate: "2026-08-25",
    bankCredit: { date: "2026-09-22", payerName: "ACME CONSUMER GOODS LTD", reference: "NEFT/ACMECG/SCP1042" },
    hero: "Paid but unmatched",
    truth: T("ALREADY_PAID", "Paid by NEFT; accounts had not reconciled the credit.", { actuallyPaid: true }),
  },

  // ---------------- PAID, VISIBLE SIGNAL ----------------
  {
    key: "paid-name",
    archetype: "PAID_UNMATCHED_CLEAR",
    buyerId: "B06",
    bankCredit: { date: "2026-09-18", payerName: "RANTHAMBORE SPICES PVT LTD", reference: "RTGS-RSPL-SEP" },
    truth: T("ALREADY_PAID", "Paid by RTGS without invoice reference.", { actuallyPaid: true }),
  },
  {
    key: "paid-ref",
    archetype: "PAID_UNMATCHED_CLEAR",
    buyerId: "B07",
    bankCredit: { date: "2026-09-23", payerName: "CSE EXPORTS A/C", reference: "__INV__ PAYMENT" },
    truth: T("ALREADY_PAID", "Paid from an unfamiliar account name, with the invoice number in the narration.", { actuallyPaid: true }),
  },
  {
    key: "paid-name-2",
    archetype: "PAID_UNMATCHED_CLEAR",
    buyerId: "B08",
    bankCredit: { date: "2026-09-24", payerName: "PINECONE PERSONAL CARE", reference: "IMPS 4471 VENDOR PAY" },
    truth: T("ALREADY_PAID", "Paid by IMPS; not yet reconciled.", { actuallyPaid: true }),
  },
  {
    key: "paid-screenshot",
    archetype: "PAID_CLAIM_NO_FEED",
    buyerId: "B11",
    messages: [
      {
        text: "[Screenshot] NEFT transaction successful. Beneficiary: Suvidha Corrugated. UTR: HDFCN52026091899. Status: Completed",
        date: "2026-09-22",
        hh: 13,
        mm: 2,
        type: "SCREENSHOT_TEXT",
        source: SRC.screenshot,
      },
    ],
    truth: T("ALREADY_PAID", "Paid; credit falls after the last imported bank statement.", { actuallyPaid: true }),
  },
  {
    key: "paid-tds",
    archetype: "TDS_SHORT_PAYMENT",
    buyerId: "B12",
    messages: [{ text: "TDS kaat ke payment bheja hai, certificate next quarter milega", date: "2026-09-21", hh: 17, mm: 40 }],
    bankCredit: { date: "2026-09-21", amountFactor: 0.98, payerName: "BRAHMAPUTRA TEA CO", reference: "NEFT BTC VENDOR" },
    truth: T("TDS_SHORT_PAYMENT", "Paid net of 2% TDS; merchant ledger still shows the gross amount open.", { actuallyPaid: true }),
  },

  // ---------------- PAID, NO USABLE SIGNAL (expected misses) ----------------
  {
    key: "paid-parent",
    archetype: "PAID_BY_PARENT_NET",
    buyerId: "B09",
    bankCredit: { date: "2026-09-17", amountFactor: 0.98, payerName: "SABARMATI HOLDINGS PVT LTD", reference: "NEFT SHPL GROUP PAY" },
    truth: T(
      "ALREADY_PAID",
      "Paid by the buyer's parent entity net of TDS with no invoice reference. The matching rule needs an exact amount and a known payer or invoice reference.",
      { actuallyPaid: true },
    ),
  },
  {
    key: "paid-cash",
    archetype: "PAID_CASH_INVISIBLE",
    buyerId: "B13",
    truth: T("ALREADY_PAID", "Buyer had already paid in cash at the merchant's office, but no observable payment signal existed.", {
      actuallyPaid: true,
      signalObservable: false,
    }),
  },
  {
    key: "paid-cheque",
    archetype: "PAID_CHEQUE_INVISIBLE",
    buyerId: "B15",
    truth: T("ALREADY_PAID", "Cheque handed to the sales rep; not yet deposited, so no bank or payment signal existed.", {
      actuallyPaid: true,
      signalObservable: false,
    }),
  },

  // ---------------- FALSE POSITIVE BANK MATCH ----------------
  {
    key: "fp-match",
    archetype: "SAME_AMOUNT_DIFFERENT_INVOICE",
    buyerId: "B10",
    amount: 112100,
    bankCredit: { date: "2026-09-19", amount: 112100, payerName: "DECCAN BAKERS PVT LTD", reference: "NEFT DBPL AUG ORDER" },
    truth: T("NONE", "Credit was for an earlier invoice (SCP-0978) of the same amount; this invoice is simply unpaid."),
  },

  // ---------------- PAPERWORK ----------------
  {
    key: "paper-po",
    archetype: "PAPERWORK_NO_IMS",
    buyerId: "B17",
    poNumber: null,
    messages: [{ text: "PO number invoice pe nahi hai, bina PO ke payment release nahi hoga", date: "2026-09-22", hh: 10, mm: 18 }],
    truth: T("PAPERWORK", "Invoice issued without the buyer's PO number."),
  },
  {
    key: "paper-challan",
    archetype: "PAPERWORK_NO_IMS",
    buyerId: "B19",
    messages: [
      {
        text: "Signed delivery challan ki copy chahiye, uske bina GRN nahi banega",
        date: "2026-09-23",
        hh: 12,
        mm: 30,
        type: "VOICE_NOTE_TRANSCRIPT",
        source: SRC.voice,
      },
    ],
    truth: T("PAPERWORK", "Buyer's stores need the signed challan to book the GRN."),
  },
  {
    key: "paper-format-ims",
    archetype: "PAPERWORK_WITH_IMS",
    buyerId: "B20",
    messages: [{ text: "Invoice format sahi nahi hai, humara vendor template use karo", date: "2026-09-21", hh: 15, mm: 5 }],
    ims: { date: "2026-09-22", action: "REJECTED", remark: "Invoice details mismatch" },
    truth: T("PAPERWORK", "Buyer requires its own invoice template."),
  },
  {
    key: "paper-email",
    archetype: "PAPERWORK_NO_IMS",
    buyerId: "B21",
    billedGstinOverride: "27AAHCS6614B1Z9",
    messages: [
      {
        text: "Our AP team rejected the invoice as the GST number is wrong. Please share a corrected invoice.",
        date: "2026-09-22",
        hh: 9,
        mm: 50,
        type: "BUYER_EMAIL",
        source: SRC.email,
      },
    ],
    truth: T("PAPERWORK", "Wrong GSTIN on invoice."),
  },
  {
    key: "paper-ims-only",
    archetype: "IMS_ONLY_REJECTION",
    buyerId: "B23",
    ims: { date: "2026-09-22", action: "REJECTED", remark: "HSN code mismatch" },
    truth: T("PAPERWORK", "HSN code on invoice did not match the buyer's item master."),
  },

  // ---------------- CASH CONSTRAINT ----------------
  {
    key: "cash-pct",
    archetype: "CASH_SPLIT_CLEAR",
    buyerId: "B24",
    messages: [{ text: "Funds tight hai. 50% abhi kar dete hain, baaki 10 Oct tak", date: "2026-09-22", hh: 18, mm: 12 }],
    truth: T("CASH_CONSTRAINT", "Seasonal working-capital squeeze."),
  },
  {
    key: "cash-vague",
    archetype: "CASH_AMBIGUOUS",
    buyerId: "B25",
    messages: [{ text: "Cash flow issue chal raha hai, ₹1 lakh this week and balance next month", date: "2026-09-23", hh: 11, mm: 0 }],
    truth: T("CASH_CONSTRAINT", "Cash constrained; no firm plan yet."),
  },
  {
    key: "cash-thoda",
    archetype: "CASH_AMBIGUOUS",
    buyerId: "B26",
    messages: [{ text: "Thoda thoda karke denge, abhi mushkil hai", date: "2026-09-24", hh: 19, mm: 45 }],
    truth: T("CASH_CONSTRAINT", "Cash constrained; wants installments."),
  },

  // ---------------- PROMISE TO PAY ----------------
  {
    key: "ptp-exact",
    archetype: "PROMISE_EXACT_DATE",
    buyerId: "B06",
    messages: [{ text: "30 Sept ko NEFT kar denge", date: "2026-09-23", hh: 14, mm: 25 }],
    truth: T("PROMISE", "Payment scheduled in the month-end run."),
  },
  {
    key: "ptp-parso",
    archetype: "PROMISE_RELATIVE_PARSO",
    buyerId: "B16",
    messages: [{ text: "parso kar dunga", date: "2026-09-24", hh: 18, mm: 0 }],
    truth: T("PROMISE", "Buyer intends to pay in two days."),
  },
  {
    key: "ptp-kal",
    archetype: "PROMISE_RELATIVE_KAL",
    buyerId: "B17",
    messages: [{ text: "kal afternoon tak transfer ho jayega", date: "2026-09-25", hh: 10, mm: 0 }],
    truth: T("PROMISE", "Transfer queued for the next day."),
  },
  {
    key: "ptp-next-friday",
    archetype: "PROMISE_AMBIGUOUS_NEXT_WEEKDAY",
    buyerId: "B20",
    messages: [{ text: "next Friday payment release karenge", date: "2026-09-22", hh: 16, mm: 40 }],
    truth: T("PROMISE", "Buyer meant 2 October (the following week's Friday)."),
  },
  {
    key: "ptp-after-15",
    archetype: "PROMISE_AFTER_DATE",
    buyerId: "B22",
    messages: [{ text: "15 ke baad clear karenge", date: "2026-09-21", hh: 12, mm: 15 }],
    truth: T("CASH_CONSTRAINT", "Buyer is waiting on its own customer receipts around the 15th."),
  },
  {
    key: "ptp-broken",
    archetype: "PROMISE_BROKEN",
    buyerId: "B16",
    messages: [{ text: "Monday ko pakka kar denge", date: "2026-09-18", hh: 17, mm: 30 }],
    truth: T("PROMISE", "Buyer promised Monday 21 Sep and did not pay."),
  },
  {
    key: "ptp-kept",
    archetype: "PROMISE_KEPT",
    buyerId: "B18",
    messages: [{ text: "Wednesday tak ho jayega", date: "2026-09-21", hh: 12, mm: 0 }],
    razorpayPayment: { date: "2026-09-23", hh: 14 },
    truth: T("PROMISE", "Buyer paid on the promised day via Razorpay.", { actuallyPaid: true, reconciledInLedger: true }),
  },

  // ---------------- COMMERCIAL DISPUTE ----------------
  {
    key: "dispute-damage",
    archetype: "DISPUTE_EXPLICIT",
    buyerId: "B14",
    messages: [{ text: "40 cartons damaged aaye the, debit note bhejenge", date: "2026-09-22", hh: 11, mm: 11 }],
    truth: T("COMMERCIAL_DISPUTE", "Transit damage on part of the consignment.", { activeCommercialDispute: true }),
  },
  {
    key: "dispute-split",
    archetype: "DISPUTE_PARTIAL",
    buyerId: "B07",
    amount: 200000,
    messages: [{ text: "₹50K ka maal damaged tha, baaki ₹1.5L release kar denge", date: "2026-09-24", hh: 12, mm: 48 }],
    truth: T("COMMERCIAL_DISPUTE", "₹50K of goods damaged; remainder undisputed.", { activeCommercialDispute: true }),
  },
  {
    key: "dispute-rate",
    archetype: "DISPUTE_EXPLICIT",
    buyerId: "B25",
    messages: [
      { text: "Rate galat lagaya hai, PO rate se ₹2 per box zyada hai", date: "2026-09-21", hh: 10, mm: 5, type: "BUYER_EMAIL", source: SRC.email },
    ],
    truth: T("COMMERCIAL_DISPUTE", "Invoice used the old rate card.", { activeCommercialDispute: true }),
  },
  {
    key: "dispute-silent",
    archetype: "DISPUTE_UNCAPTURED",
    buyerId: "B22",
    truth: T(
      "COMMERCIAL_DISPUTE",
      "Quality complaint was raised verbally with the sales rep and never reached any channel Resolve can see.",
      { activeCommercialDispute: true, signalObservable: false },
    ),
  },

  // ---------------- NO BLOCKER / FORGOTTEN ----------------
  { key: "forgot-1", archetype: "FORGOTTEN_NO_REPLY", buyerId: "B11", truth: T("NONE", "Invoice fell through the cracks in the buyer's AP.") },
  { key: "forgot-2", archetype: "FORGOTTEN_NO_REPLY", buyerId: "B13", truth: T("NONE", "No blocker; slow AP.") },
  { key: "forgot-3", archetype: "FORGOTTEN_NO_REPLY", buyerId: "B15", truth: T("NONE", "No blocker.") },
  { key: "forgot-4", archetype: "FORGOTTEN_NO_REPLY", buyerId: "B19", truth: T("NONE", "No blocker.") },
  { key: "forgot-5", archetype: "FORGOTTEN_NO_REPLY", buyerId: "B23", truth: T("NONE", "No blocker.") },
  {
    key: "forgot-ack",
    archetype: "FORGOTTEN_ACK",
    buyerId: "B24",
    messages: [{ text: "ok", date: "2026-09-22", hh: 9, mm: 12 }],
    truth: T("NONE", "Acknowledged, no blocker."),
  },
  {
    key: "forgot-check",
    archetype: "FORGOTTEN_ACK",
    buyerId: "B26",
    messages: [{ text: "Will check with accounts and revert", date: "2026-09-21", hh: 18, mm: 30, type: "BUYER_EMAIL", source: SRC.email }],
    truth: T("NONE", "No blocker; buyer had not looked at it."),
  },
  {
    key: "forgot-sorry",
    archetype: "FORGOTTEN_ACK",
    buyerId: "B21",
    messages: [{ text: "Sorry missed it, will process", date: "2026-09-23", hh: 20, mm: 5 }],
    truth: T("NONE", "Forgot; will pay in the next run."),
  },
  {
    key: "forgot-vague",
    archetype: "STALLING_VAGUE",
    buyerId: "B14",
    messages: [{ text: "payment jaldi kar denge", date: "2026-09-24", hh: 11, mm: 30 }],
    truth: T("NONE", "Stalling; no real blocker."),
  },
  { key: "chronic-1", archetype: "CHRONIC_LATE_PAYER", buyerId: "B14", truth: T("NONE", "Chronic late payer; no specific blocker.") },
  { key: "chronic-2", archetype: "CHRONIC_LATE_PAYER", buyerId: "B22", truth: T("NONE", "Chronic late payer; no specific blocker.") },
  { key: "forgot-6", archetype: "FORGOTTEN_NO_REPLY", buyerId: "B02", truth: T("NONE", "No blocker.") },
  { key: "forgot-7", archetype: "FORGOTTEN_NO_REPLY", buyerId: "B05", truth: T("NONE", "No blocker.") },
];

const NOISE_CREDITS = [
  { date: "2026-09-18", amount: 18500, payerName: "SCRAP BUYER KALYAN", reference: "CASH DEP SCRAP SALE" },
  { date: "2026-09-22", amount: 412000, payerName: "RELIANT PAPER TRADERS", reference: "RTGS ADV PAYMENT" },
  { date: "2026-09-24", amount: 7300, payerName: "INTEREST CREDIT", reference: "INT SB AC Q2" },
];

// ---------------------------------------------------------------------------

export function generateSyntheticBook(seed = DEFAULT_SEED): { book: ObservableInvoiceBook; hidden: GroundTruth[] } {
  const rnd = mulberry32(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

  const buyers: BuyerContext[] = BUYERS.map((b) => {
    const [kept, made, broken] = b.promises ?? [0, 0, 0];
    const slug = b.name.toLowerCase().replace(/[^a-z]+/g, "").slice(0, 14);
    return {
      buyerId: b.buyerId,
      name: b.name,
      gstin: b.gstin,
      city: b.city,
      aliases: b.aliases,
      relationshipSince: `20${int(17, 23)}-0${int(1, 9)}-01`,
      promiseHistory: { made, kept, broken },
      contact: { email: `ap@${slug}.example`, phone: `+9199${String(int(10000000, 99999999))}` },
    };
  });

  const invoices: BookInvoice[] = [];
  const hidden: GroundTruth[] = [];
  const bankFeed: BookBankCredit[] = [];
  const usedNumbers = new Set(SPECS.map((s) => s.invoiceNumber).filter(Boolean) as string[]);
  let nextNumber = 1001;

  SPECS.forEach((spec, i) => {
    let invoiceNumber = spec.invoiceNumber;
    while (!invoiceNumber) {
      const candidate = `SCP-${nextNumber++}`;
      if (!usedNumbers.has(candidate)) invoiceNumber = candidate;
    }
    usedNumbers.add(invoiceNumber);
    const id = `inv-${invoiceNumber.toLowerCase()}`;
    const amount = spec.amount ?? Math.round((int(38, 420) * 1000 * 1.18) / 100) * 100;
    const dueDate = spec.dueDate ?? addDays(HANDOFF_DATE, -int(12, 55));
    const creditDays = [30, 45, 60][int(0, 2)];
    const issueDate = addDays(dueDate, -creditDays);
    const buyer = buyers.find((b) => b.buyerId === spec.buyerId)!;

    // Reminder history from the (simulated) Receivables Agent: weekly, ending 3+ days before handoff.
    const chronic = spec.archetype === "CHRONIC_LATE_PAYER";
    const reminders: ReminderRecord[] = [];
    let d = addDays(dueDate, 1);
    const lastReminderDay = addDays(HANDOFF_DATE, -3);
    let n = 0;
    while (d <= lastReminderDay) {
      const channel = n % 3 === 2 ? "CALL" : n % 2 === 0 ? "WHATSAPP" : "EMAIL";
      reminders.push({
        at: istDateTime(d, int(9, 12), int(0, 59)),
        channel,
        outcome: channel === "CALL" ? ["No answer", "Asked to call back", "Said they would check"][int(0, 2)] : "Delivered, no payment",
      });
      d = addDays(d, chronic ? 5 : int(6, 9));
      n += 1;
    }
    if (reminders.length === 0) {
      reminders.push({ at: istDateTime(addDays(HANDOFF_DATE, -4), 10, 0), channel: "WHATSAPP", outcome: "Delivered, no payment" });
    }
    const calls = reminders.filter((r) => r.channel === "CALL").length;

    const evidence: BookEvidence[] = [];
    for (const m of spec.messages ?? []) {
      evidence.push({
        type: m.type ?? "BUYER_MESSAGE",
        timestamp: istDateTime(m.date, m.hh, m.mm),
        source: m.source ?? SRC.whatsapp,
        rawContent: m.text,
        isSynthetic: true,
      });
    }
    if (spec.ims) {
      const remark = spec.ims.remark ? ` · Remark: ${spec.ims.remark}` : "";
      evidence.push({
        type: "IMS_IMPORT",
        timestamp: istDateTime(spec.ims.date, 10, 15),
        source: "Imported IMS export (synthetic CSV)",
        rawContent: `IMS action by recipient: ${spec.ims.action === "REJECTED" ? "Rejected" : "Accepted"}${remark}`,
        attachmentName: `ims_export_${spec.ims.date.replace(/-/g, "")}_synthetic.csv`,
        structuredExtraction: {
          kind: "IMS_IMPORT",
          data: {
            gstinOfSupplier: MERCHANT.gstin,
            invoiceNumber,
            action: spec.ims.action,
            remark: spec.ims.remark,
            importedFile: `ims_export_${spec.ims.date.replace(/-/g, "")}_synthetic.csv`,
          },
        },
        isSynthetic: true,
      });
    }
    if (spec.razorpayPayment) {
      evidence.push({
        type: "PAYMENT_EVENT",
        timestamp: istDateTime(spec.razorpayPayment.date, spec.razorpayPayment.hh, 0),
        source: "Razorpay payment (synthetic event)",
        rawContent: `${formatINR(amount)} received via Razorpay against ${invoiceNumber}`,
        structuredExtraction: { kind: "PAYMENT_EVENT", data: { amount, channel: "RAZORPAY_PAYMENT", reference: invoiceNumber, reconciled: true } },
        isSynthetic: true,
      });
    }
    if (spec.bankCredit) {
      const bc = spec.bankCredit;
      const creditAmount = bc.amount ?? Math.round(amount * (bc.amountFactor ?? 1));
      bankFeed.push({
        id: `bank-${i}`,
        source: "Bank statement import (synthetic)",
        data: {
          amount: creditAmount,
          payerName: bc.payerName,
          reference: bc.reference.replace("__INV__", invoiceNumber),
          valueDate: istDateTime(bc.date, 11, int(0, 59)),
          bankTxnId: `UTR${seed % 1000}${String(int(100000, 999999))}`,
        },
      });
    }

    invoices.push({
      id,
      invoiceNumber,
      buyerId: spec.buyerId,
      amount,
      issuedAt: istDateTime(issueDate, 12, 0),
      dueAt: istDateTime(dueDate, 23, 59),
      handoff: {
        source: "SIMULATED_RECEIVABLES_AGENT",
        handedOffAt: HANDOFF_AT,
        remindersSent: reminders.length - calls,
        callsMade: calls,
        reminderHistory: reminders,
        reason: "Unpaid after standard reminders and calls",
      },
      invoiceData: {
        billedGstin: spec.billedGstinOverride ?? buyer.gstin,
        poNumber: spec.poNumber === null ? undefined : `PO/${buyer.buyerId}/${int(2200, 9800)}`,
        lineItems: [
          { description: "3-ply corrugated boxes (custom print)", qty: int(2000, 18000), rate: [11.5, 14, 17.25, 22][int(0, 3)] },
        ],
      },
      evidence: evidence.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
      isDemoHero: Boolean(spec.hero),
      demoLabel: spec.hero,
    });
    hidden.push({ invoiceId: id, archetype: spec.archetype, ...spec.truth });
  });

  NOISE_CREDITS.forEach((c, i) =>
    bankFeed.push({
      id: `bank-noise-${i}`,
      source: "Bank statement import (synthetic)",
      data: { amount: c.amount, payerName: c.payerName, reference: c.reference, valueDate: istDateTime(c.date, 15, 0), bankTxnId: `UTR${int(1000000, 9999999)}` },
    }),
  );

  return {
    book: {
      seed,
      merchantId: MERCHANT.id,
      merchantName: MERCHANT.name,
      handoffAt: HANDOFF_AT,
      demoStartAt: DEMO_START_AT,
      buyers,
      invoices,
      bankFeed,
    },
    hidden,
  };
}
