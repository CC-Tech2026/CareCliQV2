import { useEffect, useMemo, useRef, useState } from "react";
import {
  format, parseISO, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, isSameMonth, isToday, addMonths, subMonths, addDays,
} from "date-fns";
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, Trash2, MapPin, Clock,
  ClipboardCheck, BookOpen, Users, Target, Briefcase, X,
} from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { getOrgEvents, createOrgEvent, deleteOrgEvent, type OrgEvent } from "@/services/hubService";
import { listCoordinatorShifts, type CoordinatorShiftRecord } from "@/services/coordinatorService";
import { useToast } from "@/hooks/use-toast";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";
const BLUE = "#2A5C8A";
const BLUE_SOFT = "#EAF1F7";
const AMBER = "#9A5B0A";
const AMBER_SOFT = "#FBF2E6";

type EventType = "audit" | "training" | "meeting" | "review";
type ViewMode = "month" | "week" | "day";

const VIEW_MODES: ViewMode[] = ["month", "week", "day"];

// Hour-grid window for Week/Day views — 6am to 10pm covers the working day
// with room either side; the grid itself scrolls if a shift/meeting falls
// outside it. HOUR_PX is the pixel height of one hour row.
const HOUR_START = 6;
const HOUR_END = 22;
const HOUR_PX = 56;
const GRID_HOURS = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);
const GRID_HEIGHT = (HOUR_END - HOUR_START) * HOUR_PX;

const EVENT_CFG: Record<EventType, { label: string; icon: typeof Users; color: string; bg: string }> = {
  audit: { label: "Audit", icon: ClipboardCheck, color: "#B3261E", bg: "#FBEAE9" },
  training: { label: "Training", icon: BookOpen, color: PLUM, bg: "var(--cc-plum-soft)" },
  meeting: { label: "Meeting", icon: Users, color: "#0EA5E9", bg: "#E0F2FE" },
  review: { label: "Review", icon: Target, color: "#0F7B57", bg: "#E9F5F0" },
};

const BLANK_FORM = {
  title: "",
  event_date: "",
  start_time: "09:00",
  end_time: "10:00",
  event_type: "meeting" as EventType,
  location: "",
  participants_desc: "",
};

/** Same appointment concept as Master Schedule's "Unassigned" bucket — a
 *  shift is vacant, i.e. no worker attached. Used here only to distinguish
 *  it visually, not to gate anything. */
function isVacantShift(s: CoordinatorShiftRecord) {
  return !s.worker_id || s.status === "unassigned";
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
  const period = h < 12 ? "AM" : "PM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return `${hour12} ${period}`;
}
/** Grid pixels from the top of the hour grid for a given "HH:MM" time-of-day. */
function timeTopPx(hhmm: string): number {
  const mins = hhmmToMinutes(hhmm) - HOUR_START * 60;
  return Math.max(0, Math.min(GRID_HEIGHT, (mins / 60) * HOUR_PX));
}
/** Best-effort parse of free-text durations ("1 hour", "45 mins", "1.5 hours",
 *  or our own "1h 30m") back into minutes, for sizing legacy event blocks. */
function parseDurationMinutes(duration: string): number {
  const text = (duration || "").toLowerCase();
  const hourMatch = text.match(/([\d.]+)\s*h/);
  const minMatch = text.match(/([\d.]+)\s*m/);
  let minutes = 0;
  if (hourMatch) minutes += parseFloat(hourMatch[1]) * 60;
  if (minMatch) minutes += parseFloat(minMatch[1]);
  return minutes > 0 ? Math.round(minutes) : 60;
}
function formatDurationLabel(minutes: number): string {
  const m = Math.max(15, Math.round(minutes));
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h === 0) return `${rem} min${rem === 1 ? "" : "s"}`;
  if (rem === 0) return `${h} hour${h === 1 ? "" : "s"}`;
  return `${h}h ${rem}m`;
}

function ShiftCard({ s }: { s: CoordinatorShiftRecord }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: BORDER, background: isVacantShift(s) ? AMBER_SOFT : SOFT }}>
      <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wide" style={{ color: isVacantShift(s) ? AMBER : BLUE }}>
        <Briefcase size={10} /> {isVacantShift(s) ? "Unfilled appointment" : "Appointment"}
      </div>
      <p className="mt-1 text-[12px] font-bold" style={{ color: TEXT }}>
        {s.participant_name || "Participant"} {s.worker_name ? `· ${s.worker_name}` : ""}
      </p>
      <p className="mt-0.5 flex items-center gap-1 text-[10px]" style={{ color: MUTED }}>
        <Clock size={9} />
        {s.scheduled_start ? format(new Date(s.scheduled_start), "h:mmaaa").toLowerCase() : "—"}
        {s.scheduled_end ? ` – ${format(new Date(s.scheduled_end), "h:mmaaa").toLowerCase()}` : ""}
      </p>
    </div>
  );
}

