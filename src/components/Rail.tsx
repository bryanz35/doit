/** Left navigation. Collapsed, it is the 64px icon rail; expanded, the
 *  Reminders-style sidebar: smart-list tiles, the lists, then the app's
 *  sections. The logo mark toggles between the two. */

import type { PageId, TaskScope } from "../types";
import { useApp } from "../data/store";
import { SMART_LISTS, listColor, openLists, sameScope, smartCount, type SmartId } from "../data/scope";
import {
  AlertIcon,
  CalendarIcon,
  CheckIcon,
  FocusIcon,
  GraphIcon,
  InboxIcon,
  SettingsIcon,
  TasksIcon,
} from "./icons";
import { Kbd } from "./primitives";

interface NavItem {
  id: PageId;
  label: string;
  key: string;
  Icon: typeof TasksIcon;
  /** Settings sits at the bottom of the collapsed rail. */
  bottom?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "tasks", label: "Tasks", key: "1", Icon: TasksIcon },
  { id: "calendar", label: "Calendar", key: "2", Icon: CalendarIcon },
  { id: "focus", label: "Focus", key: "3", Icon: FocusIcon },
  { id: "graph", label: "Graph", key: "4", Icon: GraphIcon },
  { id: "settings", label: "Settings", key: "5", Icon: SettingsIcon, bottom: true },
];

const SMART_ICONS: Record<SmartId, typeof TasksIcon> = {
  today: CalendarIcon,
  overdue: AlertIcon,
  all: InboxIcon,
  completed: CheckIcon,
};

interface RailProps {
  page: PageId;
  onNavigate: (page: PageId) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
}

export function Rail({ page, onNavigate, expanded, onToggleExpanded }: RailProps) {
  const { tasks, today, scope, setScope } = useApp();

  if (!expanded) {
    return (
      <nav className="dt-rail" aria-label="Main">
        <button
          type="button"
          className="dt-rail-mark app-mark"
          onClick={onToggleExpanded}
          title="Expand the sidebar"
          aria-label="Expand the sidebar"
        />
        {NAV_ITEMS.map(({ id, label, Icon, bottom }) => (
          <button
            key={id}
            type="button"
            title={label}
            aria-label={label}
            aria-current={page === id ? "page" : undefined}
            className={`dt-rail-item${bottom ? " dt-rail-bottom" : ""}`}
            onClick={() => onNavigate(id)}
          >
            <Icon />
          </button>
        ))}
      </nav>
    );
  }

  const open = (next: TaskScope) => {
    setScope(next);
    onNavigate("tasks");
  };
  const current = (candidate: TaskScope) => page === "tasks" && sameScope(scope, candidate);

  return (
    <nav className="dt-sidebar" aria-label="Main">
      <button
        type="button"
        className="sidebar-brand"
        onClick={onToggleExpanded}
        title="Collapse the sidebar"
      >
        <span className="dt-rail-mark app-mark" aria-hidden="true" />
        doit
      </button>

      <div className="dt-tiles">
        {SMART_LISTS.map(({ id, label, color }) => {
          const Icon = SMART_ICONS[id];
          const tile: TaskScope = { kind: "smart", id };
          return (
            <button
              key={id}
              type="button"
              className="dt-tile"
              data-color={color}
              aria-current={current(tile) ? "true" : undefined}
              onClick={() => open(tile)}
            >
              <span className="dt-disc">
                <Icon size={14} stroke={id === "overdue" || id === "completed" ? 3 : 2.5} />
              </span>
              <span className="dt-tile-count">{smartCount(tasks, id, today)}</span>
              <span className="dt-tile-name">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="dt-side-head">My Lists</div>
      {openLists(tasks).map(({ name, count }) => {
        const list: TaskScope = { kind: "list", name };
        return (
          <button
            key={name}
            type="button"
            className="dt-side-item"
            data-color={listColor(name)}
            aria-current={current(list) ? "true" : undefined}
            onClick={() => open(list)}
          >
            <span className="dt-disc dt-disc-sm">
              <TasksIcon size={12} stroke={2.5} />
            </span>
            {name}
            <span className="dt-count">{count}</span>
          </button>
        );
      })}

      <div className="dt-side-head sidebar-sections">doit</div>
      {NAV_ITEMS.map(({ id, label, key, Icon }) => (
        <button
          key={id}
          type="button"
          className="dt-side-item"
          aria-current={page === id ? "page" : undefined}
          onClick={() => onNavigate(id)}
        >
          <Icon size={16} />
          {label}
          <span className="dt-count">
            <Kbd>{key}</Kbd>
          </span>
        </button>
      ))}
    </nav>
  );
}
