import { describe, expect, it } from "vitest";
import { extractTemporalExpressions } from "@/ai/temporal";
import { extractAmounts } from "@/ai/amounts";
import { istDateTime } from "@/domain/time";

const at = (d: string, hh = 11) => istDateTime(d, hh, 0);
const first = (text: string, ts: string) => extractTemporalExpressions(text, ts)[0];

describe("relative dates resolve against the MESSAGE timestamp", () => {
  it("Monday tak — from Thursday and from Friday", () => {
    expect(first("Monday tak kar denge", at("2026-09-24")).normalizedDate).toBe("2026-09-28");
    expect(first("Monday tak kar denge", at("2026-09-25")).normalizedDate).toBe("2026-09-28");
    // same text, older message → earlier Monday (device clock irrelevant)
    expect(first("Monday tak kar denge", at("2026-09-10")).normalizedDate).toBe("2026-09-14");
  });

  it("uses IST, not UTC, for the message date", () => {
    // 00:30 IST on Fri 25 Sep is still Thu 24 Sep in UTC
    const ts = istDateTime("2026-09-25", 0, 30);
    expect(first("kal kar denge", ts).normalizedDate).toBe("2026-09-26");
  });

  it("kal = tomorrow; past tense kal = yesterday", () => {
    expect(first("kal afternoon", at("2026-09-25")).normalizedDate).toBe("2026-09-26");
    expect(first("kal payment kar diya tha", at("2026-09-25")).normalizedDate).toBe("2026-09-24");
  });

  it("parso with future tense resolves forward; bare parso is ambiguous", () => {
    const p = first("parso kar dunga", at("2026-09-24"));
    expect(p.normalizedDate).toBe("2026-09-26");
    expect(p.confidenceBand).toBe("HIGH");
    const amb = first("parso", at("2026-09-24"));
    expect(amb.type).toBe("AMBIGUOUS");
    expect(amb.confidenceBand).toBe("NEEDS_REVIEW");
    expect(amb.normalizedDate).toBeUndefined();
  });

  it("15 ke baad is AFTER_DATE, rolling into next month when past", () => {
    const e = extractTemporalExpressions("₹90K aaj, baaki 15 ke baad", at("2026-09-25")).find((x) => x.type === "AFTER_DATE")!;
    expect(e.lowerBound).toBe("2026-10-15");
    expect(e.normalizedDate).toBeUndefined();
    expect(first("15 ke baad clear karenge", at("2026-09-10")).lowerBound).toBe("2026-09-15");
  });

  it("next Friday is ambiguous within the same week, precise across the week boundary", () => {
    expect(first("next Friday", at("2026-09-22")).type).toBe("AMBIGUOUS");
    expect(first("next Friday", at("2026-09-26")).normalizedDate).toBe("2026-10-02");
  });

  it("month, year and weekend boundaries", () => {
    expect(first("kal tak", at("2026-09-30")).normalizedDate).toBe("2026-10-01");
    expect(first("month end tak", at("2026-09-22")).normalizedDate).toBe("2026-09-30");
    expect(first("5 Jan tak", at("2026-12-26")).normalizedDate).toBe("2027-01-05");
    expect(first("31 tak", at("2026-09-21")).confidenceBand).toBe("NEEDS_REVIEW");
    expect(first("weekend tak kar denge", at("2026-09-23")).upperBound).toBe("2026-09-27");
  });
});

describe("amounts", () => {
  it("parses Indian formats and roles", () => {
    expect(extractAmounts("₹90K aaj, baaki 15 ke baad")).toEqual([{ rawText: "₹90k", amount: 90000, role: "IMMEDIATE" }]);
    expect(extractAmounts("1.5L release kar denge")[0].amount).toBe(150000);
    expect(extractAmounts("₹2,40,000 bheja")[0].amount).toBe(240000);
    expect(extractAmounts("50% abhi", 100000)[0].amount).toBe(50000);
    expect(extractAmounts("invoice SCP-1042 UTR 99812")).toEqual([]);
  });
});
