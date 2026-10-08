/** Vim keys for the task list itself — the list is the buffer and each task a
 *  line. Parses the keys typed so far into one command; `TasksPage` carries the
 *  pending keys between presses and acts on the result.
 *
 *    [n]j [n]k  ↓ ↑     move the selection n tasks down / up
 *    gg [n]gg G [n]G    first task, nth task, last task
 *    g1 … g5            switch page (plain digits are counts on this page)
 *    o O                compose a new task below / above the selected one
 *    i I a A            edit the title, caret at the start / end
 *    cc C S             change the title: clear it and start typing
 *    [n]dd d[n]j d[n]k  delete n tasks / this and the n below / above
 *    dG dgg             delete to the last / first task
 *    [n]x               toggle n tasks done
 *    n N                compose at the default place, as before */

export type ListCommand =
  | { kind: "move"; by: number }
  | { kind: "goto"; index: number | "last" }
  | { kind: "page"; key: string }
  | { kind: "open"; where: "above" | "below" }
  | { kind: "edit"; at: "start" | "end" }
  /** Open the editor on an emptied title. */
  | { kind: "change" }
  | { kind: "compose" }
  /** Delete a span of tasks counted from the selection. `line` is `dd`: count
   *  tasks starting at the selection; `down`/`up` take count more beyond it. */
  | { kind: "delete"; span: "line" | "down" | "up" | "last" | "first"; count: number }
  | { kind: "toggle"; count: number };

export function parseListKeys(keys: string[]): ListCommand | "pending" | "invalid" {
  let i = 0;
  const readCount = () => {
    const start = i;
    while (i < keys.length && /^[0-9]$/.test(keys[i]) && (i > start || keys[i] !== "0")) i++;
    return i > start ? Number(keys.slice(start, i).join("")) : undefined;
  };
  const count = readCount();
  const key = keys[i++];
  if (key === undefined) return "pending";
  const n = count ?? 1;

  switch (key) {
    case "j":
    case "ArrowDown":
      return { kind: "move", by: n };
    case "k":
    case "ArrowUp":
      return { kind: "move", by: -n };
    case "G":
      return { kind: "goto", index: count === undefined ? "last" : count - 1 };
    case "g": {
      const second = keys[i];
      if (second === undefined) return "pending";
      if (second === "g") return { kind: "goto", index: n - 1 };
      if (count === undefined && /^[1-9]$/.test(second)) return { kind: "page", key: second };
      return "invalid";
    }
    case "o":
      return { kind: "open", where: "below" };
    case "O":
      return { kind: "open", where: "above" };
    case "i":
    case "I":
      return { kind: "edit", at: "start" };
    case "a":
    case "A":
      return { kind: "edit", at: "end" };
    case "c": {
      const second = keys[i];
      if (second === undefined) return "pending";
      return second === "c" ? { kind: "change" } : "invalid";
    }
    case "C":
    case "S":
      return { kind: "change" };
    case "d": {
      // `2d3j` is 6, as in vim.
      const inner = readCount();
      const target = keys[i++];
      if (target === undefined) return "pending";
      const total = n * (inner ?? 1);
      if (target === "d") return { kind: "delete", span: "line", count: total };
      if (target === "j" || target === "ArrowDown") return { kind: "delete", span: "down", count: total };
      if (target === "k" || target === "ArrowUp") return { kind: "delete", span: "up", count: total };
      if (target === "G") return { kind: "delete", span: "last", count: total };
      if (target === "g") {
        const third = keys[i];
        if (third === undefined) return "pending";
        return third === "g" ? { kind: "delete", span: "first", count: total } : "invalid";
      }
      return "invalid";
    }
    case "x":
      return { kind: "toggle", count: n };
    case "n":
    case "N":
      return count === undefined ? { kind: "compose" } : "invalid";
    default:
      return "invalid";
  }
}