function EventCard({ ev, onDelete }: { ev: OrgEvent; onDelete: (id: string) => void }) {
  const cfg = EVENT_CFG[ev.event_type] ?? EVENT_CFG.meeting;
  const Icon = cfg.icon;
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: BORDER, background: SURFACE }}>
      <div className="flex items-start justify-between gap-2">
        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black" style={{ background: cfg.bg, color: cfg.color }}>
          <Icon size={9} /> {cfg.label}
        </span>
        <button onClick={() => onDelete(ev.id)} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/5" aria-label={`Remove ${ev.title}`}>
          <Trash2 size={11} style={{ color: MUTED }} />
        </button>
      </div>
      <p className="mt-1.5 text-[12px] font-bold" style={{ color: TEXT }}>{ev.title}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]" style={{ color: MUTED }}>
        {ev.start_time && <span className="flex items-center gap-1"><Clock size={9} /> {ev.start_time}{ev.duration ? ` · ${ev.duration}` : ""}</span>}
        {!ev.start_time && ev.duration && <span className="flex items-center gap-1"><Clock size={9} /> {ev.duration}</span>}
        {ev.location && <span className="flex items-center gap-1"><MapPin size={9} /> {ev.location}</span>}
      </div>
      {ev.participants_desc && <p className="mt-1 text-[10px]" style={{ color: MUTED }}>{ev.participants_desc}</p>}
    </div>
  );
}

type Viewing = { kind: "shift"; shift: CoordinatorShiftRecord } | { kind: "event"; event: OrgEvent } | null;

