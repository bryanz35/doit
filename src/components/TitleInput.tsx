/** A one-line field for task titles, opened from the list's vim keys (`i`, `a`,
 *  `cc`, `o`, …). There is no mode inside it: it is the list's insert mode, so
 *  typing, IME and the clipboard are the plain `<input>`'s. Esc / Ctrl+[ and
 *  Enter go to the owner, which decides what each means; Ctrl+W and Ctrl+U
 *  delete back a word / to the start, as in vim's insert mode. The text belongs
 *  to the owner (`value`/`onChange`). */

import { useLayoutEffect, useRef, type KeyboardEvent } from "react";

/** Start of the word before `pos`, skipping blanks first — vim's Ctrl+W, where
 *  a run of letters/digits/_ and a run of other symbols are separate words. */
function prevWordStart(text: string, pos: number): number {
  const cls = (ch: string) => (/\s/.test(ch) ? 0 : /[\p{L}\p{N}_]/u.test(ch) ? 1 : 2);
  if (pos <= 0) return 0;
  let i = pos - 1;
  while (i > 0 && cls(text[i]) === 0) i--;
  const c = cls(text[i]);
  while (i > 0 && cls(text[i - 1]) === c) i--;
  return i;
}

export function TitleInput({
  value,
  onChange,
  at = "end",
  onEnter,
  onEscape,
  onBlur,
  label,
  placeholder,
  disabled,
  className,
}: {
  value: string;
  onChange: (value: string) => void;
  /** Where the caret starts: `i` opens at the start, `a` at the end. */
  at?: "start" | "end";
  onEnter: () => void;
  onEscape: () => void;
  onBlur?: () => void;
  label: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  // Where the caret goes after the next render — a controlled value that
  // changes under it otherwise sends the caret to the end.
  const caret = useRef<number | null>(at === "start" ? 0 : value.length);

  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input || caret.current === null) return;
    input.focus();
    input.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  }, [value]);

  // The owner disables the field while a command is in flight, which drops
  // focus; take it back once the field is live again.
  useLayoutEffect(() => {
    if (!disabled) inputRef.current?.focus();
  }, [disabled]);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing || event.metaKey || event.altKey) return;
    const input = event.currentTarget;
    const key = event.ctrlKey ? `<C-${event.key}>` : event.key;
    if (key === "Escape" || key === "<C-[>") {
      onEscape();
    } else if (key === "Enter") {
      onEnter();
    } else if (key === "<C-w>" || key === "<C-u>") {
      const end = input.selectionStart ?? input.value.length;
      const from = key === "<C-w>" ? prevWordStart(input.value, end) : 0;
      if (from < end) {
        caret.current = from;
        onChange(input.value.slice(0, from) + input.value.slice(end));
      }
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };

  return (
    <input
      ref={inputRef}
      className={className}
      aria-label={label}
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.currentTarget.value)}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    />
  );
}
