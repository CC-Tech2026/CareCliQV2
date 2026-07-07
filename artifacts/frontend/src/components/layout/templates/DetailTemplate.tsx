/**
 * Archetype 3 — Detail (single-record pages)
 *
 * Used by: participant detail, session-detail, incident-detail,
 *          my-shift-detail (coordinator version), team-member detail.
 *
 * Anatomy:
 *   1. Identity header: breadcrumb back-link, avatar/icon, name, status chips,
 *      primary + secondary action buttons — consistent height across all detail pages.
 *   2. Tab bar (tabs are routed URLs so the back button works).
 *   3. Content area with optional right context rail (via PageShell).
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/layout/PageShell";

// ── Identity header ───────────────────────────────────────────────────────────

interface DetailIdentityHeaderProps {
  /** Back-link breadcrumb (e.g. <Link href="/team">← Team</Link>). */
  breadcrumb?: React.ReactNode;
  /** Avatar or icon element (40–48px). */
  avatar?: React.ReactNode;
  /** Record name — rendered in Poppins bold. */
  title: string;
  /** Status chip(s) placed beside the title. */
  chips?: React.ReactNode;
  /** Single primary action (top-right). */
  primaryAction?: React.ReactNode;
  /** Secondary actions (placed beside primary). */
  secondaryActions?: React.ReactNode;
  className?: string;
}

export function DetailIdentityHeader({
  breadcrumb,
  avatar,
  title,
  chips,
  primaryAction,
  secondaryActions,
  className,
}: DetailIdentityHeaderProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {breadcrumb && (
        <div className="text-[12px] font-semibold" style={{ color: "var(--cc-muted)" }}>
          {breadcrumb}
        </div>
      )}
      <div className="flex items-center gap-3 justify-between flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          {avatar}
          <div className="min-w-0">
            <h1
              className="text-xl font-black tracking-tight truncate"
              style={{ fontFamily: "var(--app-font-display)", color: "var(--cc-text)" }}
            >
              {title}
            </h1>
            {chips && <div className="mt-1 flex flex-wrap gap-1.5">{chips}</div>}
          </div>
        </div>
        {(primaryAction || secondaryActions) && (
          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            {secondaryActions}
            {primaryAction}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab bar ───────────────────────────────────────────────────────────────────

interface DetailTab {
  id: string;
  label: string;
  href?: string;
}

interface DetailTabBarProps {
  tabs: DetailTab[];
  activeTab: string;
  onTabChange: (id: string) => void;
  className?: string;
}

export function DetailTabBar({ tabs, activeTab, onTabChange, className }: DetailTabBarProps) {
  return (
    <div
      className={cn("flex border-b overflow-x-auto scrollbar-none", className)}
      style={{ borderColor: "var(--cc-border)" }}
    >
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onTabChange(tab.id)}
            className="px-4 py-3 text-[13px] font-semibold whitespace-nowrap border-b-2 transition-colors shrink-0"
            style={{
              borderBottomColor: active ? "var(--cc-plum)" : "transparent",
              color: active ? "var(--cc-plum)" : "var(--cc-muted)",
            }}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Main template ─────────────────────────────────────────────────────────────

interface DetailTemplateProps {
  identityHeader: React.ReactNode;
  tabBar?: React.ReactNode;
  children: React.ReactNode;
  /** Quick facts / related items rail (xl only via PageShell). */
  rail?: React.ReactNode;
  className?: string;
}

export function DetailTemplate({
  identityHeader,
  tabBar,
  children,
  rail,
  className,
}: DetailTemplateProps) {
  return (
    <div className={cn("space-y-5 pb-10", className)}>
      {identityHeader}
      {tabBar}
      <PageShell rail={rail}>
        <div className="space-y-5">{children}</div>
      </PageShell>
    </div>
  );
}
