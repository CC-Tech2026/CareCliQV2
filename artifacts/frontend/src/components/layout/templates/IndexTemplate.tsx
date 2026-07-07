/**
 * Archetype 2 — Index (list pages)
 *
 * Used by: team, patients/participants, sessions, incidents, credentials,
 *          billing, approvals, tasks, reports (coordinator-facing only).
 *
 * Anatomy (top → bottom):
 *   1. Page header row: Poppins title + count badge, single right-aligned primary action
 *   2. Optional filter bar slot
 *   3. Content area (table or card grid)
 *
 * Never add a rail here — Index pages are full-width lists.
 */
import * as React from "react";
import { cn } from "@/lib/utils";

// ── Sub-components exported for composition ───────────────────────────────────

interface IndexHeaderProps {
  title: string;
  count?: number | null;
  /** Single primary action button — placed top-right. Keep to one. */
  primaryAction?: React.ReactNode;
  className?: string;
}

export function IndexHeader({ title, count, primaryAction, className }: IndexHeaderProps) {
  return (
    <div className={cn("flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        <h1
          className="text-xl font-black tracking-tight truncate"
          style={{ fontFamily: "var(--app-font-display)", color: "var(--cc-text)" }}
        >
          {title}
        </h1>
        {count != null && (
          <p className="mt-0.5 text-sm font-medium" style={{ color: "var(--cc-muted)" }}>
            {count} {count === 1 ? "record" : "records"}
          </p>
        )}
      </div>
      {primaryAction && <div className="shrink-0">{primaryAction}</div>}
    </div>
  );
}

interface IndexFilterBarProps {
  children: React.ReactNode;
  className?: string;
}

export function IndexFilterBar({ children, className }: IndexFilterBarProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {children}
    </div>
  );
}

interface IndexEmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: React.ReactNode;
}

export function IndexEmptyState({ icon, title, description, action }: IndexEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      {icon && (
        <div
          className="w-12 h-12 rounded-2xl flex items-center justify-center"
          style={{ background: "var(--cc-soft)" }}
        >
          {icon}
        </div>
      )}
      <p className="text-sm font-black" style={{ color: "var(--cc-text)" }}>{title}</p>
      {description && (
        <p className="text-xs max-w-xs leading-relaxed" style={{ color: "var(--cc-muted)" }}>
          {description}
        </p>
      )}
      {action}
    </div>
  );
}

export function IndexSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-14 rounded-xl"
          style={{ background: "var(--cc-soft)", opacity: 1 - i * 0.12 }}
        />
      ))}
    </div>
  );
}

// ── Main template ─────────────────────────────────────────────────────────────

interface IndexTemplateProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * Thin wrapper that provides consistent spacing and padding.
 * Compose with IndexHeader, IndexFilterBar, IndexEmptyState, IndexSkeleton.
 *
 * @example
 * <IndexTemplate>
 *   <IndexHeader title="Team" count={workers.length} primaryAction={<Button>Invite</Button>} />
 *   <IndexFilterBar><SearchInput /><FilterChips /></IndexFilterBar>
 *   {loading ? <IndexSkeleton /> : <WorkerTable workers={workers} />}
 * </IndexTemplate>
 */
export function IndexTemplate({ children, className }: IndexTemplateProps) {
  return (
    <div className={cn("space-y-5 pb-10", className)}>
      {children}
    </div>
  );
}