export default function MDCalendarPage() {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [events, setEvents] = useState<OrgEvent[] | null>(null);
  const [shifts, setShifts] = useState<CoordinatorShiftRecord[] | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(BLANK_FORM);
  const [saving, setSaving] = useState(false);
  const [viewing, setViewing] = useState<Viewing>(null);
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

  useEffect(() => {
    let cancelled = false;
    getOrgEvents()
      .then((data) => { if (!cancelled) setEvents(data); })
      .catch(() => { if (!cancelled) setEvents([]); });
    return () => { cancelled = true; };
  }, []);

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
    return map;
  }, [events]);

  const shiftsByDay = useMemo(() => {
    const map = new Map<string, CoordinatorShiftRecord[]>();
    for (const s of shifts ?? []) {
      if (!s.scheduled_start) continue;
      const key = s.scheduled_start.slice(0, 10);
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
    const now = new Date();
    setAnchor(now);
    setSelectedDay(now);
  }

  const headerLabel =
    viewMode === "month"
      ? format(anchor, "MMMM yyyy")
      : viewMode === "week"
        ? `${format(gridStart, "d MMM")} – ${format(gridEnd, "d MMM yyyy")}`
        : format(anchor, "EEEE d MMMM yyyy");

  function openAddMeeting(day?: Date, startHHMM?: string, endHHMM?: string) {
    setForm({
      ...BLANK_FORM,
      event_date: format(day ?? effectiveDay, "yyyy-MM-dd"),
      start_time: startHHMM ?? BLANK_FORM.start_time,
      end_time: endHHMM ?? BLANK_FORM.end_time,
    });
    setViewing(null);
    setFormOpen(true);
  }

  /** Click anywhere empty in a day's hour column opens Add Schedule, snapped
   *  to the nearest half hour under the cursor. */
  function handleGridClick(e: React.MouseEvent<HTMLDivElement>, day: Date) {
    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const rawMinutes = HOUR_START * 60 + (y / HOUR_PX) * 60;
    const snapped = Math.max(HOUR_START * 60, Math.round(rawMinutes / 30) * 30);
    const startHHMM = minutesToHHMM(snapped);
    const endHHMM = minutesToHHMM(snapped + 60);
    openAddMeeting(day, startHHMM, endHHMM);
  }

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim() || !form.event_date) return;
    setSaving(true);
    try {
      const startMin = hhmmToMinutes(form.start_time);
      const endMin = Math.max(startMin + 15, hhmmToMinutes(form.end_time));
      const created = await createOrgEvent({
        title: form.title.trim(),
        event_date: form.event_date,
        duration: formatDurationLabel(endMin - startMin),
        event_type: form.event_type,
        location: form.location.trim() || null,
        participants_desc: form.participants_desc.trim() || null,
        start_time: form.start_time,
      });
      setEvents((prev) => [...(prev ?? []), created]);
      setFormOpen(false);
      setForm(BLANK_FORM);
      toast({ title: "Meeting added", description: `${created.title} on ${format(parseISO(created.event_date), "d MMM")}.` });
    } catch (err) {
      toast({ title: "Couldn't add meeting", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteOrgEvent(id);
      setEvents((prev) => (prev ?? []).filter((e) => e.id !== id));
      toast({ title: "Meeting removed" });
    } catch (err) {
      toast({ title: "Couldn't remove meeting", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    }
  }

  return (
    <HubLayout>
      <div className="space-y-5 pb-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-black flex items-center gap-2" style={{ color: TEXT }}>
              <CalendarDays size={19} style={{ color: PLUM }} /> Calendar
            </h1>
            <p className="text-[12px] font-medium" style={{ color: MUTED }}>
              Scheduled appointments across the organisation, plus your own audits, training, meetings and reviews.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 rounded-xl border p-1" style={{ borderColor: BORDER, background: SOFT }}>
              {VIEW_MODES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setViewMode(v)}
                  className="rounded-lg px-3 py-1.5 text-[11px] font-black uppercase tracking-wide transition-colors"
                  style={{
                    background: viewMode === v ? SURFACE : "transparent",
                    color: viewMode === v ? PLUM : MUTED,
                    boxShadow: viewMode === v ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                  }}
                >
                  {v}
                </button>
              ))}
            </div>
            <Button variant="navy" className="gap-2 rounded-lg" onClick={() => openAddMeeting()}>
              <Plus size={15} /> Add meeting
            </Button>
          </div>
        </div>

        {viewMode === "month" ? (
          <div className="grid gap-5 lg:grid-cols-[1fr_320px] items-start">
            {/* Month grid */}
            <div className="rounded-2xl border overflow-hidden" style={{ borderColor: BORDER, background: SURFACE }}>
              <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: BORDER }}>
                <button onClick={goPrev} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-cc-soft" aria-label="Previous month">
                  <ChevronLeft size={16} style={{ color: MUTED }} />
                </button>
                <div className="flex items-center gap-2">
                  <p className="text-[14px] font-black" style={{ color: TEXT }}>{headerLabel}</p>
                  <button onClick={goToday} className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide hover:bg-cc-soft" style={{ color: PLUM }}>
                    Today
                  </button>
                </div>
                <button onClick={goNext} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-cc-soft" aria-label="Next month">
                  <ChevronRight size={16} style={{ color: MUTED }} />
                </button>
              </div>

              <div className="grid grid-cols-7 border-b" style={{ borderColor: BORDER }}>
                {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
                  <div key={d} className="py-2 text-center text-[9px] font-black uppercase tracking-wide" style={{ color: MUTED }}>{d}</div>
                ))}
              </div>

              <div className="grid grid-cols-7">
                {days.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const dayEvs = eventsByDay.get(key) ?? [];
                  const dayShiftList = shiftsByDay.get(key) ?? [];
                  const vacantCount = dayShiftList.filter(isVacantShift).length;
                  const inMonth = isSameMonth(day, anchor);
                  const selected = isSameDay(day, selectedDay);
                  const today = isToday(day);
                  return (
                    <button
                      key={key}
                      onClick={() => setSelectedDay(day)}
                      className="flex min-h-[112px] flex-col items-stretch gap-1 border-b border-r p-1.5 text-left transition-colors hover:bg-cc-soft"
                      style={{ borderColor: BORDER, background: selected ? "var(--cc-plum-soft)" : "transparent", opacity: inMonth ? 1 : 0.4 }}
                    >
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-black"
                        style={{ background: today ? PLUM : "transparent", color: today ? "#fff" : TEXT }}
                      >
                        {format(day, "d")}
                      </span>

                      {dayShiftList.length > 0 && (
                        <span
                          className="inline-flex w-fit items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-black"
                          style={{ background: vacantCount > 0 ? AMBER_SOFT : BLUE_SOFT, color: vacantCount > 0 ? AMBER : BLUE }}
                        >
                          <Briefcase size={8} /> {dayShiftList.length}{vacantCount > 0 ? ` · ${vacantCount} unfilled` : ""}
                        </span>
                      )}

                      {dayShiftList.length > 0 && (
                        <div className="flex flex-col gap-0.5">
                          {dayShiftList.slice(0, 2).map((s) => {
                            const vacant = isVacantShift(s);
                            return (
                              <span
                                key={s.id}
                                className="truncate rounded px-1 py-0.5 text-[9px] font-bold"
                                style={{ background: vacant ? AMBER_SOFT : BLUE_SOFT, color: vacant ? AMBER : BLUE }}
                              >
                                {s.scheduled_start ? `${format(new Date(s.scheduled_start), "h:mmaaa").toLowerCase()} · ` : ""}{s.participant_name || "Participant"}
                              </span>
                            );
                          })}
                          {dayShiftList.length > 2 && (
                            <span className="text-[9px] font-bold" style={{ color: MUTED }}>+{dayShiftList.length - 2} more</span>
                          )}
                        </div>
                      )}

                      {dayEvs.length > 0 && (
                        <div className="flex flex-col gap-0.5">
                          {dayEvs.slice(0, 2).map((ev) => {
                            const cfg = EVENT_CFG[ev.event_type] ?? EVENT_CFG.meeting;
                            return (
                              <span key={ev.id} className="truncate rounded px-1 py-0.5 text-[9px] font-bold" style={{ background: cfg.bg, color: cfg.color }}>
                                {ev.start_time ? `${ev.start_time} · ` : ""}{ev.title}
                              </span>
                            );
                          })}
                          {dayEvs.length > 2 && (
                            <span className="text-[9px] font-bold" style={{ color: MUTED }}>+{dayEvs.length - 2} more</span>
                          )}
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Selected day detail */}
            <div className="rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
              <div className="flex items-center justify-between border-b px-4 py-3.5" style={{ borderColor: BORDER }}>
                <div>
                  <p className="text-[12px] font-black" style={{ color: TEXT }}>{format(effectiveDay, "EEEE d MMMM")}</p>
                  <p className="text-[10px] font-medium" style={{ color: MUTED }}>{dayShifts.length} appointment{dayShifts.length === 1 ? "" : "s"} · {dayEvents.length} meeting{dayEvents.length === 1 ? "" : "s"}</p>
                </div>
                <button onClick={() => openAddMeeting(effectiveDay)} className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-cc-soft" aria-label="Add meeting for this day" style={{ color: PLUM }}>
                  <Plus size={15} />
                </button>
              </div>

              <div className="max-h-[520px] overflow-y-auto p-3 space-y-2">
                {dayShifts.length === 0 && dayEvents.length === 0 && (
                  <p className="py-8 text-center text-[11px] font-medium" style={{ color: MUTED }}>Nothing scheduled this day.</p>
                )}
                {dayShifts.map((s) => <ShiftCard key={s.id} s={s} />)}
                {dayEvents.map((ev) => <EventCard key={ev.id} ev={ev} onDelete={handleDelete} />)}
              </div>
            </div>
          </div>
        ) : (
          /* Week / Day: an hour grid so appointments and meetings sit at
             their actual time slot, side by side across the days in view. */
          <div className="rounded-2xl border overflow-hidden" style={{ borderColor: BORDER, background: SURFACE }}>
            <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: BORDER }}>
              <button onClick={goPrev} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-cc-soft" aria-label={`Previous ${viewMode}`}>
                <ChevronLeft size={16} style={{ color: MUTED }} />
              </button>
              <div className="flex items-center gap-2">
                <p className="text-[14px] font-black" style={{ color: TEXT }}>{headerLabel}</p>
                <button onClick={goToday} className="rounded-full px-2.5 py-1 text-[10px] font-black uppercase tracking-wide hover:bg-cc-soft" style={{ color: PLUM }}>
                  Today
                </button>
              </div>
              <button onClick={goNext} className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-cc-soft" aria-label={`Next ${viewMode}`}>
                <ChevronRight size={16} style={{ color: MUTED }} />
              </button>
            </div>

            {/* Day headers */}
            <div className="grid border-b" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)`, borderColor: BORDER }}>
              <div />
              {days.map((day) => (
                <div key={format(day, "yyyy-MM-dd")} className="flex flex-col items-center gap-1 border-l py-2" style={{ borderColor: BORDER }}>
                  <span className="text-[9px] font-black uppercase tracking-wide" style={{ color: isToday(day) ? PLUM : MUTED }}>{format(day, "EEE")}</span>
                  <span
                    className="flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-black"
                    style={{ background: isToday(day) ? PLUM : "transparent", color: isToday(day) ? "#fff" : TEXT }}
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
                <div className="flex items-center justify-end pr-1.5 text-[8px] font-black uppercase tracking-wide" style={{ color: MUTED }}>All day</div>
                {days.map((day) => {
                  const key = format(day, "yyyy-MM-dd");
                  const allDayEvs = (eventsByDay.get(key) ?? []).filter((ev) => !ev.start_time);
                  return (
                    <div key={key} className="flex flex-col gap-0.5 border-l p-1" style={{ borderColor: BORDER }}>
                      {allDayEvs.map((ev) => {
                        const cfg = EVENT_CFG[ev.event_type] ?? EVENT_CFG.meeting;
                        return (
                          <button
                            key={ev.id}
                            onClick={() => setViewing({ kind: "event", event: ev })}
                            className="truncate rounded px-1 py-0.5 text-left text-[9px] font-bold"
                            style={{ background: cfg.bg, color: cfg.color }}
                          >
                            {ev.title}
                          </button>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Scrollable hour grid */}
            <div ref={hourGridRef} className="overflow-y-auto" style={{ maxHeight: 560 }}>
              <div className="relative grid" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)`, height: GRID_HEIGHT }}>
                <div className="relative">
                  {GRID_HOURS.map((h) => (
                    <div
                      key={h}
                      className="absolute right-1.5 -translate-y-1/2 text-[9px] font-bold"
                      style={{ top: (h - HOUR_START) * HOUR_PX, color: MUTED }}
                    >
                      {formatHourLabel(h)}
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
                      className="relative border-l cursor-pointer"
                      style={{ borderColor: BORDER }}
                    >
                      {GRID_HOURS.map((h) => (
                        <div
                          key={h}
                          className="pointer-events-none absolute inset-x-0 border-t"
                          style={{ top: (h - HOUR_START) * HOUR_PX, borderColor: BORDER }}
                        />
                      ))}

                      {isToday(day) && (
                        <div
                          className="pointer-events-none absolute inset-x-0 z-10 border-t-2"
                          style={{ top: timeTopPx(format(new Date(), "HH:mm")), borderColor: "#E11D48" }}
                        >
                          <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full" style={{ background: "#E11D48" }} />
                        </div>
                      )}

                      {timedShifts.map((s) => {
                        const startHHMM = format(new Date(s.scheduled_start!), "HH:mm");
                        const endHHMM = s.scheduled_end ? format(new Date(s.scheduled_end), "HH:mm") : minutesToHHMM(hhmmToMinutes(startHHMM) + 60);
                        const top = timeTopPx(startHHMM);
                        const height = Math.max(22, timeTopPx(endHHMM) - top);
                        const vacant = isVacantShift(s);
                        return (
                          <button
                            key={s.id}
                            onClick={(e) => { e.stopPropagation(); setViewing({ kind: "shift", shift: s }); }}
                            className="absolute left-0.5 right-0.5 overflow-hidden rounded-md px-1.5 py-1 text-left"
                            style={{ top, height, background: vacant ? AMBER_SOFT : BLUE_SOFT, borderLeft: `3px solid ${vacant ? AMBER : BLUE}` }}
                          >
                            <p className="truncate text-[9px] font-black" style={{ color: vacant ? AMBER : BLUE }}>
                              {format(new Date(s.scheduled_start!), "h:mmaaa").toLowerCase()} {s.participant_name || "Participant"}
                            </p>
                          </button>
                        );
                      })}

                      {timedEvents.map((ev) => {
                        const cfg = EVENT_CFG[ev.event_type] ?? EVENT_CFG.meeting;
                        const top = timeTopPx(ev.start_time!);
                        const height = Math.max(22, (parseDurationMinutes(ev.duration) / 60) * HOUR_PX);
                        return (
                          <button
                            key={ev.id}
                            onClick={(e) => { e.stopPropagation(); setViewing({ kind: "event", event: ev }); }}
                            className="absolute left-0.5 right-0.5 overflow-hidden rounded-md px-1.5 py-1 text-left"
                            style={{ top, height, background: cfg.bg, borderLeft: `3px solid ${cfg.color}` }}
                          >
                            <p className="truncate text-[9px] font-black" style={{ color: cfg.color }}>{ev.title}</p>
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

      {/* Add Schedule / view-detail overlay — a compact floating card rather
          than a side sheet, so it reads the same whether opened from the top
          button, the month day panel's "+", or a click on an empty hour slot. */}
      {(formOpen || viewing) && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
          onClick={() => { setFormOpen(false); setViewing(null); }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-2xl border p-4 shadow-2xl"
            style={{ borderColor: BORDER, background: SURFACE }}
          >
            {formOpen && (
              <form onSubmit={handleAdd} className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-black flex items-center gap-1.5" style={{ color: TEXT }}>
                    <Plus size={15} style={{ color: PLUM }} /> Add Schedule
                  </p>
                  <button type="button" onClick={() => setFormOpen(false)} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-cc-soft" aria-label="Close">
                    <X size={13} style={{ color: MUTED }} />
                  </button>
                </div>

                <Input
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="New event title"
                  className="text-[13px] font-bold"
                  autoFocus
                  required
                />

                <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5" style={{ borderColor: BORDER }}>
                  <CalendarDays size={13} style={{ color: MUTED }} />
                  <input
                    type="date"
                    value={form.event_date}
                    onChange={(e) => setForm((f) => ({ ...f, event_date: e.target.value }))}
                    className="w-full bg-transparent text-[12px] font-semibold outline-none"
                    style={{ color: TEXT }}
                    required
                  />
                </div>

                <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5" style={{ borderColor: BORDER }}>
                  <Clock size={13} style={{ color: MUTED }} />
                  <input
                    type="time"
                    value={form.start_time}
                    onChange={(e) => setForm((f) => ({ ...f, start_time: e.target.value }))}
                    className="bg-transparent text-[12px] font-semibold outline-none"
                    style={{ color: TEXT }}
                    required
                  />
                  <span style={{ color: MUTED }}>→</span>
                  <input
                    type="time"
                    value={form.end_time}
                    onChange={(e) => setForm((f) => ({ ...f, end_time: e.target.value }))}
                    className="bg-transparent text-[12px] font-semibold outline-none"
                    style={{ color: TEXT }}
                    required
                  />
                </div>

                <div className="flex items-center gap-2">
                  {(Object.keys(EVENT_CFG) as EventType[]).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, event_type: t }))}
                      className="h-6 w-6 rounded-full transition-shadow"
                      style={{
                        background: EVENT_CFG[t].color,
                        boxShadow: form.event_type === t ? `0 0 0 2px ${SURFACE}, 0 0 0 4px ${EVENT_CFG[t].color}` : "none",
                      }}
                      aria-label={EVENT_CFG[t].label}
                      title={EVENT_CFG[t].label}
                    />
                  ))}
                  <span className="text-[10px] font-bold" style={{ color: MUTED }}>{EVENT_CFG[form.event_type].label}</span>
                </div>

                <div className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5" style={{ borderColor: BORDER }}>
                  <MapPin size={13} style={{ color: MUTED }} />
                  <input
                    value={form.location}
                    onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                    placeholder="Location (optional)"
                    className="w-full bg-transparent text-[12px] font-semibold outline-none"
                    style={{ color: TEXT }}
                  />
                </div>

                <Textarea
                  value={form.participants_desc}
                  onChange={(e) => setForm((f) => ({ ...f, participants_desc: e.target.value }))}
                  placeholder="Add description — who's involved, agenda notes…"
                  className="min-h-[64px] text-[12px]"
                />

                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => setFormOpen(false)}>Cancel</Button>
                  <Button type="submit" variant="navy" size="sm" disabled={saving || !form.title.trim() || !form.event_date}>
                    {saving ? "Adding…" : "Save"}
                  </Button>
                </div>
              </form>
            )}

            {viewing?.kind === "shift" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-black" style={{ color: TEXT }}>Appointment</p>
                  <button onClick={() => setViewing(null)} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-cc-soft" aria-label="Close">
                    <X size={13} style={{ color: MUTED }} />
                  </button>
                </div>
                <ShiftCard s={viewing.shift} />
              </div>
            )}

            {viewing?.kind === "event" && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[13px] font-black" style={{ color: TEXT }}>Meeting</p>
                  <button onClick={() => setViewing(null)} className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-cc-soft" aria-label="Close">
                    <X size={13} style={{ color: MUTED }} />
                  </button>
                </div>
                <EventCard ev={viewing.event} onDelete={(id) => { handleDelete(id); setViewing(null); }} />
              </div>
            )}
          </div>
        </div>
      )}
    </HubLayout>
  );
}
