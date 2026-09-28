import { addHours, endOfIstDay } from "./time";
import type { ScheduledEvent } from "./types";

/**
 * Timer abstraction. Timers are plain data on WorldState; `dueTimers` returns
 * the ones that should fire when the (demo) clock moves forward. The engine owns
 * what happens on fire — timers never change state directly.
 */

/** Deadline instant for a promise: end of the promised IST day + grace period. */
export function promiseDeadline(promisedDate: string, graceHours: number): string {
  return addHours(endOfIstDay(promisedDate), graceHours);
}

export function schedule(
  timers: ScheduledEvent[],
  event: Omit<ScheduledEvent, "status">,
): ScheduledEvent {
  const t: ScheduledEvent = { ...event, status: "PENDING" };
  timers.push(t);
  return t;
}

export function cancelTimersFor(timers: ScheduledEvent[], invoiceId: string, outcome: string): void {
  for (const t of timers) {
    if (t.invoiceId === invoiceId && t.status === "PENDING") {
      t.status = "CANCELLED";
      t.outcome = outcome;
    }
  }
}

/** Pending timers due at or before `until`, in firing order. */
export function dueTimers(timers: ScheduledEvent[], until: string): ScheduledEvent[] {
  const limit = new Date(until).getTime();
  return timers
    .filter((t) => t.status === "PENDING" && new Date(t.fireAt).getTime() <= limit)
    .sort((a, b) => new Date(a.fireAt).getTime() - new Date(b.fireAt).getTime() || a.id.localeCompare(b.id));
}

export function nextPendingTimer(timers: ScheduledEvent[]): ScheduledEvent | undefined {
  return timers
    .filter((t) => t.status === "PENDING")
    .sort((a, b) => new Date(a.fireAt).getTime() - new Date(b.fireAt).getTime())[0];
}
