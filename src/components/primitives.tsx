/** Small shared bits used across pages. */

import type { ReactNode } from "react";

/** A keyboard hint pill. Inside a primary button it inverts on its own. */
export function Kbd({ children }: { children: ReactNode }) {
  return <span className="dt-key">{children}</span>;
}

/** The modifier the palette shortcut uses on this platform. */
export const MOD_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl ";

/** macOS-style segmented control: a track with a raised thumb on the value. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly T[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div className="dt-seg" role="tablist">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          role="tab"
          aria-selected={option === value}
          className="dt-seg-opt"
          onClick={() => onChange(option)}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/** Task checkbox — a ring that fills with the list colour (`data-color` on an
 *  ancestor) when done. Never a native control. */
export function CheckBox({
  done,
  onToggle,
  label,
}: {
  done?: boolean;
  onToggle?: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="dt-check"
      aria-pressed={Boolean(done)}
      aria-label={done ? `Mark "${label}" not done` : `Mark "${label}" done`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.();
      }}
    />
  );
}

/** "1h 15m" / "50m" — the estimate format used throughout. */
export function formatMinutes(minutes: number | undefined): string {
  if (minutes === undefined) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}m`;
  if (!rest) return `${hours}h`;
  return `${hours}h ${String(rest).padStart(2, "0")}m`;
}

/** "14:05" from minutes-past-midnight. */
export function formatClock(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Relative dates first: "Today", "Yesterday", "Tomorrow", "Fri 9" within a
 *  week either side, "9 Oct" beyond that, "Someday" for no date. */
export function dueLabel(due: string | undefined, today: string): string {
  if (!due) return "Someday";
  const date = new Date(`${due}T00:00:00`);
  const days = Math.round((date.getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);
  if (days === 0) return "Today";
  if (days === -1) return "Yesterday";
  if (days === 1) return "Tomorrow";
  if (Math.abs(days) < 7) {
    return date.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
