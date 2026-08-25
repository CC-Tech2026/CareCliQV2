"use client"

import * as React from "react"
import { format } from "date-fns"
import { CalendarIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { Calendar } from "@/components/ui/calendar"
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover"
import { TimePicker } from "@/components/ui/time-picker"

function splitLocalValue(value: string): { date: string; time: string } {
  const [date = "", time = ""] = value.split("T")
  return { date, time }
}

function dateFromParts(datePart: string): Date | undefined {
  if (!datePart) return undefined
  const [y, m, d] = datePart.split("-").map(Number)
  if (!y || !m || !d) return undefined
  return new Date(y, m - 1, d)
}

function partsFromDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, "0")
  const d = String(date.getDate()).padStart(2, "0")
  return `${y}-${m}-${d}`
}

export interface DateTimePickerProps {
  /** "yyyy-MM-ddTHH:mm", or "" when unset — same value shape as
   * `<input type="datetime-local">`, so this is a drop-in replacement. */
  value: string
  onChange: (value: string) => void
  className?: string
  disabled?: boolean
}

/** Date + time selection as two adjacent controls — the app's existing
 * Calendar date picker paired with the new TimePicker — matching the
 * two-separate-fields convention already used for date-only + time-only
 * forms elsewhere (see pages/session-new.tsx). */
export function DateTimePicker({ value, onChange, className, disabled }: DateTimePickerProps) {
  const [open, setOpen] = React.useState(false)
  const { date: datePart, time: timePart } = splitLocalValue(value)
  const selectedDate = dateFromParts(datePart)

  const commit = (nextDate: string, nextTime: string) => {
    if (!nextDate && !nextTime) {
      onChange("")
      return
    }
    onChange(`${nextDate}T${nextTime || "00:00"}`)
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={cn(
              "flex h-9 min-w-[128px] flex-1 basis-32 items-center gap-2 rounded-md border border-cc-border bg-cc-surface px-3 text-left text-sm text-cc-text shadow-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              !selectedDate && "text-cc-muted"
            )}
          >
            <CalendarIcon className="size-4 shrink-0 text-cc-muted" />
            <span className="truncate whitespace-nowrap">{selectedDate ? format(selectedDate, "d MMM yyyy") : "Select date"}</span>
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selectedDate}
            onSelect={(d) => {
              if (!d) return
              commit(partsFromDate(d), timePart)
              setOpen(false)
            }}
          />
        </PopoverContent>
      </Popover>
      <TimePicker
        value={timePart}
        onChange={(t) => commit(datePart || partsFromDate(new Date()), t)}
        disabled={disabled}
        className="min-w-[110px] flex-1 basis-28"
      />
    </div>
  )
}
