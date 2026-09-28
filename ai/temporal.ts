/**
 * Temporal expression extraction for English + Hindi/Hinglish buyer replies.
 *
 * Every relative expression is resolved against the MESSAGE timestamp (in IST),
 * never the device clock. When context cannot resolve an expression safely, it is
 * returned with type AMBIGUOUS / confidenceBand NEEDS_REVIEW rather than a guess.
 *
 * Documented resolution rules (see EVALUATION_PROTOCOL.md):
 *  - "kal": tomorrow, unless past-tense markers are present (then yesterday).
 *  - "parso": day after tomorrow ONLY with an explicit future marker ("kar dunga",
 *    "denge", "tak", "will"); past markers → two days ago; otherwise AMBIGUOUS.
 *  - "<weekday>": next occurrence strictly after the message date. Same weekday as
 *    the message → AMBIGUOUS (today vs next week).
 *  - "next <weekday>": if the next occurrence falls in the same Mon–Sun week as the
 *    message, it could mean this week or the following → AMBIGUOUS. Otherwise HIGH.
 *  - "15 ke baad" / "after the 15th": AFTER_DATE with lowerBound = next 15th on or
 *    after the message date (rolls into the next month when already past).
 *  - "next week", "this week", "few days", "jaldi": imprecise → NEEDS_REVIEW.
 */
import type { TemporalExpression } from "@/domain/types";
import { addDays, daysBetween, istDate, lastDayOfMonth, weekdayOf } from "@/domain/time";

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10,
  nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const WEEKDAY_WORDS: [RegExp, number][] = [
  [/\b(sunday|ravivar|raviwar|itvaar|itwar)\b/, 0],
  [/\b(monday|mon|somvar|somwar|somvaar)\b/, 1],
  [/\b(tuesday|tues?|mangalvar|mangalwar|mangal)\b/, 2],
  [/\b(wednesday|budhvar|budhwar|budh)\b/, 3],
  [/\b(thursday|thurs?|guruvar|guruwar|brihaspativar)\b/, 4],
  [/\b(friday|fri|shukravar|shukrawar|shukra)\b/, 5],
  [/\b(saturday|shanivar|shaniwar|shani)\b/, 6],
];

const FUTURE_MARKERS =
  /\b(denge|dunga|doonga|dungi|dege|dengey|karenge|karunga|karungi|kar denge|kar dunga|bhejenge|bhejunga|bhej denge|bhej dunga|ho jayega|hojayega|ho jaega|hoga|clear karenge|release karenge|tak|will|shall|going to|by)\b/;
const PAST_MARKERS =
  /\b(kiya tha|kar diya|kar di|kardiya|bhej diya|bheja tha|bheja|bhej di|ho gaya|hogaya|ho gya|diya tha|tha|thi|paid|sent|transferred|was|did)\b/;

const AFTER_AFTER = /^\s*(ke|k|kay)?\s*(baad|bad)\b/;
const AFTER_BEFORE = /\b(after|post)\s+(the\s+)?$/;
const DEADLINE_AFTER = /^\s*(tak|se pehle|se pahle)\b/;
const DEADLINE_BEFORE = /\b(by|before|till|until|latest by)\s+(the\s+)?(this\s+|coming\s+)?$/;

interface Hit {
  start: number;
  end: number;
  expr: TemporalExpression;
}

function modifier(text: string, start: number, end: number): "AFTER" | "DEADLINE" | "ON" {
  const after = text.slice(end, end + 16);
  const before = text.slice(Math.max(0, start - 16), start);
  if (AFTER_AFTER.test(after) || AFTER_BEFORE.test(before)) return "AFTER";
  if (DEADLINE_AFTER.test(after) || DEADLINE_BEFORE.test(before)) return "DEADLINE";
  return "ON";
}

function withModifier(
  raw: string,
  date: string,
  mod: "AFTER" | "DEADLINE" | "ON",
  baseType: "EXACT_DATE" | "RELATIVE_DATE",
  note: string,
): TemporalExpression {
  if (mod === "AFTER") {
    return { rawText: raw, type: "AFTER_DATE", lowerBound: date, confidenceBand: "HIGH", resolutionNote: `After ${date} (no upper bound). ${note}` };
  }
  return { rawText: raw, type: baseType, normalizedDate: date, confidenceBand: "HIGH", resolutionNote: note };
}

/** Resolve a day-of-month to the next date on/after the message date. */
function resolveDayOfMonth(day: number, msgDate: string): { date: string; ambiguous: boolean; note: string } {
  const [y, m, d] = msgDate.split("-").map(Number);
  let year = y;
  let month = m;
  if (day < d) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  const candidate = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = Number(lastDayOfMonth(candidate).slice(8));
  if (day > last) {
    return { date: lastDayOfMonth(candidate), ambiguous: true, note: `Day ${day} does not exist in that month` };
  }
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return {
    date,
    ambiguous: day === d,
    note: day === d ? "Day equals the message date — today or next month is unclear" : month !== m ? "Rolled into the next month" : "This month",
  };
}

