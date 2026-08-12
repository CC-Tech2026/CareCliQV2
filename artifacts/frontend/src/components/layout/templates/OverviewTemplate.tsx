/**
 * Archetype 1 — Overview (dashboards)
 *
 * Used by: dashboard.tsx (all role variants), hub landing pages.
 *
 * Anatomy:
 *   1. Greeting row (compact: date + role context)
 *   2. KPI strip slot
 *   3. Main content area  (left column on xl, full-width below)
 *   4. Today rail         (right column on xl via PageShell, stacked below on smaller)
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/layout/PageShell";

interface OverviewTemplateProps {
  /** Compact one-line header content (date, greeting, alert count). */
  header: React.ReactNode;
  /** KPI stat strip — rendered full-width above the two-column area. */
  kpiStrip?: React.ReactNode;
  /** Optional banners/notices rendered between kpiStrip and main columns. */
  banners?: React.ReactNode;
  /** Primary content (left column on xl). */
  children: React.ReactNode;
  /** Today panel / context rail (right column, sticky, xl only). */
  rail?: React.ReactNode;
  className?: string;
}

export function OverviewTemplate({
  header,
  kpiStrip,
  banners,
  children,
  rail,
  className,
}: OverviewTemplateProps) {
  return (
    <div className={cn("space-y-5 pb-8", className)}>
      {/* 1. Greeting / date row */}
      <div>{header}</div>

      {/* 2. KPI strip */}
      {kpiStrip && <div>{kpiStrip}</div>}

      {/* 3. Banners / notices */}
      {banners && <div className="space-y-3">{banners}</div>}

      {/* 4. Main + rail columns */}
      <PageShell rail={rail}>
        <div className="space-y-5">{children}</div>
      </PageShell>
    </div>
  );
}
