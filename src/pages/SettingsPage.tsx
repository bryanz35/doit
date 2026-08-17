/** Screen 1e — connected calendars and the outbound ICS feed. */

import { useState } from "react";
import { calendarAccounts, feedUrl } from "../data/mock";
import { Rule } from "../components/primitives";

const SECTIONS = ["General", "Calendars", "Focus & timers", "Keybinds", "Data & export"] as const;
type Section = (typeof SECTIONS)[number];

export function SettingsPage() {
  const [section, setSection] = useState<Section>("Calendars");

  return (
    <>
      <header className="topbar">
        <h4>Settings</h4>
        <span className="text-muted meta" style={{ fontSize: 13 }}>
          {section}
        </span>
      </header>

      <div className="body">
        <nav className="settings-nav" aria-label="Settings sections">
          {SECTIONS.map((item) => (
            <button
              key={item}
              type="button"
              className={`settings-nav-item${item === section ? " is-on" : ""}`}
              onClick={() => setSection(item)}
            >
              {item}
            </button>
          ))}
        </nav>

        <div className="settings-body">
          {section === "Calendars" ? <CalendarSettings /> : <Placeholder section={section} />}
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
      <h3 style={{ margin: "0 0 6px" }}>Connected accounts</h3>
      <p className="text-muted" style={{ fontSize: 13, margin: "0 0 18px", textWrap: "pretty" }}>
        Read events in so the week view knows where your time already went. Write scheduled tasks
        back out as a separate calendar.
      </p>
      <Rule />

      {/* TODO(backend): OAuth flows and sync state live in Rust. */}
      {calendarAccounts.map((account) => (
        <div className="account-row" key={account.id}>
          <div className="account-badge">{account.badge}</div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800 }}>{account.name}</div>
            <div className="text-muted" style={{ fontSize: 12 }}>
              {account.detail}
            </div>
          </div>
          <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
            {account.sync === "two-way" && <span className="tag tag-accent">Two-way</span>}
            <button type="button" className="btn btn-secondary">
              {account.connected ? "Manage" : "Connect"}
            </button>
          </div>
        </div>
      ))}

      <h3 style={{ margin: "34px 0 6px" }}>Publish your tasks</h3>
      <p className="text-muted" style={{ fontSize: 13, margin: "0 0 16px" }}>
        A read-only ICS feed of every scheduled task. Subscribe from any client.
      </p>

      <div className="field" style={{ marginBottom: 14 }}>
        <label htmlFor="feed-url">Feed URL</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            id="feed-url"
            className="input"
            readOnly
            value={feedUrl}
            style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5 }}
          />
          <button
            type="button"
            className="btn btn-primary"
            style={{ flex: "none" }}
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

      <div style={{ display: "flex", gap: 22, alignItems: "center", marginBottom: 8 }}>
        <label className="radio">
          <input
            type="radio"
            name="feed"
            checked={feedScope === "scheduled"}
            onChange={() => setFeedScope("scheduled")}
          />
          <span className="dot" />
          Scheduled tasks only
        </label>
        <label className="radio">
          <input
            type="radio"
            name="feed"
            checked={feedScope === "due"}
            onChange={() => setFeedScope("due")}
          />
          <span className="dot" />
          Everything with a due date
        </label>
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <button type="button" className="btn btn-secondary">
          Download .ics once
        </button>
        <button type="button" className="btn btn-ghost">
          Revoke and regenerate
        </button>
      </div>
    </>
  );
}

function Placeholder({ section }: { section: string }) {
  return (
    <>
      <h3 style={{ margin: "0 0 6px" }}>{section}</h3>
      <p className="text-muted" style={{ fontSize: 13 }}>
        Not designed yet — the mockups only cover Calendars.
      </p>
    </>
  );
}
