import * as React from "react"
import { Link } from "wouter"

import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"

/** Makes a stat tile open whatever its number counts: a link when `href` is
 * set, a button when `onClick` is set, otherwise the tile is left as-is. */
function Interactive({
  href,
  onClick,
  label,
  className,
  children,
}: {
  href?: string
  onClick?: () => void
  label: string
  className?: string
  children: React.ReactNode
}) {
  const cls = cn(
    "block w-full text-left rounded-2xl transition hover:-translate-y-px hover:shadow-md",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cc-plum)] focus-visible:ring-offset-2",
    className,
  )
  if (href) {
    return (
      <Link href={href} className={cls} aria-label={label} data-stat-link="">
        {children}
      </Link>
    )
  }
  if (onClick) {
    return (
      <button type="button" onClick={onClick} className={cls} aria-label={label}>
        {children}
      </button>
    )
  }
  return <>{children}</>
}

function interactiveLabel(label: string, value: React.ReactNode): string {
  return typeof value === "string" || typeof value === "number" ? `${label}: ${value}` : label
}

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

export interface StatCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onClick"> {
  icon?: React.ReactNode
  label: string
  value: React.ReactNode
  sub?: React.ReactNode
  tone?: StatTone
  /** Opens the list behind this number. */
  href?: string
  onClick?: () => void
}

const StatCard = React.forwardRef<HTMLDivElement, StatCardProps>(
  ({ className, icon, label, value, sub, tone = "neutral", href, onClick, ...props }, ref) => (
    <Interactive href={href} onClick={onClick} label={interactiveLabel(label, value)} className="rounded-lg">
    <div ref={ref} className={cn("flex items-center gap-2", (href || onClick) && "cursor-pointer", className)} {...props}>
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
    </Interactive>
  ),
)
StatCard.displayName = "StatCard"

export interface StatCardGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Stretch items evenly across the full row instead of hugging the left edge — use on wide, low-item-count strips so the row doesn't end in a large empty gap. */
  fill?: boolean
}

/** Row wrapper — the "flat container, not a repeated card grid" strip used across the app. */
const StatCardGroup = React.forwardRef<HTMLDivElement, StatCardGroupProps>(
  ({ className, children, fill = false, ...props }, ref) => {
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
          <div key={i} className={cn("flex items-center gap-6", fill && "flex-1 min-w-[140px]")}>
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
  /** Opens the list behind this number. */
  href?: string
  onClick?: () => void
}

/**
 * Elevated per-metric KPI card — the modern replacement for the flat StatCardGroup
 * strip on analytics-heavy pages (Compliance Centre, Audit Pack, Reports). Icon sits
 * in a soft-tinted rounded badge; use KpiGrid to lay several out responsively.
 */
const KpiCard = React.forwardRef<HTMLDivElement, KpiCardProps>(
  ({ className, icon, label, value, sub, tone = "neutral", flat = false, href, onClick, ...props }, ref) => (
    <Interactive href={href} onClick={onClick} label={interactiveLabel(label, value)} className="h-full">
    <Card ref={ref} className={cn("rounded-2xl border-0 shadow-sm p-4", (href || onClick) && "h-full cursor-pointer", className)} {...props}>
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
    </Interactive>
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
