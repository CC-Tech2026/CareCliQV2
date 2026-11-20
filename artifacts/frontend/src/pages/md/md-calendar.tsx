import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Redirect, useLocation, useSearch } from "wouter";
import {
  format, parseISO, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, isSameMonth, isToday, addMonths, subMonths, addDays,
} from "date-fns";
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, MapPin, Clock,
  ClipboardCheck, BookOpen, Users, Target, Briefcase, Video, Mic, UserRound, HeartHandshake,
} from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { PageHeader, ctaClass, outlineClass } from "@/components/layout/PageKit";
import { SidePanel } from "@/components/layout/SidePanel";
import { MeetingBookingSheet, type BookingDraft } from "@/components/calendar/MeetingBookingSheet";
import { MeetingDetailSheet } from "@/components/calendar/MeetingDetailSheet";
import { MEETING_CHOICES, MEETING_MODES, choiceOf, inviteSummary, isOnlineMode, parseDurationMinutes } from "@/lib/meeting-booking";
import {
  getOrgEvents, createOrgEvent, updateOrgEvent, deleteOrgEvent,
  type OrgEvent, type OrgEventPayload,
} from "@/services/hubService";
import { listCoordinatorShifts, type CoordinatorShiftRecord } from "@/services/coordinatorService";
import { appLocalDateKey, appNow, appTodayKey, displayDate, isOtherBranchZone, zoneAbbreviation, zonedDate } from "@/lib/datetime";

/** A calendar day (built from a yyyy-MM-dd key) is today in the business location. */
const isAppToday = (day: Date) => format(day, "yyyy-MM-dd") === appTodayKey();
import { useToast } from "@/hooks/use-toast";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const PURPLE = "var(--cc-brand-purple)";

type EventType = "audit" | "training" | "meeting" | "review";
type ViewMode = "month" | "week" | "day";

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "week", label: "Week" },
  { id: "day", label: "Day" },
];

// Hour-grid window for Week/Day views — 6am to 10pm covers the working day
// with room either side; the grid itself scrolls if a shift/meeting falls
// outside it. HOUR_PX is the pixel height of one hour row.
const HOUR_START = 6;
const HOUR_END = 22;
const HOUR_PX = 56;
const GRID_HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
const GRID_HEIGHT = (HOUR_END - HOUR_START) * HOUR_PX;

/** A soft background in the given colour that works in both themes. */
const tint = (color: string) => `color-mix(in srgb, ${color} 12%, var(--cc-surface))`;

// Four kinds of thing, four colours, same as the legend: shifts in the info
// blue, unfilled shifts in amber (they need someone), meetings with a
// participant in CareCliQ Purple, and the organisation's own meetings,
// training, audits and reviews in navy.
type Tone = { fg: string; bg: string };
const TONES = {
  shift: { fg: "var(--cc-sky)", bg: tint("var(--cc-sky)") },
  unfilled: { fg: "var(--cc-amber)", bg: tint("var(--cc-amber)") },
  participant: { fg: PURPLE, bg: tint(PURPLE) },
  internal: { fg: TEXT, bg: "var(--cc-soft)" },
  cancelled: { fg: MUTED, bg: "var(--cc-soft)" },
} satisfies Record<string, Tone>;

const LEGEND: { label: string; tone: Tone }[] = [
  { label: "Shift", tone: TONES.shift },
  { label: "Unfilled shift", tone: TONES.unfilled },
  { label: "Participant meeting", tone: TONES.participant },
  { label: "Internal", tone: TONES.internal },
];

const EVENT_ICONS: Record<EventType, typeof Users> = {
  audit: ClipboardCheck,
  training: BookOpen,
  meeting: Users,
  review: Target,
};

function eventTone(ev: OrgEvent): Tone {
  return ev.meeting_kind || ev.participant_id ? TONES.participant : TONES.internal;
}

function eventIcon(ev: OrgEvent) {
  return ev.meeting_kind || ev.participant_id ? HeartHandshake : EVENT_ICONS[ev.event_type] ?? Users;
}

/** A shift is vacant when no worker is attached. Used here only to colour it. */
function isVacantShift(s: CoordinatorShiftRecord) {
  return !s.worker_id || s.status === "unassigned";
}

function isCancelledShift(s: CoordinatorShiftRecord) {
  return s.status === "cancelled";
}

