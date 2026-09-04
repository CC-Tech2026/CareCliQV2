"use client"

import { cn } from "@/lib/utils"

export interface DurationQuickPicksProps {
  /** Hours offered as one-tap options, e.g. [4, 5, 6, 8]. */
  options?: number[]
  /** Called with the number of hours the user picked — the caller owns the
   * actual start+duration -> end date/time math, since that differs between
   * a full datetime value and a plain "HH:mm" time-of-day value. */
  onSelect: (hours: number) => void
  /** The currently-implied duration (end - start), if one can be computed,
   * so the matching pill can be highlighted as active. */
  activeHours?: number | null
  disabled?: boolean
  className?: string
}

/** A row of one-tap shift-duration buttons ("4h", "5h", "6h", "8h") that
 * compute the end time from the start time, instead of making the user pick
 * a second date/time by hand for the (very common) fixed-length-shift case. */
export function DurationQuickPicks({
  options = [4, 5, 6, 8],
  onSelect,
  activeHours = null,
  disabled,
  className,
}: DurationQuickPicksProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      <span className="text-[11px] font-semibold text-cc-muted">Shift length</span>
      {options.map((hours) => (
        <button
          key={hours}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(hours)}
          className={cn(
            "h-6 rounded-full border border-cc-border px-2.5 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            hours === activeHours
              ? "border-transparent bg-primary text-primary-foreground"
              : "bg-cc-surface text-cc-text hover:bg-accent/50"
          )}
        >
          {hours}h
        </button>
      ))}
    </div>
  )
}
