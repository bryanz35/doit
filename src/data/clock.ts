/** Wall-clock state for a window that may stay open for days.
 *
 * Anything that reads "now" once and keeps it goes stale at midnight. These
 * hooks re-read the clock on every minute boundary and again whenever the
 * window comes back (focus, visibility). Each wait is re-measured from the wall
 * clock rather than repeated: timers run on a clock that stops while the machine
 * is suspended, so a fixed long wait would wake hours late. */

import { useEffect, useState } from "react";

/** Local calendar date as YYYY-MM-DD — the same shape the `due` column stores.
 *  `toISOString()` would be wrong here: it converts to UTC first, so an evening
 *  west of Greenwich reports tomorrow. */
export function todayIso(now = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/** The local date and minutes past local midnight, read from one instant so the
 *  two never disagree across midnight. */
export type Clock = { date: string; minutes: number };

function readClock(): Clock {
  const now = new Date();
  return { date: todayIso(now), minutes: now.getHours() * 60 + now.getMinutes() };
}

/** `read()`, kept current. `read` must be stable (a module-level function). */
function useWallClock<T>(read: () => T, same: (a: T, b: T) => boolean): T {
  const [value, setValue] = useState(read);
  useEffect(() => {
    let timer = 0;
    const check = () => {
      const next = read();
      setValue((current) => (same(current, next) ? current : next));
    };
    const tick = () => {
      check();
      const now = new Date();
      timer = window.setTimeout(tick, 60_000 - (now.getSeconds() * 1000 + now.getMilliseconds()));
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    tick();
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [read, same]);
  return value;
}

const sameString = (a: string, b: string) => a === b;
const sameClock = (a: Clock, b: Clock) => a.date === b.date && a.minutes === b.minutes;

/** Today's local date, rolling over at midnight. Re-renders only when it changes. */
export function useToday(): string {
  return useWallClock(todayIso, sameString);
}

/** Date and minute of day, re-rendering once a minute — for the now-line. */
export function useClock(): Clock {
  return useWallClock(readClock, sameClock);
}
