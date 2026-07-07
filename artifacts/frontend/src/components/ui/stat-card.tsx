import * as React from "react"

import { cn } from "@/lib/utils"

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

export { StatCard, StatCardGroup }
