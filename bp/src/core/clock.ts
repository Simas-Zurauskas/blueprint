// The clock is injected (testing §2.4). Run-log dates and times are the machine's local wall clock, as every existing
// log was written; ISO timestamps (UTC) are only ever used for ordering, never printed into content.

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

export const fixedClock = (iso: string): Clock => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error(`fixedClock: not a date: ${iso}`);
  return { now: () => new Date(d.getTime()) };
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** YYYY-MM-DD in local time. */
export const localDate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** HH:MM in local time. */
export const localTime = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Whole days between two dates, by local calendar date — an age is never invented (status.md: "unknown", never "0d"). */
export function daysBetween(from: Date, to: Date): number {
  const a = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const b = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((b - a) / 86_400_000);
}
