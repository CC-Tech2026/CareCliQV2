/**
 * The roster as a calendar: each day has its heading, with a column per
 * worker under it (open shifts first), the hours down the side, and each shift
 * a solid block as long as it runs. Grey is time the worker doesn't usually
 * work. One day fills the screen; a week or fortnight scrolls sideways, day
 * after day.
 *
 * - Drag a block to another worker on the same day to give it to them, or onto
 *   Open shifts to take its worker off. While dragging, each worker on that day
 *   says whether they're free for it, and their column shows where it'd sit.
 * - Click an empty time in a column (or a column's + button) to add a shift.
 *
 * Rendered inside RosterBoard's DndContext, so drops go through the board's
 * conflict checks.
 */
import {
  Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent,
} from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { format, parseISO } from "date-fns";
import { CalendarPlus, Moon, Plus } from "lucide-react";
import { appLocalDateKey, appMinutesOfDay } from "@/lib/datetime";
import type { CoordinatorShiftRecord, WorkerStats } from "@/services/coordinatorService";
import { PersonPhoto } from "@/components/ui/person-photo";
import { shortWorkerName } from "@/lib/person-identity";
import { ShiftHoverCard, shiftLiveStatus } from "./ShiftHoverCard";
import {
  FIT_COLORS,
  OPEN_ROW_ID,
  clock,
  dayAvailability,
  isOpenShift,
  type AvailabilityMap,
  type Fit,
} from "./rosterShared";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const DAY = 24 * 60;
/** An hour is 60px tall: a 4-hour shift is a block you can read and grab. */
const HOUR_PX = 60;
const MIN_PX = HOUR_PX / 60;
const GUTTER_PX = 60;
/** The day heading, then the worker headings under it. */
const DAY_HEAD_PX = 64;
const COL_HEAD_PX = 52;
/** Clicking an empty time picks the half hour under the pointer. */
const PICK = 30;
/** Moving or stretching a shift goes in quarter hours. */
export const SNAP = 15;
export const CALENDAR_MINUTE_PX = MIN_PX;

export function snapMinutes(minutes: number) {
  return Math.round(minutes / SNAP) * SNAP;
}

/** After a drag ends, the browser still sends a click to whatever is under
 *  the pointer; without this it would open "add a shift" on that column. */
export function swallowNextClick() {
  const stop = (e: MouseEvent) => { e.stopPropagation(); e.preventDefault(); };
  window.addEventListener("click", stop, { capture: true });
  window.setTimeout(() => window.removeEventListener("click", stop, { capture: true }), 0);
}

/** Solid block colours, white text on each. */
const BLOCK_COLORS: Record<string, string> = {
  unassigned: "#DC2626",
  scheduled: "#E8457A",
  offered: "#E8457A",
  in_progress: "#2563EB",
  clocked_in: "#2563EB",
  completed: "#15803D",
  cancelled: "#94A3B8",
};
export const CALENDAR_LEGEND = [
  { color: BLOCK_COLORS.unassigned, label: "Open shift" },
  { color: BLOCK_COLORS.scheduled, label: "Rostered" },
  { color: BLOCK_COLORS.in_progress, label: "On shift" },
  { color: BLOCK_COLORS.completed, label: "Done" },
  { color: "#D4D4D8", label: "Not usually working" },
];

/** Time a worker doesn't usually work: a grey that shows on light and dark. */
const UNAVAILABLE = "color-mix(in srgb, var(--cc-text) 8%, transparent)";

/** Hour lines, with a fainter half hour between, drawn over each column. */
const HOUR_LINES = [
  `repeating-linear-gradient(to bottom, ${BORDER} 0 1px, transparent 1px ${HOUR_PX}px)`,
  `repeating-linear-gradient(to bottom, transparent 0 ${HOUR_PX / 2}px, color-mix(in srgb, ${BORDER} 45%, transparent) ${HOUR_PX / 2}px ${HOUR_PX / 2 + 1}px, transparent ${HOUR_PX / 2 + 1}px ${HOUR_PX}px)`,
].join(", ");

interface Placed {
  shift: CoordinatorShiftRecord;
  start: number;
  end: number;
  lane: number;
  lanes: number;
}

