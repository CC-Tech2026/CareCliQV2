import type { ReactNode } from "react";

/**
 * Contextual right rail (APPLAYOUT_REDESIGN_REFERENCE.md §4) — 280px, sticky,
 * hidden below `lg`. Phase 1 ships the shell only: AppLayout renders this when
 * a page passes `rightRail` content via its `rightRail` prop; pages that don't
 * pass anything simply don't reserve the space. Widget content (Quick facts,
 * Today panel, etc.) is wired in per-page during later migration phases.
 */
export function RightRail({ children }: { children: ReactNode }) {
  return (
    <aside
      className="hidden lg:block shrink-0 sticky top-14 overflow-y-auto scrollbar-none"
      style={{
        width: 280,
        height: "calc(100dvh - 3.5rem)",
        background: "var(--cc-bg)",
        borderLeft: "1px solid var(--cc-border)",
        padding: 16,
      }}
    >
      {children}
    </aside>
  );
}

/** A single rail card — the repeating widget pattern used inside RightRail. */
export function RailWidget({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div
      className="rounded-lg mb-3 p-3"
      style={{ background: "var(--cc-surface)", border: "1px solid var(--cc-border)" }}
    >
      {title && (
        <p
          className="text-[12px] font-medium mb-2"
          style={{ color: "var(--cc-text)", fontFamily: "var(--app-font-display)" }}
        >
          {title}
        </p>
      )}
      <div className="text-[12px]" style={{ color: "var(--cc-text)", lineHeight: 1.5 }}>
        {children}
      </div>
    </div>
  );
}
