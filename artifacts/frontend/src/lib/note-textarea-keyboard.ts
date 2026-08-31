import type { KeyboardEvent } from "react";

type Options = {
  maxLength?: number;
  onSave: (value: string) => void;
  setValue: (next: string) => void;
};

/** Enter saves; Ctrl+Enter (or Cmd+Enter) inserts a line break. */
export function handleNoteTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>, options: Options) {
  const el = e.currentTarget;
  const value = el.value;

  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    const start = el.selectionStart ?? value.length;
    const end = el.selectionEnd ?? value.length;
    const nextValue = `${value.slice(0, start)}\n${value.slice(end)}`;
    const next = options.maxLength != null ? nextValue.slice(0, options.maxLength) : nextValue;
    options.setValue(next);
    const cursor = Math.min(start + 1, next.length);
    requestAnimationFrame(() => {
      el.selectionStart = el.selectionEnd = cursor;
    });
    return;
  }

  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    const next = options.maxLength != null ? value.slice(0, options.maxLength) : value;
    options.onSave(next.trim());
  }
}
