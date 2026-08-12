import * as React from "react"

import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"

/**
 * Shared stat display — replaces the ad-hoc StatStrip/StatCard pattern that had been
 * copy-pasted into compliance.tsx, reports.tsx, audit-pack.tsx, md/onboarding.tsx,
 * md/staff.tsx, and my-shift-briefing.tsx independently. One definition, one look.
 *
 * Value uses the Nunito display face per DESIGN_BRIEF.md ("large display numbers only —
 * compliance scores, big dashboard stats"). Colour on the value is opt-in via `tone` —
 * default stays navy; only set `tone` where the number itself carries meaning.
 */

export type StatTone = "neutral" | "success" | "warning" | "danger" | "info" | "brand"

const toneColour: Record<StatTone, string> = {
  neutral: "var(--cc-text)",
  success: "var(--cc-status-success)",
  warning: "var(--cc-status-warning)",
  danger: "var(--cc-status-danger)",
  info: "var(--cc-status-info)",
  brand: "var(--cc-plum)",
}

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: StatTone
}

const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ className, icon, label, value, sub, tone = "neutral", ...props }, ref) => (
    <div ref={ref} className={cn("flex items-center gap-2", className)} {...props}>
      {icon && (
        <span className="shrink-0" style={{ color: "var(--cc-muted)" }}>
          {icon}
        </span>
      )}
      <div className="min-w-0">
        <p
          className="text-[10px] font-bold uppercase tracking-wider leading-none"
          style={{ color: "var(--cc-muted)" }}
        >
          {label}
        </p>
        <p
          className="mt-0.5 text-lg leading-tight font-extrabold"
          style={{ color: toneColour[tone], fontFamily: "var(--app-font-stat)" }}
        >
          {value}
          {sub && (
            <span
              className="ml-1.5 text-[10px] font-medium"
              style={{ color: "var(--cc-muted)", fontFamily: "var(--app-font-sans)" }}
            >
              {sub}
            </span>
          )}
        </p>
      </div>
    </div>
  ),
)
StatCard.displayName = "StatCard"

/** Row wrapper — the "flat container, not a repeated card grid" strip used across the app. */
const StatCardGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, children, ...props }, ref) => {
    const items = React.Children.toArray(children)
    return (
      <div
        ref={ref}
        className={cn(
          "flex flex-wrap items-center gap-x-6 gap-y-2.5 rounded-xl border bg-card px-5 py-3",
          className,
        )}
        {...props}
      >
        {items.map((child, i) => (
          <div key={i} className="flex items-center gap-6">
            {i > 0 && <div className="h-7 w-px hidden sm:block" style={{ background: "var(--cc-border)" }} />}
            {child}
          </div>
        ))}
      </div>
    )
  },
)
StatCardGroup.displayName = "StatCardGroup"

/** Soft tint background to pair with a KPI/icon-badge foreground colour. */
function kpiTint(tone: StatTone): string {
  if (tone === "success") return "var(--cc-status-success-bg)"
  if (tone === "warning") return "var(--cc-status-warning-bg)"
  if (tone === "danger") return "var(--cc-status-danger-bg)"
  if (tone === "brand") return "var(--cc-plum-soft)"
  if (tone === "info") return "var(--cc-status-info-bg)"
  return "var(--cc-soft)"
}

export interface KpiCardProps {
  icon?: React.ReactElement<{ size?: number }>
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: StatTone
  className?: string
  /** Simpler label+number tile with no icon badge — used where the reference design calls for a flatter look (e.g. Compliance Centre). */
  flat?: boolean
}

/**
 * Elevated per-metric KPI card — the modern replacement for the flat StatCardGroup
 * strip on analytics-heavy pages (Compliance Centre, Audit Pack, Reports). Icon sits
 * in a soft-tinted rounded badge; use KpiGrid to lay several out responsively.
 */
const KpiCard = React.forwardRef<HTMLDivElement, KpiCardProps>(
  ({ className, icon, label, value, sub, tone = "neutral", flat = false, ...props }, ref) => (
    <Card ref={ref} className={cn("rounded-2xl border-0 shadow-sm p-4", className)} {...props}>
      {flat ? (
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider leading-tight" style={{ color: "var(--cc-muted)" }}>
            {label}
          </p>
          <p
            className="mt-1.5 text-[26px] leading-none font-extrabold truncate"
            style={{ color: toneColour[tone], fontFamily: "var(--app-font-stat)" }}
          >
            {value}
          </p>
          {sub && (
            <p className="mt-1.5 text-[11px] font-medium truncate" style={{ color: "var(--cc-muted)" }}>
              {sub}
            </p>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-3">
          {icon && (
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
              style={{ background: kpiTint(tone), color: toneColour[tone] }}
            >
              {React.cloneElement(icon, { size: icon.props.size ?? 19 })}
            </span>
          )}
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-wider leading-tight" style={{ color: "var(--cc-muted)" }}>
              {label}
            </p>
            <p
              className="mt-1 text-2xl leading-none font-extrabold truncate"
              style={{ color: toneColour[tone], fontFamily: "var(--app-font-stat)" }}
            >
              {value}
            </p>
            {sub && (
              <p className="mt-1 text-[10px] font-medium truncate" style={{ color: "var(--cc-muted)" }}>
                {sub}
              </p>
            )}
          </div>
        </div>
      )}
    </Card>
  ),
)
KpiCard.displayName = "KpiCard"

/** Responsive grid wrapper for KpiCard — 1 col on mobile, 2 on sm, 4 on lg. */
const KpiGrid = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn("grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4", className)} {...props} />
  ),
)
KpiGrid.displayName = "KpiGrid"

export { StatCard, StatCardGroup, KpiCard, KpiGrid, kpiTint, toneColour }
