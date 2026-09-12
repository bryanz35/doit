/** Quick-add syntax for the compose row.
 *
 * One line of text becomes the arguments of `create_task` plus the follow-up
 * `update_task` / `set_task_tags` calls the store makes for the fields the
 * create command does not take. Sigils are explicit on purpose: a bare word is
 * always part of the title, so "review monday notes" never becomes a due date.
 *
 *   @today @tomorrow @someday @fri @2026-09-20 @+3   due date
 *   #tag                                             tag (repeatable)
 *   /list                                            list
 *   =30m =1h =1h30m =90                              estimate
 */

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

export interface QuickAdd {
  title: string;
  /** YYYY-MM-DD, or null for an explicit `@someday` (unscheduled). */
  due: string | null;
  list?: string;
  estimateMinutes?: number;
  tags: string[];
  /** Tokens that carried a sigil but parsed to nothing — shown as a hint so a
   *  typo'd `@tmrw` is visible instead of silently dropped from the title. */
  unknown: string[];
}

/** Shift a YYYY-MM-DD by whole days without going through UTC. */
function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00`);
  date.setDate(date.getDate() + days);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** `@…` → an ISO date, `null` for someday, `undefined` when unrecognised. */
function parseDue(word: string, today: string): string | null | undefined {
  const value = word.toLowerCase();
  if (value === "today") return today;
  if (value === "tomorrow" || value === "tmr") return addDays(today, 1);
  if (value === "yesterday") return addDays(today, -1);
  if (value === "someday" || value === "none") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? undefined : value;
  }
  // `@+3` / `@3d` — days out from today.
  const offset = /^\+?(\d+)d?$/.exec(value);
  if (offset) return addDays(today, Number(offset[1]));
  // A weekday name means the next one strictly after today.
  const weekday = WEEKDAYS.indexOf(value.slice(0, 3));
  if (weekday >= 0) {
    const from = new Date(`${today}T00:00:00`).getDay();
    return addDays(today, ((weekday - from + 7) % 7) || 7);
  }
  return undefined;
}

/** `=1h30m` / `=90` → minutes. */
function parseEstimate(word: string): number | undefined {
  const value = word.toLowerCase();
  if (/^\d+$/.test(value)) return Number(value) || undefined;
  const parts = /^(?:(\d+)h)?(?:(\d+)m?)?$/.exec(value);
  if (!parts || (!parts[1] && !parts[2])) return undefined;
  const minutes = Number(parts[1] ?? 0) * 60 + Number(parts[2] ?? 0);
  return minutes || undefined;
}

export function parseQuickAdd(input: string, today: string): QuickAdd {
  const words: string[] = [];
  const tags: string[] = [];
  const unknown: string[] = [];
  let due: string | null | undefined;
  let list: string | undefined;
  let estimateMinutes: number | undefined;

  for (const word of input.split(/\s+/)) {
    if (word.length < 2) {
      if (word) words.push(word);
      continue;
    }
    const body = word.slice(1);
    switch (word[0]) {
      case "@": {
        const parsed = parseDue(body, today);
        if (parsed === undefined) unknown.push(word);
        else due = parsed;
        break;
      }
      case "#":
        if (!tags.includes(body)) tags.push(body);
        break;
      case "/":
        list = body;
        break;
      case "=": {
        const minutes = parseEstimate(body);
        if (minutes === undefined) unknown.push(word);
        else estimateMinutes = minutes;
        break;
      }
      default:
        words.push(word);
    }
  }

  return {
    title: words.join(" ").trim(),
    // No `@…` at all means the task lands on today, matching the Today screen
    // the compose row lives on. `@someday` is the way to opt out.
    due: due === undefined ? today : due,
    list,
    estimateMinutes,
    tags,
    unknown,
  };
}
