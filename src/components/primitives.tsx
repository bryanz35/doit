/** Small shared bits used across pages. */

import type { ReactNode } from "react";

export function Kbd({ children, onAccent }: { children: ReactNode; onAccent?: boolean }) {
  return <span className={onAccent ? "kbd kbd-on-accent" : "kbd"}>{children}</span>;
}

export function Rule() {
  return <div className="rule" />;
}

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
    <div className="seg" role="tablist">
      {options.map((option) => (
        <span
          key={option}
          role="tab"
          tabIndex={0}
          aria-selected={option === value}
          className={option === value ? "seg-opt is-on" : "seg-opt"}
          onClick={() => onChange(option)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") onChange(option);
          }}
        >
          {option}
        </span>
      ))}
    </div>
  );
}

/** Task checkbox — a hollow square in the design, never a native control. */
export function CheckBox({
  done,
  overdue,
  onToggle,
  label,
}: {
  done?: boolean;
  overdue?: boolean;
  onToggle?: () => void;
  label: string;
}) {
  const classes = ["box"];
  if (done) classes.push("box-done");
  else if (overdue) classes.push("box-overdue");
  return (
    <button
      type="button"
      className={classes.join(" ")}
      aria-pressed={Boolean(done)}
      aria-label={done ? `Mark "${label}" not done` : `Mark "${label}" done`}
      onClick={(event) => {
        event.stopPropagation();
        onToggle?.();
      }}
    />
  );
}

/** "1h 15m" / "50m" — the estimate format used throughout the mockups. */
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
