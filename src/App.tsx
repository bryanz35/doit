/** App shell: the rail plus one page, with the global keybinds from the mockups. */

import { useEffect, useState } from "react";
import { AppProvider, useApp } from "./data/store";
import { Rail, NAV_ITEMS } from "./components/Rail";
import { CommandPalette } from "./components/CommandPalette";
import { TasksPage } from "./pages/TasksPage";
import { CalendarPage } from "./pages/CalendarPage";
import { FocusPage } from "./pages/FocusPage";
import { GraphPage } from "./pages/GraphPage";
import { SettingsPage } from "./pages/SettingsPage";
import "./styles/design-system.css";
import "./styles/app.css";

function Shell() {
  const { page, setPage, paletteOpen, setPaletteOpen, selectTask } = useApp();
  const [railExpanded, setRailExpanded] = useState(false);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (event.key === "Escape") {
        if (paletteOpen) setPaletteOpen(false);
        else selectTask(null);
        return;
      }
      if (typing || paletteOpen) return;

      const nav = NAV_ITEMS.find((item) => item.key === event.key);
      if (nav) {
        event.preventDefault();
        // Never unmount a page while something inside it holds focus — the
        // :focus-visible ring outlives the node it was painted around.
        if (el && el !== document.body) el.blur();
        setPage(nav.id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, setPage, setPaletteOpen, selectTask]);

  return (
    <div className="shell">
      <Rail
        page={page}
        onNavigate={setPage}
        expanded={railExpanded}
        onToggleExpanded={() => setRailExpanded((value) => !value)}
      />
      <main className="pane">
        {page === "tasks" && <TasksPage />}
        {page === "calendar" && <CalendarPage />}
        {page === "focus" && <FocusPage />}
        {page === "graph" && <GraphPage />}
        {page === "settings" && <SettingsPage />}
      </main>
      <CommandPalette />
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  );
}