/** Shifts that overlap sit side by side and share the column's width. */
export function layoutBlocks(items: Array<{ shift: CoordinatorShiftRecord; start: number; end: number }>): Placed[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const out: Placed[] = [];
  let group: Placed[] = [];
  let groupEnd = -1;
  const close = () => {
    const lanes = group.reduce((n, b) => Math.max(n, b.lane + 1), 1);
    group.forEach((b) => { b.lanes = lanes; });
    group = [];
  };
  for (const item of sorted) {
    if (item.start >= groupEnd && group.length) close();
    const laneEnds: number[] = [];
    group.forEach((b) => { laneEnds[b.lane] = Math.max(laneEnds[b.lane] ?? 0, b.end); });
    let lane = laneEnds.findIndex((end) => end === undefined || end <= item.start);
    if (lane === -1) lane = laneEnds.length;
    const block = { ...item, lane, lanes: 1 };
    group.push(block);
    out.push(block);
    groupEnd = Math.max(groupEnd, item.end);
  }
  if (group.length) close();
  return out;
}

function hoursText(minutes: number) {
  const h = minutes / 60;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

function humanise(value?: string | null) {
  if (!value) return "";
  const s = value.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

type ColumnLabel = { short: string; full: string; detail: string | null };

function minutesOf(shift: CoordinatorShiftRecord) {
  const start = appMinutesOfDay(shift.scheduled_start!, shift.timezone);
  const length = shift.scheduled_end
    ? Math.max(15, (new Date(shift.scheduled_end).getTime() - new Date(shift.scheduled_start!).getTime()) / 60_000)
    : 60;
  // An overnight shift stops at midnight here; the hover card has its end.
  return { start, end: Math.min(DAY, start + length) };
}

function ShiftBlock({
  block, onSelect, highlighted, dragging, editable, onResize, onResizingChange,
}: {
  /** Tells the column a stretch is under way, so it hides its "add a shift" hint. */
  onResizingChange: (resizing: boolean) => void;
  block: Placed;
  onSelect: () => void;
  highlighted: boolean;
  /** Any shift is being dragged. */
  dragging: boolean;
  /** Its times can still change: moved up or down, or stretched. */
  editable: boolean;
  /** The new end, in minutes from midnight (1440 is midnight after). */
  onResize: (endMinute: number) => void;
}) {
  const { shift } = block;
  const { attributes, listeners, setNodeRef, isDragging, transform } = useDraggable({ id: shift.id, data: { shift } });
  const [resizeEnd, setResizeEnd] = useState<number | null>(null);
  const open = isOpenShift(shift);
  const live = shiftLiveStatus(shift);
  const color = BLOCK_COLORS[open ? "unassigned" : shift.status ?? "scheduled"] ?? BLOCK_COLORS.scheduled;
  const end = resizeEnd ?? block.end;
  // Up or down moves it in quarter hours, within the day. A shift whose times
  // can't change only moves sideways (to another worker).
  const shiftBy = editable && transform
    ? Math.max(-block.start, Math.min(DAY - end, snapMinutes(transform.y / MIN_PX)))
    : 0;
  const height = (end - block.start) * MIN_PX;
  const times = `${clock(block.start + shiftBy)} – ${clock((end + shiftBy) % DAY)}`;

  const startResize = (e: ReactPointerEvent<HTMLSpanElement>) => {
    e.stopPropagation();
    e.preventDefault();
    const originY = e.clientY;
    let latest = block.end;
    onResizingChange(true);
    const move = (ev: PointerEvent) => {
      latest = Math.min(DAY, Math.max(block.start + SNAP, block.end + snapMinutes((ev.clientY - originY) / MIN_PX)));
      setResizeEnd(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      swallowNextClick();
      setResizeEnd(null);
      onResizingChange(false);
      if (latest !== block.end) onResize(latest);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const detail = open ? "Needs a worker" : shift.is_sleepover ? "Sleepover" : humanise(shift.duty_type || shift.shift_type);
  return (
    <ShiftHoverCard shift={shift} disabled={dragging || resizeEnd != null}>
      <div
        ref={setNodeRef}
        {...listeners}
        {...attributes}
        onClick={(e) => { e.stopPropagation(); onSelect(); }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onSelect(); } else listeners?.onKeyDown?.(e); }}
        aria-label={`${shift.participant_name || "Participant"}, ${open ? "open shift" : shift.worker_name || "worker"}, ${times}`}
        className={`group/block absolute cursor-grab select-none overflow-hidden rounded-md px-2 py-1.5 text-white shadow-sm transition-shadow hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum ${highlighted ? "outline-dashed outline-2 outline-offset-2 outline-[#E8457A]" : ""}`}
        style={{
          top: block.start * MIN_PX + 1,
          height: Math.max(22, height - 2),
          left: `calc(${(block.lane / block.lanes) * 100}% + 3px)`,
          width: `calc(${100 / block.lanes}% - 6px)`,
          background: color,
          opacity: live === "cancelled" ? 0.6 : 1,
          transform: transform ? `translate3d(${transform.x}px, ${shiftBy * MIN_PX}px, 0)` : undefined,
          zIndex: isDragging || resizeEnd != null ? 25 : 2,
          boxShadow: isDragging || resizeEnd != null ? "0 10px 24px rgba(26,26,46,0.28)" : undefined,
        }}
      >
        <span className="block truncate text-[12px] font-bold leading-tight" style={{ textDecoration: live === "cancelled" ? "line-through" : undefined }}>
          {shift.participant_name || "Participant"}
        </span>
        {height >= 38 && <span className="block truncate text-[11px] leading-snug opacity-95 tabular-nums">{times}</span>}
        {height >= 60 && detail && (
          <span className="mt-0.5 flex items-center gap-1 truncate text-[11px] leading-snug opacity-90">
            {shift.is_sleepover && <Moon size={11} className="shrink-0" />}
            {detail}
          </span>
        )}
        {resizeEnd != null && (
          <span className="absolute bottom-3.5 left-2 rounded bg-white/90 px-1.5 text-[11px] font-semibold tabular-nums" style={{ color }}>
            Ends {clock(resizeEnd % DAY)}
          </span>
        )}
        {editable && (
          <span
            role="presentation"
            title="Drag to change when it ends"
            onPointerDown={startResize}
            onClick={(e) => e.stopPropagation()}
            className="absolute inset-x-0 bottom-0 flex h-2.5 cursor-ns-resize items-center justify-center opacity-0 transition-opacity group-hover/block:opacity-100"
          >
            <span className="h-0.5 w-6 rounded-full bg-white/80" />
          </span>
        )}
      </div>
    </ShiftHoverCard>
  );
}

interface ColumnSpec {
  /** OPEN_ROW_ID or the worker's id. */
  id: string;
  dayKey: string;
  kind: "open" | "worker";
  worker?: WorkerStats;
  /** The first column of its day, which gets the heavier divider. */
  firstOfDay: boolean;
  blocks: Placed[];
  /** Grey spans: before and after usual hours, or the whole day. */
  greyed: Array<{ start: number; end: number }>;
  /** Shown at the top of a fully greyed day: "Not working", "On leave". */
  dayNote?: { text: string; leave: boolean };
}

function CalendarColumn({
  column, nowMin, canCreate, dropDisabled, fit, landing, own = false, newShiftId, onCreate, onSelect, dragging, canEditTimes, onResize,
}: {
  dragging: boolean;
  canEditTimes: (shift: CoordinatorShiftRecord) => boolean;
  onResize: (shift: CoordinatorShiftRecord, endMinute: number) => void;
  column: ColumnSpec;
  nowMin: number | null;
  canCreate: boolean;
  dropDisabled: boolean;
  fit?: Fit;
  /** While dragging over this column: where the shift would sit. */
  landing?: { start: number; end: number } | null;
  /** The dragged shift is already in this column (moving it up or down). */
  own?: boolean;
  newShiftId?: string | null;
  onCreate: (time: string) => void;
  onSelect: (shift: CoordinatorShiftRecord) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({
    id: `${column.id}|${column.dayKey}`,
    data: { workerId: column.id, dayIso: column.dayKey },
    disabled: dropDisabled,
  });
  const [hover, setHover] = useState<number | null>(null);
  const [resizing, setResizing] = useState(false);

  const minuteAt = (e: ReactMouseEvent<HTMLDivElement>) => {
    const top = e.currentTarget.getBoundingClientRect().top;
    return Math.min(DAY - PICK, Math.max(0, Math.floor((e.clientY - top) / MIN_PX / PICK) * PICK));
  };
  const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

  // Moving a shift up or down its own column doesn't light the column up.
  const over = isOver && !dropDisabled && !own;
  return (
    <div
      ref={setNodeRef}
      className="relative"
      style={{
        height: DAY * MIN_PX,
        borderLeft: column.firstOfDay ? "2px solid var(--cc-muted)" : `1px solid ${BORDER}`,
        background: over ? (fit ? FIT_COLORS[fit.tone].bg : "var(--cc-plum-soft)") : undefined,
        boxShadow: over && fit ? `inset 0 0 0 2px ${FIT_COLORS[fit.tone].border}` : undefined,
        cursor: canCreate ? "pointer" : undefined,
      }}
      onMouseMove={canCreate ? (e) => setHover(minuteAt(e)) : undefined}
      onMouseLeave={() => setHover(null)}
      onClick={canCreate ? (e) => onCreate(hhmm(minuteAt(e))) : undefined}
    >
      {!over && column.greyed.map((g, i) => (
        <div
          key={i}
          aria-hidden
          className="pointer-events-none absolute inset-x-0"
          style={{ top: g.start * MIN_PX, height: (g.end - g.start) * MIN_PX, background: UNAVAILABLE }}
        />
      ))}
      <div aria-hidden className="pointer-events-none absolute inset-0" style={{ backgroundImage: HOUR_LINES }} />
      {column.dayNote && (
        <div aria-hidden className="pointer-events-none sticky z-[1] flex justify-center px-1 pt-3" style={{ top: DAY_HEAD_PX + COL_HEAD_PX }}>
          <span
            className="truncate rounded-md px-2 py-1 text-[11px] font-semibold"
            style={column.dayNote.leave ? { background: "#4B5563", color: "#FFFFFF" } : { color: MUTED }}
          >
            {column.dayNote.text}
          </span>
        </div>
      )}
      {nowMin != null && (
        <span aria-hidden className="pointer-events-none absolute inset-x-0 z-[3] h-0.5" style={{ top: nowMin * MIN_PX, background: "#7C3AED" }} />
      )}
      {hover != null && !resizing && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-1 z-[1] flex items-center gap-1 overflow-hidden whitespace-nowrap rounded-md border border-dashed px-1.5 text-[11px] font-semibold"
          style={{ top: hover * MIN_PX + 1, height: PICK * MIN_PX - 2, borderColor: "var(--cc-text)", color: TEXT, background: "var(--cc-surface)" }}
        >
          <Plus size={11} className="shrink-0" /> {clock(hover)}
        </span>
      )}
      {over && landing && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-1 z-[4] rounded-md border-2 border-dashed"
          style={{
            top: landing.start * MIN_PX + 1,
            height: Math.max(22, (landing.end - landing.start) * MIN_PX - 2),
            borderColor: fit ? FIT_COLORS[fit.tone].fg : "#7C3AED",
            background: fit ? FIT_COLORS[fit.tone].bg : "var(--cc-plum-soft)",
            opacity: 0.9,
          }}
        />
      )}
      {column.blocks.map((block) => (
        <ShiftBlock
          key={block.shift.id}
          block={block}
          onSelect={() => onSelect(block.shift)}
          highlighted={newShiftId === block.shift.id}
          dragging={dragging}
          editable={canEditTimes(block.shift)}
          onResize={(endMinute) => onResize(block.shift, endMinute)}
          onResizingChange={setResizing}
        />
      ))}
    </div>
  );
}

export function RosterCalendar({
  dayKeys, workers, labels, shifts, availMap, allowCreate, newShiftId, activeShift, fits, onCreateAt, onSelect, onOpenDay,
  canEditTimes, onResize,
}: {
  /** Each worker's column heading, from rosterLabels over the whole team:
   *  a short name that's unique, and a staff ID or suburb for shared names. */
  labels?: Map<string, ColumnLabel>;
  /** Whether a shift's times can still change (it hasn't started, isn't done or cancelled). */
  canEditTimes: (shift: CoordinatorShiftRecord) => boolean;
  /** Its bottom edge was dragged: the shift's day and the new end in minutes (1440 = midnight after). */
  onResize: (shift: CoordinatorShiftRecord, dayKey: string, endMinute: number) => void;
  /** yyyy-MM-dd for each day on screen: one, seven or fourteen. */
  dayKeys: string[];
  workers: WorkerStats[];
  shifts: CoordinatorShiftRecord[];
  availMap: AvailabilityMap;
  allowCreate: boolean;
  newShiftId?: string | null;
  /** The shift being dragged, if any. */
  activeShift: CoordinatorShiftRecord | null;
  /** While dragging: how each worker suits it. */
  fits: Map<string, Fit>;
  /** A worker (null for an open shift), the day, and "HH:MM". */
  onCreateAt: (worker: WorkerStats | null, dateKey: string, time: string) => void;
  onSelect: (shift: CoordinatorShiftRecord) => void;
  /** Several days: a day's heading opens it on its own. */
  onOpenDay?: (dateKey: string) => void;
}) {
  const oneDay = dayKeys.length === 1;

  // The "now" line moves once a minute.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(t);
  }, []);
  const todayKey = appLocalDateKey(now.toISOString());
  const nowMin = appMinutesOfDay(now.toISOString());

  const placed = useMemo(() => {
    const keys = new Set(dayKeys);
    return shifts
      .filter((s) => s.scheduled_start && keys.has(appLocalDateKey(s.scheduled_start, s.timezone)))
      .map((s) => ({ shift: s, day: appLocalDateKey(s.scheduled_start!, s.timezone), ...minutesOf(s) }));
  }, [shifts, dayKeys]);

  const days = useMemo(
    () =>
      dayKeys.map((dayKey) => {
        const today = placed.filter((p) => p.day === dayKey);
        const open: ColumnSpec = {
          id: OPEN_ROW_ID,
          dayKey,
          kind: "open",
          firstOfDay: true,
          blocks: layoutBlocks(today.filter((p) => isOpenShift(p.shift))),
          greyed: [],
        };
        const people = workers.map((w): ColumnSpec => {
          const usual = dayAvailability(availMap[w.id], dayKey);
          const wholeDay = usual.state === "leave" || usual.state === "off";
          return {
            id: w.id,
            dayKey,
            kind: "worker",
            worker: w,
            firstOfDay: false,
            blocks: layoutBlocks(today.filter((p) => p.shift.worker_id === w.id)),
            greyed: wholeDay
              ? [{ start: 0, end: DAY }]
              : usual.start != null && usual.end != null
                ? [{ start: 0, end: usual.start }, { start: usual.end, end: DAY }]
                : [],
            // A day off already says "Off" under their name; leave keeps its dark tag.
            dayNote: usual.state === "leave" ? { text: oneDay ? usual.text : "Leave", leave: true } : undefined,
          };
        });
        return { dayKey, columns: [open, ...people] };
      }),
    [dayKeys, placed, workers, availMap, oneDay],
  );
  const columns = days.flatMap((d) => d.columns);

  // Open at 6am (or the hour of an earlier shift), on today when it's on screen.
  const scroller = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const earliest = placed.reduce((m, p) => Math.min(m, p.start), 6 * 60);
    el.scrollTop = Math.max(0, Math.floor(earliest / 60) * HOUR_PX - 8);
    const todayHead = el.querySelector<HTMLElement>(`[data-day-head="${todayKey}"]`);
    // Measured against the calendar itself (offsetLeft counts from the page,
    // so the sidebar's width pushed today too far left, under the hours).
    el.scrollLeft = !oneDay && todayHead
      ? Math.max(0, todayHead.getBoundingClientRect().left - el.getBoundingClientRect().left + el.scrollLeft - GUTTER_PX)
      : 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayKeys[0], dayKeys.length]);

  const draggingDay = activeShift?.scheduled_start ? appLocalDateKey(activeShift.scheduled_start, activeShift.timezone) : null;
  const landing = useMemo(() => (activeShift?.scheduled_start ? minutesOf(activeShift) : null), [activeShift]);
  const colWidth = oneDay ? "minmax(150px, 1fr)" : dayKeys.length > 7 ? "104px" : "120px";
  const gridColumns = `${GUTTER_PX}px repeat(${columns.length}, ${colWidth})`;

  return (
    // `isolate` keeps the sticky headings' stacking inside the calendar, so the
    // page's own menus (profile, notifications) open over it, not under it.
    <div ref={scroller} role="region" aria-label="Roster calendar" className="isolate max-h-[72vh] overflow-auto rounded-2xl border bg-cc-surface" style={{ borderColor: BORDER }}>
      <div className="grid" style={{ gridTemplateColumns: gridColumns, width: "max-content", minWidth: "100%" }}>
        {/* Day headings, each over its own columns. */}
        <div className="sticky left-0 top-0 z-50 border-b bg-cc-surface" style={{ height: DAY_HEAD_PX, borderColor: BORDER }} />
        {days.map(({ dayKey, columns: dayColumns }) => {
          const d = parseISO(dayKey);
          const isToday = dayKey === todayKey;
          const open = dayColumns[0].blocks.length;
          const heading = (
            <>
              <span className="block text-[13px] font-semibold" style={{ color: isToday ? "#7C3AED" : TEXT }}>{format(d, "EEEE")}</span>
              <span className="block text-[22px] font-bold leading-tight tabular-nums" style={{ color: isToday ? "#7C3AED" : TEXT }}>{format(d, "d")}</span>
            </>
          );
          return (
            <div
              key={dayKey}
              data-day-head={dayKey}
              className="sticky top-0 z-40 flex items-center justify-center border-b px-2 text-center"
              style={{
                gridColumn: `span ${dayColumns.length}`,
                height: DAY_HEAD_PX,
                borderColor: BORDER,
                borderLeft: "2px solid var(--cc-muted)",
                background: isToday ? "var(--cc-today-header)" : "var(--cc-grid-header)",
              }}
            >
              {onOpenDay && !oneDay ? (
                <button
                  type="button"
                  onClick={() => onOpenDay(dayKey)}
                  aria-label={`Open ${format(d, "EEEE d MMMM")} as a day calendar`}
                  title="See just this day"
                  className="rounded-lg px-3 py-0.5 transition-colors hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
                >
                  {heading}
                </button>
              ) : (
                <div>{heading}</div>
              )}
              {open > 0 && (
                <span className="absolute right-2 top-2 rounded-full px-1.5 text-[10.5px] font-semibold" style={{ background: "var(--cc-status-danger-bg)", color: "var(--cc-danger-text)" }}>
                  {open} open
                </span>
              )}
            </div>
          );
        })}

        {/* Who each column is: their usual hours, or while dragging, whether they're free. */}
        <div className="sticky left-0 z-50 border-b bg-cc-surface" style={{ top: DAY_HEAD_PX, height: COL_HEAD_PX, borderColor: BORDER }} />
        {columns.map((c) => {
          const d = parseISO(c.dayKey);
          const fit = c.kind === "worker" && draggingDay === c.dayKey ? fits.get(c.id) : undefined;
          const minutes = c.blocks.reduce((n, b) => n + (b.end - b.start), 0);
          const usual = c.worker ? dayAvailability(availMap[c.worker.id], c.dayKey) : null;
          const label = c.worker ? labels?.get(c.worker.id) ?? { short: shortWorkerName(c.worker.full_name), full: c.worker.full_name, detail: null } : null;
          const name = c.kind === "open" ? (oneDay ? "Open shifts" : "Open") : oneDay ? label!.full : label!.short;
          const subline = c.kind === "open"
            ? c.blocks.length ? `${c.blocks.length} to fill` : oneDay ? "None to fill" : ""
            : [
                // Tells two people with the same name apart before anything else.
                label?.detail ?? null,
                usual?.state === "free" && usual.start != null ? usual.text : usual?.state === "leave" ? "On leave" : usual?.state === "off" ? "Off" : null,
                oneDay && minutes ? `${hoursText(minutes)} rostered` : null,
              ].filter(Boolean).join(" · ");
          const canCreateHere = allowCreate && c.dayKey >= todayKey;
          const addLabel = c.kind === "open"
            ? `Add an open shift on ${format(d, "EEEE d MMMM")}`
            : `Add a shift for ${c.worker!.full_name} on ${format(d, "EEEE d MMMM")}`;
          return (
            <div
              key={`${c.id}|${c.dayKey}`}
              className={`group/head sticky z-30 flex min-w-0 items-center gap-2 border-b bg-cc-surface ${oneDay ? "px-2.5" : "justify-center px-1.5 text-center"}`}
              style={{ top: DAY_HEAD_PX, height: COL_HEAD_PX, borderColor: BORDER, borderLeft: c.firstOfDay ? "2px solid var(--cc-muted)" : `1px solid ${BORDER}` }}
            >
              {oneDay && (c.kind === "open" ? (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--cc-status-danger-bg)", color: "var(--cc-danger-text)" }} aria-hidden>
                  <CalendarPlus size={15} />
                </span>
              ) : (
                <PersonPhoto name={c.worker!.full_name} photoUrl={c.worker!.profile_photo_url} size={32} />
              ))}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold leading-tight" style={{ color: TEXT }} title={label ? [label.full, label.detail].filter(Boolean).join(" · ") : undefined}>{name}</p>
                {fit ? (
                  <span
                    className="mt-0.5 inline-block max-w-full truncate rounded px-1.5 text-[10.5px] font-semibold leading-[18px]"
                    style={{ background: FIT_COLORS[fit.tone].bg, color: FIT_COLORS[fit.tone].fg, boxShadow: `inset 0 0 0 1px ${FIT_COLORS[fit.tone].border}` }}
                  >
                    {fit.label}
                  </span>
                ) : subline ? (
                  <p className="truncate text-[11px] leading-snug" style={{ color: c.kind === "open" && c.blocks.length ? "var(--cc-danger-text)" : MUTED }}>{subline}</p>
                ) : null}
              </div>
              {canCreateHere && (
                <button
                  type="button"
                  aria-label={addLabel}
                  title={addLabel}
                  onClick={() => onCreateAt(c.kind === "open" ? null : c.worker!, c.dayKey, "09:00")}
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full transition-opacity hover:bg-cc-soft focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum [@media(hover:hover)]:opacity-0 group-hover/head:opacity-100"
                  style={{ color: MUTED }}
                >
                  <Plus size={13} />
                </button>
              )}
            </div>
          );
        })}

        {/* Hours down the side, then the columns. */}
        <div className="sticky left-0 z-20 bg-cc-surface" style={{ height: DAY * MIN_PX }}>
          {Array.from({ length: 24 }, (_, h) => (
            <span
              key={h}
              aria-hidden
              className="absolute right-2.5 -translate-y-1/2 whitespace-nowrap text-[11.5px] font-medium tabular-nums"
              style={{ top: h * HOUR_PX, color: MUTED, display: h === 0 ? "none" : undefined }}
            >
              {clock(h * 60)}
            </span>
          ))}
        </div>
        {days.map(({ dayKey, columns: dayColumns }) => (
          <Fragment key={dayKey}>
            {dayColumns.map((c) => {
              const otherDay = draggingDay != null && draggingDay !== dayKey;
              // The dragged shift's own column: the same worker, or open shifts.
              const sameColumn = activeShift != null && (c.kind === "open" ? isOpenShift(activeShift) : activeShift.worker_id === c.id);
              return (
                <CalendarColumn
                  key={`${c.id}|${dayKey}`}
                  column={c}
                  nowMin={dayKey === todayKey ? nowMin : null}
                  canCreate={allowCreate && dayKey >= todayKey && activeShift == null}
                  // On its own day a shift moves to another worker or up and down;
                  // to another day it moves in its own column (from today on).
                  dropDisabled={otherDay && !(sameColumn && dayKey >= todayKey && canEditTimes(activeShift!))}
                  fit={c.kind === "worker" && !otherDay ? fits.get(c.id) : undefined}
                  landing={c.kind === "worker" && c.id !== activeShift?.worker_id ? landing : null}
                  own={sameColumn && !otherDay}
                  newShiftId={newShiftId}
                  dragging={activeShift != null}
                  canEditTimes={canEditTimes}
                  onResize={(shift, endMinute) => onResize(shift, dayKey, endMinute)}
                  onCreate={(time) => onCreateAt(c.kind === "open" ? null : c.worker!, dayKey, time)}
                  onSelect={onSelect}
                />
              );
            })}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
