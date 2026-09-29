/** Conversions between the calendar's local-clock view and the UTC instants
 *  `task_blocks` stores.
 *
 *  The backend insists on one exact spelling — `YYYY-MM-DDTHH:MM:SSZ`, no
 *  offset and no milliseconds (`tasks::check_instant`) — because the schema's
 *  CHECK and every ORDER BY compare those strings as text. `toISOString()`
 *  alone would be rejected: it appends `.sssZ`. Everything the frontend sends
 *  goes through `toInstant`.
 *
 *  The calendar grid works in local wall-clock time: a `YYYY-MM-DD` day plus
 *  minutes past local midnight. `atMinutes` and `dateOf`/`minutesOf` are the
 *  two directions of that conversion, and they route through the (y, m, d, h,
 *  min) Date constructor so the platform applies the local offset — including
 *  DST — rather than us doing offset arithmetic by hand. */

/** A Date as the canonical UTC instant the backend accepts. Seconds are kept,
 *  milliseconds are dropped rather than rounded. */
export function toInstant(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

export function fromInstant(instant: string): Date {
  return new Date(instant);
}

/** The instant at `minutes` past local midnight on the local day `iso`.
 *  Minutes outside 0–1439 roll into the neighbouring day, which is what a drag
 *  that runs past midnight needs. */
export function atMinutes(iso: string, minutes: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  return toInstant(new Date(y, m - 1, d, 0, minutes, 0, 0));
}

/** Local calendar date of an instant, as the same YYYY-MM-DD the grid keys on. */
export function dateOf(instant: string): string {
  const date = fromInstant(instant);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** Minutes past local midnight of an instant's own day. */
export function minutesOf(instant: string): number {
  const date = fromInstant(instant);
  return date.getHours() * 60 + date.getMinutes();
}

/** Whole minutes between two instants. */
export function durationMinutes(startAt: string, endAt: string): number {
  return Math.round((fromInstant(endAt).getTime() - fromInstant(startAt).getTime()) / 60000);
}

/** The instant `minutes` after `instant`. */
export function shift(instant: string, minutes: number): string {
  return toInstant(new Date(fromInstant(instant).getTime() + minutes * 60000));
}

/** "09:30" in local time, for a block's label. */
export function clockOf(instant: string): string {
  const date = fromInstant(instant);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** The zone blocks are authored in. Stored on every block the app creates so an
 *  ICS export can say where the user was; `undefined` if the platform has no
 *  answer, which the backend reads as a floating block. */
export function localZone(): string | undefined {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
}
