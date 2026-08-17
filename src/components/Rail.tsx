/** Left navigation. Collapsed (64px, screens 1a–1f) or expanded (variation 2c). */

import type { PageId } from "../types";
import { lists } from "../data/mock";
import {
  CalendarIcon,
  FocusIcon,
  GraphIcon,
  SettingsIcon,
  TasksIcon,
} from "./icons";
import { Kbd } from "./primitives";

interface NavItem {
  id: PageId;
  label: string;
  key: string;
  Icon: typeof TasksIcon;
  /** Settings sits at the bottom of the rail. */
  bottom?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "tasks", label: "Tasks", key: "1", Icon: TasksIcon },
  { id: "calendar", label: "Calendar", key: "2", Icon: CalendarIcon },
  { id: "focus", label: "Focus", key: "3", Icon: FocusIcon },
  { id: "graph", label: "Graph", key: "4", Icon: GraphIcon },
  { id: "settings", label: "Settings", key: "5", Icon: SettingsIcon, bottom: true },
];

interface RailProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}

export function Rail({ page, onNavigate, expanded, onToggleExpanded }: RailProps) {
  if (expanded) {
    return (
      <nav className="rail rail-wide" aria-label="Main">
        <button
          type="button"
          className="rail-brand"
          onClick={onToggleExpanded}
          title="Collapse the rail"
          style={{ background: "transparent", border: 0, cursor: "pointer", font: "inherit", color: "inherit" }}
        >
          <span className="rail-brand-mark" />
          <span className="rail-brand-name">doit</span>
        </button>
        {NAV_ITEMS.map(({ id, label, key, Icon, bottom }) => (
          <button
            key={id}
            type="button"
            aria-current={page === id ? "page" : undefined}
            className={`rail-link${page === id ? " railon" : ""}`}
            style={bottom ? { marginTop: "auto" } : undefined}
            onClick={() => onNavigate(id)}
          >
            <Icon />
            {label}
            <span style={{ marginLeft: "auto" }}>
              <Kbd onAccent={page === id}>{key}</Kbd>
            </span>
          </button>
        ))}
        <div className="rail-divider" />
        <div className="rail-lists">
          <h6 style={{ margin: "0 0 8px", color: "var(--color-neutral-700)" }}>Lists</h6>
          {lists.map((list) => (
            <div className="rail-list-row" key={list.name}>
              <span>{list.name}</span>
              <span className="text-muted" style={{ marginLeft: "auto" }}>
                {list.count}
              </span>
            </div>
          ))}
        </div>
      </nav>
    );
  }

  return (
    <nav className="rail" aria-label="Main">
      <button
        type="button"
        className="rail-mark"
        onClick={onToggleExpanded}
        title="Expand the rail"
        style={{ border: 0, cursor: "pointer", padding: 0 }}
        aria-label="Expand the rail"
      />
      {NAV_ITEMS.map(({ id, label, Icon, bottom }) => (
        <button
          key={id}
          type="button"
          title={label}
          aria-label={label}
          aria-current={page === id ? "page" : undefined}
          className={`railitem${page === id ? " railon" : ""}${bottom ? " rail-spacer" : ""}`}
          onClick={() => onNavigate(id)}
        >
          <Icon />
        </button>
      ))}
    </nav>
  );
}
