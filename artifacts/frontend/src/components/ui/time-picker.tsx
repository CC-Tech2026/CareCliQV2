"use client"

import * as React from "react"
import { Clock } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command"

/** Every quarter-hour of the day, "HH:mm" (24h) paired with its 12h display label. */
const TIME_OPTIONS: { value: string; label: string }[] = Array.from({ length: 96 }, (_, i) => {
  const hour = Math.floor(i / 4)
  const minute = (i % 4) * 15
  const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
  return { value, label: format12h(value) }
})

/** "14:30" -> "2:30 PM" */
export function format12h(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return ""
  const period = h >= 12 ? "PM" : "AM"
  const hour12 = h % 12 === 0 ? 12 : h % 12
  return `${hour12}:${String(m).padStart(2, "0")} ${period}`
}

/** Free-text time entry -> "HH:mm", or null if it doesn't parse. Accepts
 * "9", "9:07", "9:07am", "9:07 AM", "21:07", "2pm". */
function parseLenientTime(input: string): string | null {
  const s = input.trim().toLowerCase()
  if (!s) return null
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/)
  if (!m) return null
  let hour = parseInt(m[1], 10)
  const minute = m[2] ? parseInt(m[2], 10) : 0
  const period = m[3]
  if (minute > 59) return null
  if (period) {
    if (hour < 1 || hour > 12) return null
    if (period === "pm" && hour !== 12) hour += 12
    if (period === "am" && hour === 12) hour = 0
  } else if (hour > 23) {
    return null
  }
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

export interface TimePickerProps {
  /** "HH:mm" 24h, or "" when unset — same value shape as `<input type="time">`. */
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
  style?: React.CSSProperties
  disabled?: boolean
  id?: string
}

/** Searchable, scrollable time-of-day picker in a popover — a modern replacement
 * for the native `<input type="time">` control, in the same visual language as
 * the app's existing Calendar date picker. Suggests quarter-hour increments but
 * accepts any typed time via the "Use …" entry when it doesn't land on one. */
export function TimePicker({ value, onChange, placeholder = "Select time", className, style, disabled, id }: TimePickerProps) {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")

  const handleSelect = React.useCallback((next: string) => {
    onChange(next)
    setOpen(false)
    setSearch("")
  }, [onChange])

  const customValue = parseLenientTime(search)
  const showCustom = !!customValue && !TIME_OPTIONS.some((o) => o.value === customValue)

  return (
    <Popover open={open} onOpenChange={(next) => { setOpen(next); if (!next) setSearch("") }}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          disabled={disabled}
          style={style}
          className={cn(
            "flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-cc-border bg-cc-surface px-3 text-left text-sm text-cc-text shadow-sm transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            !value && "text-cc-muted",
            className
          )}
        >
          <Clock className="size-4 shrink-0 text-cc-muted" />
          <span className="truncate whitespace-nowrap">{value ? format12h(value) : placeholder}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[220px] p-0" align="start">
        <Command shouldFilter>
          <CommandInput
            placeholder="Type a time…"
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>No matching time.</CommandEmpty>
            {showCustom && customValue && (
              <CommandGroup>
                <CommandItem value={`custom-${customValue}`} onSelect={() => handleSelect(customValue)}>
                  Use &ldquo;{format12h(customValue)}&rdquo;
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup>
              {TIME_OPTIONS.map((opt) => (
                <CommandItem key={opt.value} value={opt.label} onSelect={() => handleSelect(opt.value)}>
                  {opt.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
