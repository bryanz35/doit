/** Settings, laid out like System Settings: a section list on the left and
 *  inset groups of rows on the right. Calendars (connected accounts and the
 *  outbound ICS feed) is mock data; Keybinds lists the real bindings. */

import { useState } from "react";
import { calendarAccounts, feedUrl } from "../data/mock";
import { Kbd, MOD_KEY } from "../components/primitives";

const SECTIONS = ["General", "Calendars", "Focus & timers", "Keybinds", "Data & export"] as const;
type Section = (typeof SECTIONS)[number];

export function SettingsPage() {
  const [section, setSection] = useState<Section>("Calendars");

  return (
    <>
      <header className="dt-toolbar">
        <span className="dt-toolbar-title">Settings</span>
        <span className="dt-muted toolbar-meta">{section}</span>
      </header>

      <div className="dt-settings page-body">
        <nav className="dt-settings-nav" aria-label="Settings sections">
          {SECTIONS.map((item) => (
            <button
              key={item}
              type="button"
              className="dt-side-item"
              aria-current={item === section ? "page" : undefined}
              onClick={() => setSection(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="dt-settings-body">
          {section === "Calendars" ? (
            <CalendarSettings />
          ) : section === "Keybinds" ? (
            <KeybindSettings />
          ) : (
            <Placeholder section={section} />
          )}
        </div>
      </div>
    </>
  );
}

function CalendarSettings() {
  const [feedScope, setFeedScope] = useState<"scheduled" | "due">("scheduled");
  const [copied, setCopied] = useState(false);

  return (
    <>
      <h2>Connected accounts</h2>
      <p>
        Read events in so the week view knows where your time already went. Write scheduled tasks
        back out as a separate calendar.
      </p>

      {/* TODO(backend): OAuth flows and sync state live in Rust. */}
      <div className="dt-group">
        {calendarAccounts.map((account) => (
          <div className="dt-account" key={account.id}>
            <span className="dt-account-badge">{account.badge}</span>
            <div>
              <div className="dt-account-name">{account.name}</div>
              <div className="dt-account-detail">
                {account.connected ? account.detail : <span className="dt-status">Not connected</span>}
              </div>
            </div>
            <div className="dt-account-end">
              {account.sync === "two-way" && <span className="dt-tag dt-tag-accent">Two-way</span>}
              <button type="button" className="dt-btn">
                {account.connected ? "Manage" : "Connect"}
              </button>
            </div>
          </div>
        ))}
      </div>

      <h2>Publish your tasks</h2>
      <p>A read-only ICS feed of every scheduled task. Subscribe from any client.</p>

      <div className="dt-group">
        <div className="dt-form-stack">
          <label className="dt-label" htmlFor="feed-url">
            Feed URL
          </label>
          <div className="settings-inline">
            <input id="feed-url" className="dt-input dt-input-mono" readOnly value={feedUrl} />
            <button
              type="button"
              className="dt-btn dt-btn-primary"
              onClick={() => {
                void navigator.clipboard?.writeText(feedUrl);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
        <div className="dt-form-row">
          <label className="dt-radio">
            <input
              type="radio"
              name="feed"
              checked={feedScope === "scheduled"}
              onChange={() => setFeedScope("scheduled")}
            />
            <span className="dt-dot" />
            Scheduled tasks only
          </label>
          <span />
        </div>
        <div className="dt-form-row">
          <label className="dt-radio">
            <input
              type="radio"
              name="feed"
              checked={feedScope === "due"}
              onChange={() => setFeedScope("due")}
            />
            <span className="dt-dot" />
            Everything with a due date
          </label>
          <span />
        </div>
        <div className="dt-form-row">
          <button type="button" className="dt-btn">
            Download .ics once
          </button>
          <button type="button" className="dt-btn dt-btn-danger">
            Revoke and regenerate
          </button>
        </div>
      </div>
    </>
  );
}

/** The bindings App.tsx and the screens actually register. */
const KEYBINDS: [string, string][] = [
  ["1 – 5", "Tasks, Calendar, Focus, Graph, Settings"],
  [`${MOD_KEY}K`, "Command palette"],
  ["N", "New task (Tasks)"],
  ["Esc", "Close the palette, the compose row or the task detail"],
  ["Space", "Pause or resume the focus timer"],
  ["Shift", "Hold while dragging a calendar block to copy it"],
];

function KeybindSettings() {
  return (
    <>
      <h2>Keybinds</h2>
      <p>Every screen is reachable from the keyboard. Bindings are fixed for now.</p>
      <div className="dt-group">
        {KEYBINDS.map(([keys, action]) => (
          <div className="dt-form-row" key={keys}>
            <span>{action}</span>
            <Kbd>{keys}</Kbd>
          </div>
        ))}
      </div>
    </>
  );
}

function Placeholder({ section }: { section: string }) {
  return (
    <>
      <h2>{section}</h2>
      <p>Nothing to configure here yet.</p>
    </>
  );
}
