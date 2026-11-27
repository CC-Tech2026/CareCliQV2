import { useMemo, useState } from "react";
import { format } from "date-fns";
import { AlertTriangle, ArrowRight, CalendarIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TimePicker, format12h } from "@/components/ui/time-picker";
import {
  addDaysToKey,
  buildShiftRange,
  lengthLabel,
  minutesOf,
  splitShiftTimes,
  timeOf,
} from "@/lib/shift-time";
import { cn } from "@/lib/utils";

const LENGTHS = [60, 120, 180, 240, 360, 480];

function dayDate(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function dayLabel(day: string) {
  return format(dayDate(day), "EEE d MMM");
}

/**
 * Change a shift's day and times: a date, a start and an end on the
 * participant's clock, with quick lengths and quick days. Moving the start
 * keeps the length. Says the new time in words next to the old one, and
 * shows a clash for the worker before anything is saved.
 */
export function ShiftTimeEditor({
  startIso,
  endIso,
  timezone,
  saving,
  problem,
  onSave,
  onCancel,
}: {
  startIso: string;
  endIso: string;
  timezone?: string | null;
  saving?: boolean;
  /** A clash or error to show before saving, e.g. the worker's other shift. */
  problem?: string | null;
  onSave: (startIso: string, endIso: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const before = useMemo(() => splitShiftTimes(startIso, endIso, timezone), [startIso, endIso, timezone]);
  const [day, setDay] = useState(before.day);
  const [start, setStart] = useState(before.start);
  const [end, setEnd] = useState(before.end);
  const [dateOpen, setDateOpen] = useState(false);

  const range = buildShiftRange(day, start, end, timezone);
  const length = range?.minutes ?? 0;
  const unchanged = day === before.day && start === before.start && end === before.end;
  const tooLong = length > 24 * 60;
  const invalid = !range || length <= 0 || tooLong;

  // Moving the start keeps the shift the same length.
  const changeStart = (next: string) => {
    const keep = range ? range.minutes : minutesOf(end) - minutesOf(start);
    setStart(next);
    if (keep > 0) setEnd(timeOf(minutesOf(next) + keep));
  };

  const was = `${dayLabel(before.day)}, ${format12h(before.start)} to ${format12h(before.end)}`;
  const now = range
    ? `${dayLabel(day)}, ${format12h(start)} to ${format12h(end)}${range.overnight ? " (next day)" : ""}`
    : "";

  return (
    <div className="space-y-4 rounded-xl border border-cc-border p-4">
      <div className="space-y-1.5">
        <p className="text-sm font-medium text-cc-text">Day</p>
        <div className="flex flex-wrap items-center gap-2">
          <Popover open={dateOpen} onOpenChange={setDateOpen}>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="flex h-10 md:h-8 min-w-[170px] items-center gap-2 rounded-lg border border-cc-border bg-cc-surface px-3 text-left text-sm text-cc-text hover:bg-cc-soft"
              >
                <CalendarIcon className="size-4 shrink-0 text-cc-muted" aria-hidden />
                {format(dayDate(day), "EEE d MMM yyyy")}
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-0" align="start">
              <Calendar
                mode="single"
                selected={dayDate(day)}
                defaultMonth={dayDate(day)}
                onSelect={(d) => {
                  if (!d) return;
                  setDay(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
                  setDateOpen(false);
                }}
              />
            </PopoverContent>
          </Popover>
          <button type="button" onClick={() => setDay(addDaysToKey(day, 1))} className="h-10 md:h-8 rounded-full border border-cc-border px-3 text-xs font-semibold text-cc-text hover:bg-cc-soft">
            Day after
          </button>
          <button type="button" onClick={() => setDay(addDaysToKey(day, 7))} className="h-10 md:h-8 rounded-full border border-cc-border px-3 text-xs font-semibold text-cc-text hover:bg-cc-soft">
            A week later
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-cc-text">Starts</label>
          <TimePicker value={start} onChange={changeStart} />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-cc-text">Ends</label>
          <TimePicker value={end} onChange={setEnd} />
        </div>
      </div>

      <div className="space-y-1.5">
        <p className="text-sm font-medium text-cc-text">
          Length <span className="font-normal text-cc-muted">{length > 0 ? lengthLabel(length) : ""}</span>
        </p>
        <div className="flex flex-wrap gap-1.5">
          {LENGTHS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setEnd(timeOf(minutesOf(start) + m))}
              aria-pressed={length === m}
              className={cn(
                "h-8 rounded-full border px-3 text-xs font-semibold transition-colors",
                length === m
                  ? "border-[var(--cc-cta)] bg-[var(--cc-cta)] text-white"
                  : "border-cc-border text-cc-text hover:bg-cc-soft",
              )}
            >
              {lengthLabel(m)}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg bg-cc-soft px-3 py-2.5 text-sm" aria-live="polite">
        <p className="text-cc-muted">Was {was}</p>
        {!unchanged && now ? (
          <p className="mt-0.5 flex items-start gap-1.5 font-semibold text-cc-text">
            <ArrowRight className="mt-0.5 size-4 shrink-0" aria-hidden /> {now}
          </p>
        ) : null}
        {tooLong ? <p className="mt-1 text-red-700">A shift can't be longer than 24 hours.</p> : null}
      </div>

      {problem ? (
        <p role="alert" className="flex items-start gap-1.5 rounded-lg bg-[var(--cc-status-danger-bg)] px-3 py-2.5 text-sm text-[var(--cc-danger-text)]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden /> {problem}
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving} busyOnClick={false}>
          Keep the old time
        </Button>
        <Button
          type="button"
          disabled={invalid || unchanged}
          loading={saving}
          onClick={() => (range ? onSave(range.startIso, range.endIso) : undefined)}
        >
          Save new time
        </Button>
      </div>
    </div>
  );
}