/** Cancelled shifts stay on the calendar, greyed out, so a gap is explained. */
function shiftTone(s: CoordinatorShiftRecord): Tone {
  if (isCancelledShift(s)) return TONES.cancelled;
  return isVacantShift(s) ? TONES.unfilled : TONES.shift;
}

function shiftKind(s: CoordinatorShiftRecord): string {
  if (isCancelledShift(s)) return "Cancelled shift";
  return isVacantShift(s) ? "Unfilled shift" : "Shift";
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}
function minutesToHHMM(mins: number): string {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, mins));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function formatHourLabel(h: number): string {
  const period = h < 12 ? "am" : "pm";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12}${period}`;
}
/** "9:30am", the way times read across the calendar. */
function clock(d: Date): string {
  return format(d, "h:mmaaa").toLowerCase();
}
function clockFromHHMM(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date();
  d.setHours(h || 0, m || 0, 0, 0);
  return clock(d);
}
/** Grid pixels from the top of the hour grid for a given "HH:MM" time-of-day. */
function timeTopPx(hhmm: string): number {
  const mins = hhmmToMinutes(hhmm) - HOUR_START * 60;
  return Math.max(0, Math.min(GRID_HEIGHT, (mins / 60) * HOUR_PX));
}
/** On the shift's own clock (its participant's branch), with the zone when
 * that isn't the director's business location. */
function shiftTimes(s: CoordinatorShiftRecord): string {
  if (!s.scheduled_start) return "No time set";
  const start = clock(zonedDate(s.scheduled_start, s.timezone));
  const range = s.scheduled_end ? `${start} to ${clock(zonedDate(s.scheduled_end, s.timezone))}` : start;
  return isOtherBranchZone(s.timezone) ? `${range} ${zoneAbbreviation(s.scheduled_start, s.timezone)}` : range;
}

/** A row in the day list: a coloured edge for the kind, then what and when. */
function AgendaItem({
  tone,
  kind,
  title,
  meta,
  onOpen,
  struck = false,
}: {
  tone: Tone;
  kind: string;
  title: string;
  meta: React.ReactNode;
  onOpen: () => void;
  struck?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-stretch gap-3 rounded-xl p-2.5 text-left transition-colors hover:bg-cc-soft"
    >
      <span className="w-1 shrink-0 rounded-full" style={{ background: tone.fg }} />
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-medium" style={{ color: tone.fg }}>{kind}</span>
        <span className={`block truncate text-sm font-medium ${struck ? "line-through" : ""}`} style={{ color: struck ? MUTED : TEXT }}>{title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs" style={{ color: MUTED }}>{meta}</span>
      </span>
    </button>
  );
}

function EventItem({ ev, onOpen }: { ev: OrgEvent; onOpen: () => void }) {
  const online = isOnlineMode(ev.meeting_mode);
  return (
    <AgendaItem
      tone={eventTone(ev)}
      kind={MEETING_CHOICES[choiceOf(ev)]?.label ?? "Meeting"}
      title={ev.title}
      onOpen={onOpen}
      meta={
        <>
          <span className="flex items-center gap-1"><Clock size={12} /> {ev.start_time ? `${clockFromHHMM(ev.start_time)} · ${ev.duration}` : ev.duration}</span>
          {online && ev.meeting_mode && <span className="flex items-center gap-1"><Video size={12} /> {MEETING_MODES[ev.meeting_mode].label}</span>}
          {!online && ev.location && <span className="flex min-w-0 items-center gap-1"><MapPin size={12} className="shrink-0" /> <span className="truncate">{ev.location}</span></span>}
          {ev.easy_capture && <span className="flex items-center gap-1"><Mic size={12} /> Easy Capture</span>}
        </>
      }
    />
  );
}

function ShiftItem({ s, onOpen }: { s: CoordinatorShiftRecord; onOpen: () => void }) {
  const vacant = isVacantShift(s) && !isCancelledShift(s);
  return (
    <AgendaItem
      tone={shiftTone(s)}
      kind={shiftKind(s)}
      title={s.participant_name || "Participant"}
      onOpen={onOpen}
      struck={isCancelledShift(s)}
      meta={
        <>
          <span className="flex items-center gap-1"><Clock size={12} /> {shiftTimes(s)}</span>
          <span className="flex items-center gap-1"><UserRound size={12} /> {vacant ? "No worker yet" : s.worker_name || "Worker"}</span>
        </>
      }
    />
  );
}

/** A small coloured block in the month grid. */
function Chip({ tone, struck = false, children }: { tone: Tone; struck?: boolean; children: React.ReactNode }) {
  return (
    <span className={`block truncate rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 ${struck ? "line-through" : ""}`} style={{ background: tone.bg, color: tone.fg }}>
      {children}
    </span>
  );
}

const SHIFT_STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  clocked_in: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  unassigned: "Unfilled",
};

/** The old Schedule page. Its shift views are the Calendar now, and a shift
 *  link (?shiftId=, from notifications and alerts) opens that shift in Rostering. */
export function LegacyScheduleRedirect() {
  const shiftId = new URLSearchParams(useSearch()).get("shiftId");
  return (
    <Redirect
      to={shiftId ? `/coordinator/rostering?openShift=${encodeURIComponent(shiftId)}` : "/md/calendar"}
      replace
    />
  );
}

export default function MDCalendarPage() {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const search = useSearch();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  // Today in the business location, not wherever this computer is.
  const [anchor, setAnchor] = useState(() => appNow());
  const [selectedDay, setSelectedDay] = useState(() => appNow());
  const [events, setEvents] = useState<OrgEvent[] | null>(null);
  const [shifts, setShifts] = useState<CoordinatorShiftRecord[] | null>(null);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [bookingDraft, setBookingDraft] = useState<BookingDraft | null>(null);
  const [editingEvent, setEditingEvent] = useState<OrgEvent | null>(null);
  const [saving, setSaving] = useState(false);
  const [viewingEvent, setViewingEvent] = useState<OrgEvent | null>(null);
  const [viewingShift, setViewingShift] = useState<CoordinatorShiftRecord | null>(null);
  const hourGridRef = useRef<HTMLDivElement>(null);

  // The grid window depends on the active view: a full month-of-weeks for
  // "month", a single Mon–Sun row for "week", and just the one day for
  // "day" — everything below (fetch range, header label, layout) follows
  // from this instead of duplicating the branching per concern.
  const gridStart = useMemo(() => {
    if (viewMode === "month") return startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 });
    if (viewMode === "week") return startOfWeek(anchor, { weekStartsOn: 1 });
    return anchor;
  }, [anchor, viewMode]);
  const gridEnd = useMemo(() => {
    if (viewMode === "month") return endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 });
    if (viewMode === "week") return endOfWeek(anchor, { weekStartsOn: 1 });
    return anchor;
  }, [anchor, viewMode]);
  const days = useMemo(() => eachDayOfInterval({ start: gridStart, end: gridEnd }), [gridStart, gridEnd]);

  // Day view has no grid of its own to click a day in, so the anchor date
  // *is* the selected day there; month/week keep the independently-clicked selection.
  const effectiveDay = viewMode === "day" ? anchor : selectedDay;

  // ?book=1 (the search's "Book a meeting") opens the booking panel, once.
  useEffect(() => {
    if (new URLSearchParams(search).get("book") !== "1") return;
    setBookingDraft({ date: appNow(), start: "09:00", end: "10:00" });
    setEditingEvent(null);
    setBookingOpen(true);
    navigate("/md/calendar", { replace: true });
  }, [search, navigate]);

  useEffect(() => {
    let cancelled = false;
    getOrgEvents({ start: format(gridStart, "yyyy-MM-dd"), end: format(gridEnd, "yyyy-MM-dd") })
      .then((data) => { if (!cancelled) setEvents(data); })
      .catch(() => { if (!cancelled) setEvents([]); });
    return () => { cancelled = true; };
  }, [gridStart, gridEnd]);

  useEffect(() => {
    let cancelled = false;
    setShifts(null);
    listCoordinatorShifts({
      start_date: format(gridStart, "yyyy-MM-dd"),
      end_date: format(gridEnd, "yyyy-MM-dd"),
      limit: 1000,
    })
      .then((data) => { if (!cancelled) setShifts(data); })
      .catch(() => { if (!cancelled) setShifts([]); });
    return () => { cancelled = true; };
  }, [gridStart, gridEnd]);

  // Scroll the hour grid to a sensible default (a bit before 8am) whenever
  // Week/Day is opened, so the working day is visible without scrolling first.
  useEffect(() => {
    if (viewMode !== "month" && hourGridRef.current) {
      hourGridRef.current.scrollTop = Math.max(0, (8 - HOUR_START) * HOUR_PX - 40);
    }
  }, [viewMode, anchor]);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, OrgEvent[]>();
    for (const ev of events ?? []) {
      const key = ev.event_date.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), ev]);
    }
    for (const list of map.values()) list.sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""));
    return map;
  }, [events]);

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, CoordinatorShiftRecord[]>();
    for (const s of shifts ?? []) {
      if (!s.scheduled_start) continue;
      // The shift's own calendar day. (Slicing the UTC timestamp put every
      // shift before 10:30 am Adelaide time on the day before.)
      const key = appLocalDateKey(s.scheduled_start, s.timezone);
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    for (const list of map.values()) list.sort((a, b) => (a.scheduled_start ?? "").localeCompare(b.scheduled_start ?? ""));
    return map;
  }, [shifts]);

  const selectedKey = format(effectiveDay, "yyyy-MM-dd");
  const dayEvents = eventsByDay.get(selectedKey) ?? [];
  const dayShifts = shiftsByDay.get(selectedKey) ?? [];

  const hasAllDayEvent = useMemo(
    () => days.some((d) => (eventsByDay.get(format(d, "yyyy-MM-dd")) ?? []).some((ev) => !ev.start_time)),
    [days, eventsByDay],
  );

  function goPrev() {
    if (viewMode === "month") setAnchor((d) => subMonths(d, 1));
    else if (viewMode === "week") setAnchor((d) => addDays(d, -7));
    else setAnchor((d) => addDays(d, -1));
  }
  function goNext() {
    if (viewMode === "month") setAnchor((d) => addMonths(d, 1));
    else if (viewMode === "week") setAnchor((d) => addDays(d, 7));
    else setAnchor((d) => addDays(d, 1));
  }
  function goToday() {
    const now = appNow();
    setAnchor(now);
    setSelectedDay(now);
  }

  const headerLabel =
    viewMode === "month"
      ? format(anchor, "MMMM yyyy")
      : viewMode === "week"
        ? `${format(gridStart, "d MMM")} to ${format(gridEnd, "d MMM yyyy")}`
        : format(anchor, "EEEE d MMMM yyyy");

  function openAddMeeting(day?: Date, startHHMM?: string, endHHMM?: string) {
    setBookingDraft({ date: day ?? effectiveDay, start: startHHMM ?? "09:00", end: endHHMM ?? "10:00" });
    setEditingEvent(null);
    setViewingEvent(null);
    setBookingOpen(true);
  }

  function openEditMeeting(ev: OrgEvent) {
    setEditingEvent(ev);
    setViewingEvent(null);
    setBookingOpen(true);
  }

  /** Click anywhere empty in a day's hour column opens the booking panel,
   *  snapped to the nearest half hour under the cursor. */
  function handleGridClick(e: React.MouseEvent<HTMLDivElement>, day: Date) {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const rawMinutes = HOUR_START * 60 + (y / HOUR_PX) * 60;
    const snapped = Math.max(HOUR_START * 60, Math.round(rawMinutes / 30) * 30);
    const startHHMM = minutesToHHMM(snapped);
    const endHHMM = minutesToHHMM(snapped + 60);
    openAddMeeting(day, startHHMM, endHHMM);
  }

  async function handleSave(payload: OrgEventPayload) {
    setSaving(true);
    try {
      const { invites, ...saved } = editingEvent ? await updateOrgEvent(editingEvent.id, payload) : await createOrgEvent(payload);
      setEvents((prev) => [...(prev ?? []).filter((e) => e.id !== saved.id), saved]);
      setBookingOpen(false);
      setEditingEvent(null);
      const when = `${saved.title} on ${format(displayDate(saved.event_date), "d MMM")}${saved.start_time ? ` at ${clockFromHHMM(saved.start_time)}` : ""}.`;
      toast({
        title: editingEvent ? "Meeting updated" : "Meeting booked",
        description: [when, inviteSummary(invites, !!editingEvent)].filter(Boolean).join(" "),
        variant: invites?.failed.length ? "destructive" : undefined,
      });
      // A video call's invite is sent from Google Calendar or Outlook, so open
      // the meeting where those buttons are.
      if (isOnlineMode(saved.meeting_mode) && (saved.attendees?.length ?? 0) > 0) setViewingEvent(saved);
    } catch (err) {
      toast({ title: "Couldn't save the meeting", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(ev: OrgEvent) {
    try {
      await deleteOrgEvent(ev.id);
      setEvents((prev) => (prev ?? []).filter((e) => e.id !== ev.id));
      setViewingEvent(null);
      toast({
        title: "Meeting cancelled",
        description: ev.invites_sent_at ? "Everyone invited has been sent a cancellation, which takes it off their calendar." : undefined,
      });
    } catch (err) {
      toast({ title: "Couldn't cancel the meeting", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    }
  }

  const loading = events === null || shifts === null;
  const navButton = "flex h-9 w-9 items-center justify-center rounded-full border border-cc-border bg-cc-surface transition-colors hover:bg-cc-soft";

  return (
    <HubLayout>
      <div className="space-y-4 pb-10">
        <PageHeader
          eyebrow="Operations & Care"
          title="Calendar"
          description="Every shift across the organisation, plus the meetings you book: participant meetings in person, by phone or on video, and your own team meetings, training and audits. Shifts are staffed in Rostering."
          actions={
            <button type="button" className={ctaClass} onClick={() => openAddMeeting()}>
              <Plus size={16} /> Book meeting
            </button>
          }
        />

        {/* Same controls, in the same order, as the Rostering toolbar. */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-0.5 rounded-full border bg-cc-surface p-1" style={{ borderColor: BORDER }} role="group" aria-label="View">
            {VIEW_MODES.map((v) => (
              <button
                key={v.id}
                type="button"
                onClick={() => setViewMode(v.id)}
                aria-pressed={viewMode === v.id}
                className="h-8 rounded-full px-3.5 text-sm font-medium transition-colors"
                style={{ background: viewMode === v.id ? TEXT : "transparent", color: viewMode === v.id ? "var(--cc-bg)" : MUTED }}
              >
                {v.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={goPrev} className={navButton} aria-label={`Previous ${viewMode}`}>
              <ChevronLeft size={16} />
            </button>
            <span className="min-w-0 px-1 text-sm font-semibold" style={{ color: TEXT }} aria-live="polite">{headerLabel}</span>
            <button type="button" onClick={goNext} className={navButton} aria-label={`Next ${viewMode}`}>
              <ChevronRight size={16} />
            </button>
            <button type="button" onClick={goToday} className={`${outlineClass} min-h-9`}>
              Today
            </button>
          </div>

          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 sm:ml-auto" aria-label="Key">
            {LEGEND.map((item) => (
              <li key={item.label} className="flex items-center gap-1.5 text-xs" style={{ color: MUTED }}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: item.tone.fg }} />
                {item.label}
              </li>
            ))}
          </ul>
        </div>

        {viewMode === "month" ? (
          <div className="grid items-start gap-4 lg:grid-cols-[1fr_340px]">
            {/* Month grid */}
            <div className="overflow-hidden rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }} aria-busy={loading}>
              <div className="grid grid-cols-7 border-b" style={{ borderColor: BORDER }}>
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} className="py-2.5 text-center text-xs font-medium" style={{ color: MUTED }}>{d}</div>
                ))}
              </div>

              <div className="grid grid-cols-7">
                {days.map((day, i) => {
                  const key = format(day, "yyyy-MM-dd");
                  const dayEvs = eventsByDay.get(key) ?? [];
                  const dayShiftList = shiftsByDay.get(key) ?? [];
                  const vacantCount = dayShiftList.filter((s) => isVacantShift(s) && !isCancelledShift(s)).length;
                  const inMonth = isSameMonth(day, anchor);
                  const selected = isSameDay(day, selectedDay);
                  const today = isAppToday(day);
                  const items = [
                    ...dayEvs.map((ev) => ({ key: ev.id, tone: eventTone(ev), struck: false, text: `${ev.start_time ? `${clockFromHHMM(ev.start_time)} ` : ""}${ev.title}` })),
                    ...dayShiftList.map((s) => ({ key: s.id, tone: shiftTone(s), struck: isCancelledShift(s), text: `${s.scheduled_start ? `${clock(zonedDate(s.scheduled_start, s.timezone))} ` : ""}${s.participant_name || "Participant"}` })),
                  ];
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedDay(day)}
                      aria-pressed={selected}
                      aria-label={loading ? format(day, "EEEE d MMMM") : `${format(day, "EEEE d MMMM")}: ${dayShiftList.length} shifts${vacantCount ? `, ${vacantCount} unfilled` : ""}, ${dayEvs.length} meetings`}
                      className={`flex min-h-[72px] flex-col items-stretch gap-1 p-1.5 text-left transition-colors sm:min-h-[116px] ${(i + 1) % 7 ? "border-r" : ""} border-b ${selected ? "" : "hover:bg-cc-soft"}`}
                      style={{ borderColor: BORDER, background: selected ? "var(--cc-brand-purple-soft)" : undefined }}
                    >
                      <span
                        className="flex h-7 w-7 items-center justify-center rounded-full text-sm font-medium"
                        style={{
                          background: today ? "#7C3AED" : "transparent",
                          color: today ? "#fff" : inMonth ? TEXT : MUTED,
                          opacity: inMonth || today ? 1 : 0.6,
                        }}
                      >
                        {format(day, "d")}
                      </span>

                      {/* Phones: a dot per kind. Wider: the first few items. */}
                      {items.length > 0 && (
                        <span className="flex flex-wrap gap-1 px-1 sm:hidden">
                          {[...new Set(items.map((it) => it.tone.fg))].map((c) => (
                            <span key={c} className="h-1.5 w-1.5 rounded-full" style={{ background: c }} />
                          ))}
                        </span>
                      )}
                      <span className="hidden flex-col gap-0.5 sm:flex" style={{ opacity: inMonth ? 1 : 0.6 }}>
                        {items.slice(0, 3).map((it) => <Chip key={it.key} tone={it.tone} struck={it.struck}>{it.text}</Chip>)}
                        {items.length > 3 && (
                          <span className="px-1.5 text-[11px] font-medium" style={{ color: MUTED }}>{items.length - 3} more</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected day */}
            <section className="rounded-2xl border lg:sticky lg:top-24" style={{ borderColor: BORDER, background: SURFACE }} aria-label={format(effectiveDay, "EEEE d MMMM")}>
              <div className="flex items-center justify-between gap-3 border-b px-4 py-3" style={{ borderColor: BORDER }}>
                <div className="min-w-0">
                  <h2 className="text-base font-semibold" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>
                    {isAppToday(effectiveDay) ? "Today" : format(effectiveDay, "EEEE d MMMM")}
                  </h2>
                  <p className="text-xs" style={{ color: MUTED }}>
                    {isAppToday(effectiveDay) ? `${format(effectiveDay, "EEEE d MMMM")} · ` : ""}
                    {loading
                      ? "Loading the day"
                      : `${dayShifts.length} ${dayShifts.length === 1 ? "shift" : "shifts"} · ${dayEvents.length} ${dayEvents.length === 1 ? "meeting" : "meetings"}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openAddMeeting(effectiveDay)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-cc-border transition-colors hover:bg-cc-soft"
                  aria-label="Book a meeting on this day"
                  title="Book a meeting on this day"
                >
                  <Plus size={16} />
                </button>
              </div>

              <div className="max-h-[560px] space-y-1 overflow-y-auto p-2">
                {loading ? (
                  <p role="status" className="py-10 text-center text-sm" style={{ color: MUTED }}>Loading...</p>
                ) : dayShifts.length === 0 && dayEvents.length === 0 ? (
                  <div className="px-4 py-10 text-center">
                    <p className="text-sm font-medium" style={{ color: TEXT }}>Nothing on this day</p>
                    <button type="button" onClick={() => openAddMeeting(effectiveDay)} className="mt-1 text-sm font-medium text-[var(--cc-plum)] hover:underline">
                      Book a meeting
                    </button>
                  </div>
                ) : (
                  <>
                    {dayEvents.map((ev) => <EventItem key={ev.id} ev={ev} onOpen={() => setViewingEvent(ev)} />)}
                    {dayShifts.map((s) => <ShiftItem key={s.id} s={s} onOpen={() => setViewingShift(s)} />)}
                  </>
                )}
              </div>
            </section>
          </div>
        ) : (
          /* Week / Day: an hour grid so shifts and meetings sit at their
             actual time slot, side by side across the days in view. */
          <div className="overflow-hidden rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }} aria-busy={loading}>
            {/* Day headers */}
            <div className="grid border-b" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)`, borderColor: BORDER }}>
              <div />
              {days.map((day) => (
                <div key={format(day, "yyyy-MM-dd")} className="flex flex-col items-center gap-1 border-l py-2" style={{ borderColor: BORDER }}>
                  <span className="text-xs font-medium" style={{ color: isAppToday(day) ? PURPLE : MUTED }}>{format(day, "EEE")}</span>
                  <span
                    className="flex h-8 w-8 items-center justify-center rounded-full text-sm font-semibold"
                    style={{ background: isAppToday(day) ? "#7C3AED" : "transparent", color: isAppToday(day) ? "#fff" : TEXT }}
                  >
                    {format(day, "d")}
                  </span>
                </div>
              ))}
            </div>

            {/* All-day strip — events created before start_time existed, or
                with no time set, show here instead of being skipped. */}
            {hasAllDayEvent && (
              <div className="grid border-b" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)`, borderColor: BORDER }}>
                <div className="flex items-center justify-end pr-2 text-[11px]" style={{ color: MUTED }}>All day</div>
                {days.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const allDayEvs = (eventsByDay.get(key) ?? []).filter((ev) => !ev.start_time);
                  return (
                    <div key={key} className="flex flex-col gap-0.5 border-l p-1" style={{ borderColor: BORDER }}>
                      {allDayEvs.map((ev) => (
                        <button key={ev.id} type="button" onClick={() => setViewingEvent(ev)} className="text-left">
                          <Chip tone={eventTone(ev)}>{ev.title}</Chip>
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Scrollable hour grid */}
            <div ref={hourGridRef} className="overflow-y-auto" style={{ maxHeight: 600 }}>
              <div className="relative grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)`, height: GRID_HEIGHT }}>
                <div className="relative">
                  {GRID_HOURS.map((h) => (
                    <div
                      key={h}
                      className="absolute right-2 -translate-y-1/2 text-[11px]"
                      style={{ top: (h - HOUR_START) * HOUR_PX, color: MUTED }}
                    >
                      {h === HOUR_START ? "" : formatHourLabel(h)}
                    </div>
                  ))}
                </div>

                {days.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const timedShifts = (shiftsByDay.get(key) ?? []).filter((s) => s.scheduled_start);
                  const timedEvents = (eventsByDay.get(key) ?? []).filter((ev) => ev.start_time);
                  return (
                    <div
                      key={key}
                      onClick={(e) => handleGridClick(e, day)}
                      className="relative cursor-pointer border-l"
                      style={{ borderColor: BORDER }}
                      title="Click an empty time to book a meeting"
                    >
                      {GRID_HOURS.map((h) => (
                        <div
                          key={h}
                          className="pointer-events-none absolute inset-x-0 border-t"
                          style={{ top: (h - HOUR_START) * HOUR_PX, borderColor: BORDER }}
                        />
                      ))}

                      {isAppToday(day) && (
                        <div
                          className="pointer-events-none absolute inset-x-0 z-10 border-t-2"
                          style={{ top: timeTopPx(format(appNow(), "HH:mm")), borderColor: "#7C3AED" }}
                        >
                          <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full" style={{ background: "#7C3AED" }} />
                        </div>
                      )}

                      {timedShifts.map((s) => {
                        const startHHMM = format(zonedDate(s.scheduled_start!, s.timezone), "HH:mm");
                        const endHHMM = s.scheduled_end ? format(zonedDate(s.scheduled_end, s.timezone), "HH:mm") : minutesToHHMM(hhmmToMinutes(startHHMM) + 60);
                        const top = timeTopPx(startHHMM);
                        const height = Math.max(24, timeTopPx(endHHMM) - top);
                        const tone = shiftTone(s);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setViewingShift(s); }}
                            className="absolute left-1 right-1 overflow-hidden rounded-lg px-2 py-1 text-left transition-[filter] hover:brightness-95"
                            style={{ top, height, background: tone.bg, borderLeft: `3px solid ${tone.fg}` }}
                          >
                            <p className={`truncate text-[11px] font-semibold ${isCancelledShift(s) ? "line-through" : ""}`} style={{ color: tone.fg }}>{s.participant_name || "Participant"}</p>
                            {height >= 40 && <p className="truncate text-[11px]" style={{ color: MUTED }}>{shiftTimes(s)}</p>}
                          </button>
                        );
                      })}

                      {timedEvents.map((ev) => {
                        const tone = eventTone(ev);
                        const Icon = eventIcon(ev);
                        const top = timeTopPx(ev.start_time!);
                        const height = Math.max(24, (parseDurationMinutes(ev.duration) / 60) * HOUR_PX);
                        return (
                          <button
                            key={ev.id}
                            type="button"
                            onClick={(e) => { e.stopPropagation(); setViewingEvent(ev); }}
                            className="absolute left-1 right-1 overflow-hidden rounded-lg px-2 py-1 text-left transition-[filter] hover:brightness-95"
                            style={{ top, height, background: tone.bg, borderLeft: `3px solid ${tone.fg}` }}
                          >
                            <p className="flex items-center gap-1 truncate text-[11px] font-semibold" style={{ color: tone.fg }}>
                              <Icon size={11} className="shrink-0" /> <span className="truncate">{ev.title}</span>
                            </p>
                            {height >= 40 && <p className="truncate text-[11px]" style={{ color: MUTED }}>{clockFromHHMM(ev.start_time!)} · {ev.duration}</p>}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <MeetingBookingSheet
        open={bookingOpen}
        onOpenChange={(open) => { setBookingOpen(open); if (!open) setEditingEvent(null); }}
        draft={bookingDraft}
        editing={editingEvent}
        editingMinutes={editingEvent ? parseDurationMinutes(editingEvent.duration) : undefined}
        saving={saving}
        onSave={handleSave}
      />

      <MeetingDetailSheet
        event={viewingEvent}
        minutes={viewingEvent ? parseDurationMinutes(viewingEvent.duration) : 60}
        onOpenChange={(open) => { if (!open) setViewingEvent(null); }}
        onEdit={openEditMeeting}
        onDelete={handleDelete}
      />

      {/* Shifts are read-only here; staffing changes happen in Rostering. */}
      <SidePanel
        open={!!viewingShift}
        onOpenChange={(open) => { if (!open) setViewingShift(null); }}
        eyebrow={viewingShift ? shiftKind(viewingShift) : "Shift"}
        title={viewingShift?.participant_name || "Participant"}
        description={viewingShift?.scheduled_start ? format(zonedDate(viewingShift.scheduled_start, viewingShift.timezone), "EEEE d MMMM yyyy") : undefined}
        footer={
          viewingShift && (
            <>
              {viewingShift.participant_id && (
                <button
                  type="button"
                  className={`${outlineClass} mr-auto`}
                  onClick={() => {
                    const s = viewingShift;
                    setViewingShift(null);
                    setBookingDraft({ date: s.scheduled_start ? new Date(s.scheduled_start) : effectiveDay, start: "09:00", end: "09:30", participantId: s.participant_id ?? undefined });
                    setEditingEvent(null);
                    setBookingOpen(true);
                  }}
                >
                  <CalendarDays size={15} /> Book a meeting
                </button>
              )}
              <Link href={`/coordinator/rostering?openShift=${encodeURIComponent(viewingShift.id)}`} className={`${ctaClass} ml-auto`}>
                <Briefcase size={15} /> {isVacantShift(viewingShift) && !isCancelledShift(viewingShift) ? "Fill in Rostering" : "Open in Rostering"}
              </Link>
            </>
          )
        }
      >
        {viewingShift && (
          <dl className="space-y-3">
            {[
              { icon: Clock, label: "When", value: shiftTimes(viewingShift) },
              { icon: UserRound, label: "Worker", value: isVacantShift(viewingShift) && !isCancelledShift(viewingShift) ? "No one yet" : viewingShift.worker_name || "Not recorded" },
              { icon: Briefcase, label: "Status", value: SHIFT_STATUS_LABEL[isVacantShift(viewingShift) && !isCancelledShift(viewingShift) ? "unassigned" : viewingShift.status ?? ""] ?? viewingShift.status ?? "Scheduled" },
            ].map(({ icon: Icon, label, value }) => (
              <div key={label} className="flex items-start gap-3">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cc-soft" style={{ color: MUTED }}>
                  <Icon size={16} />
                </span>
                <div className="min-w-0">
                  <dt className="text-xs" style={{ color: MUTED }}>{label}</dt>
                  <dd className="text-sm" style={{ color: label === "Worker" && isVacantShift(viewingShift) && !isCancelledShift(viewingShift) ? "var(--cc-amber)" : TEXT }}>{value}</dd>
                </div>
              </div>
            ))}
          </dl>
        )}
      </SidePanel>
    </HubLayout>
  );
}