function resolveMonthDay(day: number, month: number, msgDate: string): string {
  const y = Number(msgDate.slice(0, 4));
  let date = `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  // A date well in the past most likely refers to next year.
  if (daysBetween(msgDate, date) < -60) date = `${y + 1}${date.slice(4)}`;
  return date;
}

function sameIsoWeek(a: string, b: string): boolean {
  const monday = (d: string) => addDays(d, -((weekdayOf(d) + 6) % 7));
  return monday(a) === monday(b);
}

export function extractTemporalExpressions(rawText: string, messageTimestamp: string): TemporalExpression[] {
  const text = rawText.toLowerCase().replace(/[’']/g, "").replace(/\s+/g, " ");
  const msgDate = istDate(messageTimestamp);
  const hits: Hit[] = [];
  const taken = (s: number, e: number) => hits.some((h) => s < h.end && e > h.start);
  const push = (start: number, end: number, expr: TemporalExpression) => {
    if (!taken(start, end)) hits.push({ start, end, expr });
  };
  const hasFuture = FUTURE_MARKERS.test(text);
  const hasPast = PAST_MARKERS.test(text) && !/\b(denge|dunga|karenge|will)\b/.test(text);

  let m: RegExpExecArray | null;

  // 1. Explicit day + month: "30 sept", "5th oct", "oct 5"
  const dm = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*${MONTH_RE}\\b`, "g");
  while ((m = dm.exec(text))) {
    const date = resolveMonthDay(Number(m[1]), MONTHS[m[2]], msgDate);
    push(m.index, m.index + m[0].length, withModifier(m[0], date, modifier(text, m.index, m.index + m[0].length), "EXACT_DATE", "Explicit date"));
  }
  const md = new RegExp(`\\b${MONTH_RE}\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b`, "g");
  while ((m = md.exec(text))) {
    const date = resolveMonthDay(Number(m[2]), MONTHS[m[1]], msgDate);
    push(m.index, m.index + m[0].length, withModifier(m[0], date, modifier(text, m.index, m.index + m[0].length), "EXACT_DATE", "Explicit date"));
  }
  // dd/mm or dd-mm (Indian order)
  const slash = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\b/g;
  while ((m = slash.exec(text))) {
    const day = Number(m[1]);
    const mon = Number(m[2]);
    if (mon < 1 || mon > 12 || day < 1 || day > 31) continue;
    let date = resolveMonthDay(day, mon, msgDate);
    if (m[3]) {
      const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
      date = `${yr}${date.slice(4)}`;
    }
    push(m.index, m.index + m[0].length, withModifier(m[0], date, modifier(text, m.index, m.index + m[0].length), "EXACT_DATE", "Explicit date (dd/mm)"));
  }

  // 2. Day of month with context: "15 ke baad", "after the 15th", "15 tak", "20 tareekh ko"
  const domAfter = /\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:tareekh|tarikh|tarik|date)?\s*(?=(?:ke|k|kay)?\s*(?:baad|bad)\b|tak\b|ko\b|se pehle\b)/g;
  while ((m = domAfter.exec(text))) {
    const day = Number(m[1]);
    if (day < 1 || day > 31) continue;
    const r = resolveDayOfMonth(day, msgDate);
    const start = m.index;
    const end = m.index + m[0].length;
    const mod = modifier(text, start, end);
    const raw = text.slice(start, end + (text.slice(end).match(/^\s*((?:ke|k|kay)?\s*(?:baad|bad)|tak|ko|se pehle)/)?.[0].length ?? 0)).trim();
    const e = withModifier(raw, r.date, mod, "EXACT_DATE", r.note);
    if (r.ambiguous) {
      e.confidenceBand = "NEEDS_REVIEW";
      if (e.type !== "AFTER_DATE") e.type = "AMBIGUOUS";
    }
    push(start, end, e);
  }
  const domEn = /\b(after|by|on|before|till)\s+(?:the\s+)?(\d{1,2})(st|nd|rd|th)\b/g;
  while ((m = domEn.exec(text))) {
    const r = resolveDayOfMonth(Number(m[2]), msgDate);
    const mod = m[1] === "after" ? "AFTER" : m[1] === "on" ? "ON" : "DEADLINE";
    const e = withModifier(m[0], r.date, mod, "EXACT_DATE", r.note);
    if (r.ambiguous) {
      e.confidenceBand = "NEEDS_REVIEW";
      if (e.type !== "AFTER_DATE") e.type = "AMBIGUOUS";
    }
    push(m.index, m.index + m[0].length, e);
  }

  // 3. Month end / weekend / week expressions
  const monthEnd = /\b(month[- ]end|end of (the )?month|mahine ke (end|aakhir|akhir)|month ke end)\b/.exec(text);
  if (monthEnd) {
    push(monthEnd.index, monthEnd.index + monthEnd[0].length, {
      rawText: monthEnd[0], type: "EXACT_DATE", normalizedDate: lastDayOfMonth(msgDate), confidenceBand: "HIGH", resolutionNote: "Last day of the message's month",
    });
  }
  const weekend = /\b(weekend|week end|saturday-sunday)\b/.exec(text);
  if (weekend) {
    const wd = weekdayOf(msgDate);
    const sunday = addDays(msgDate, (7 - wd) % 7);
    const saturday = addDays(sunday, -1);
    const mod = modifier(text, weekend.index, weekend.index + weekend[0].length);
    if (mod === "AFTER") {
      push(weekend.index, weekend.index + weekend[0].length, {
        rawText: weekend[0], type: "AFTER_DATE", lowerBound: sunday, confidenceBand: "HIGH", resolutionNote: "After the coming weekend",
      });
    } else {
      push(weekend.index, weekend.index + weekend[0].length, {
        rawText: weekend[0], type: "DATE_RANGE", lowerBound: wd === 0 ? msgDate : saturday, upperBound: sunday, confidenceBand: "HIGH", resolutionNote: "By the end of the coming weekend",
      });
    }
  }
  const nextWeek = /\b(next week|agle (hafte|week|hafta)|agla (hafta|week))\b/.exec(text);
  if (nextWeek) {
    const monday = addDays(msgDate, 7 - ((weekdayOf(msgDate) + 6) % 7));
    push(nextWeek.index, nextWeek.index + nextWeek[0].length, {
      rawText: nextWeek[0], type: "DATE_RANGE", lowerBound: monday, upperBound: addDays(monday, 6), confidenceBand: "NEEDS_REVIEW", resolutionNote: "A week-long window, not a date",
    });
  }
  const thisWeek = /\b(this week|is (hafte|week)|isi (hafte|week))\b/.exec(text);
  if (thisWeek) {
    const sunday = addDays(msgDate, (7 - weekdayOf(msgDate)) % 7);
    push(thisWeek.index, thisWeek.index + thisWeek[0].length, {
      rawText: thisWeek[0], type: "DATE_RANGE", lowerBound: msgDate, upperBound: sunday, confidenceBand: "NEEDS_REVIEW", resolutionNote: "Within this week — no specific day",
    });
  }
  const nextMonth = /\b(next month|agle (mahine|month))\b/.exec(text);
  if (nextMonth) {
    const first = addDays(lastDayOfMonth(msgDate), 1);
    push(nextMonth.index, nextMonth.index + nextMonth[0].length, {
      rawText: nextMonth[0], type: "DATE_RANGE", lowerBound: first, upperBound: lastDayOfMonth(first), confidenceBand: "NEEDS_REVIEW", resolutionNote: "A month-long window, not a date",
    });
  }
  const inDays = /\b(?:in|within)\s+(\d{1,2})\s+days?\b|\b(\d{1,2})\s+din\s+(?:mein|me|main)\b/.exec(text);
  if (inDays) {
    const n = Number(inDays[1] ?? inDays[2]);
    push(inDays.index, inDays.index + inDays[0].length, {
      rawText: inDays[0], type: "RELATIVE_DATE", normalizedDate: addDays(msgDate, n), confidenceBand: "HIGH", resolutionNote: `${n} days after the message date`,
    });
  }
  const vague = /\b(few days|kuch din|jaldi|soon|asap|shortly|jald hi|thode din)\b/.exec(text);
  if (vague) {
    push(vague.index, vague.index + vague[0].length, {
      rawText: vague[0], type: "AMBIGUOUS", confidenceBand: "NEEDS_REVIEW", resolutionNote: "No date can be derived",
    });
  }

  // 4. Relative days
  const dat = /\b(day after tomorrow)\b/.exec(text);
  if (dat) {
    push(dat.index, dat.index + dat[0].length, withModifier(dat[0], addDays(msgDate, 2), modifier(text, dat.index, dat.index + dat[0].length), "RELATIVE_DATE", "Message date + 2 days"));
  }
  const parso = /\b(parso|parson|parsoo|parsu)\b/.exec(text);
  if (parso) {
    const s = parso.index;
    const e = s + parso[0].length;
    if (hasPast) {
      push(s, e, {
        rawText: parso[0], type: "AMBIGUOUS", lowerBound: addDays(msgDate, -2), upperBound: addDays(msgDate, -2), confidenceBand: "NEEDS_REVIEW",
        resolutionNote: "Past-tense context — 'parso' refers to two days ago, not a promise date",
      });
    } else if (hasFuture) {
      push(s, e, withModifier(parso[0], addDays(msgDate, 2), modifier(text, s, e), "RELATIVE_DATE", "'parso' + future tense → day after tomorrow"));
    } else {
      push(s, e, {
        rawText: parso[0], type: "AMBIGUOUS", lowerBound: addDays(msgDate, -2), upperBound: addDays(msgDate, 2), confidenceBand: "NEEDS_REVIEW",
        resolutionNote: "'parso' can mean two days ago or two days ahead; no tense marker resolves it",
      });
    }
  }
  const tomorrow = /\b(tomorrow|tmrw|tmrrw|tomorow|kal)\b/.exec(text);
  if (tomorrow) {
    const s = tomorrow.index;
    const e = s + tomorrow[0].length;
    const isKal = tomorrow[0] === "kal";
    const tod = /\b(afternoon|dopahar|dopeher|subah|morning|shaam|sham|evening|eod|raat)\b/.exec(text);
    if (isKal && hasPast) {
      push(s, e, {
        rawText: "kal", type: "RELATIVE_DATE", normalizedDate: addDays(msgDate, -1), confidenceBand: "HIGH",
        resolutionNote: "Past-tense context → 'kal' = yesterday",
      });
    } else {
      const raw = tod && tod.index > s && tod.index - e < 4 ? text.slice(s, tod.index + tod[0].length) : tomorrow[0];
      push(s, e, withModifier(raw, addDays(msgDate, 1), modifier(text, s, e), "RELATIVE_DATE", `Message date + 1 day${tod ? ` (${tod[0]})` : ""}`));
    }
  }
  const yesterday = /\b(yesterday)\b/.exec(text);
  if (yesterday) {
    push(yesterday.index, yesterday.index + yesterday[0].length, {
      rawText: yesterday[0], type: "RELATIVE_DATE", normalizedDate: addDays(msgDate, -1), confidenceBand: "HIGH", resolutionNote: "Message date − 1 day",
    });
  }
  const today = /\b(today|aaj|aj|abhi|right now|tonight)\b/.exec(text);
  if (today) {
    push(today.index, today.index + today[0].length, {
      rawText: today[0], type: "RELATIVE_DATE", normalizedDate: msgDate, confidenceBand: "HIGH", resolutionNote: "Same day as the message",
    });
  }

  // 5. Weekdays
  for (const [re, target] of WEEKDAY_WORDS) {
    const wm = re.exec(text);
    if (!wm) continue;
    const s = wm.index;
    const e = s + wm[0].length;
    const prefix = text.slice(Math.max(0, s - 10), s);
    const isNext = /\b(next|agle|agla|agli)\s+$/.test(prefix);
    const isThis = /\b(this|is|coming|aane wale|iss)\s+$/.test(prefix);
    const msgWd = weekdayOf(msgDate);
    const delta = (target - msgWd + 7) % 7;
    const upcoming = addDays(msgDate, delta === 0 ? 7 : delta);
    const rawStart = isNext || isThis ? s - (prefix.match(/(\S+)\s+$/)?.[0].length ?? 0) : s;
    const raw = text.slice(rawStart, e);
    const mod = modifier(text, rawStart, e);
    if (isNext) {
      if (sameIsoWeek(upcoming, msgDate)) {
        push(rawStart, e, {
          rawText: raw, type: "AMBIGUOUS", lowerBound: upcoming, upperBound: addDays(upcoming, 7), confidenceBand: "NEEDS_REVIEW",
          resolutionNote: `Could mean ${upcoming} (this week) or ${addDays(upcoming, 7)} (the following week)`,
        });
      } else {
        push(rawStart, e, withModifier(raw, upcoming, mod, "RELATIVE_DATE", "Next occurrence, which falls in the following week"));
      }
    } else if (delta === 0 && !isThis) {
      push(rawStart, e, {
        rawText: raw, type: "AMBIGUOUS", lowerBound: msgDate, upperBound: addDays(msgDate, 7), confidenceBand: "NEEDS_REVIEW",
        resolutionNote: "Message was sent on that weekday — today or next week is unclear",
      });
    } else {
      push(rawStart, e, withModifier(raw, delta === 0 ? msgDate : upcoming, mod, "RELATIVE_DATE", "Next occurrence after the message date"));
    }
  }

  return hits.sort((a, b) => a.start - b.start).map((h) => h.expr);
}
