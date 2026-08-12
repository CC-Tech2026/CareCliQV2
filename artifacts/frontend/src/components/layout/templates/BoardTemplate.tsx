/**
 * Archetype 5 — Board (dense operational surfaces)
 *
 * Used by: coordinator-rostering, coordinator-live, coordinator-shift-verification.
 *
 * Anatomy:
 *   - Full-width (no max-width cap, no context rail).
 *   - Compact sticky toolbar row: date range, view switcher, filters.
 *   - The board/calendar/timeline owns the remaining viewport height
 *     with internal scrolling.
 *
 * Density rules: whitespace intentionally tighter here than in other archetypes.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

// ── Toolbar ───────────────────────────────────────────────────────────────────

interface BoardToolbarProps {
  children: React.ReactNode;
  className?: string;
}

export function BoardToolbar({ children, className }: BoardToolbarProps) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 flex flex-wrap items-center gap-2 px-4 py-2.5 border-b",
        className,
      )}
      style={{
        background: "var(--cc-bg)",
        borderColor: "var(--cc-border)",
        backdropFilter: "blur(6px)",
      }}
    >
      {children}
    </div>
  );
}

// ── Main template ─────────────────────────────────────────────────────────────

interface BoardTemplateProps {
  toolbar: React.ReactNode;
  children: React.ReactNode;
  /** Minimum height for the board canvas (default: calc(100dvh - 120px)). */
  minHeight?: string;
  className?: string;
}

/**
 * Full-viewport-width board layout. Content fills the remaining height after
 * the toolbar and handles its own internal scroll.
 *
 * @example
 * <BoardTemplate toolbar={<BoardToolbar>...</BoardToolbar>}>
 *   <RosteringCalendar />
 * </BoardTemplate>
 */
export function BoardTemplate({
  toolbar,
  children,
  minHeight = "calc(100dvh - 120px)",
  className,
}: BoardTemplateProps) {
  return (
    <div className={cn("flex flex-col w-full", className)}>
      {toolbar}
      <div
        className="flex-1 overflow-auto"
        style={{ minHeight }}
      >
        {children}
      </div>
    </div>
  );
}
