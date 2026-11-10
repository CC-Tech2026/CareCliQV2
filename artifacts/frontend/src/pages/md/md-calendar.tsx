import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Redirect, useSearch } from "wouter";
import {
  format, parseISO, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, isSameDay, isSameMonth, isToday, addMonths, subMonths, addDays,
} from "date-fns";
import {
  CalendarDays, ChevronLeft, ChevronRight, Plus, MapPin, Clock,
  ClipboardCheck, BookOpen, Users, Target, Briefcase, Video, Mic,
} from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { SectionInfo } from "@/components/ui/section-info";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MeetingBookingSheet, type BookingDraft } from "@/components/calendar/MeetingBookingSheet";
import { MeetingDetailSheet } from "@/components/calendar/MeetingDetailSheet";
import { MEETING_CHOICES, MEETING_MODES, choiceOf, isOnlineMode } from "@/lib/meeting-booking";
import {
  getOrgEvents, createOrgEvent, updateOrgEvent, deleteOrgEvent,
  type InviteResult, type OrgEvent, type OrgEventPayload,
} from "@/services/hubService";
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
function ShiftCard({ s, onOpen }: { s: CoordinatorShiftRecord; onOpen?: () => void }) {
  return (
    <div
      onClick={onOpen}
      className={`rounded-xl border p-3 ${onOpen ? "cursor-pointer hover:border-[var(--cc-plum)]" : ""}`}
      style={{ borderColor: BORDER, background: isVacantShift(s) ? AMBER_SOFT : SOFT }}
    >
      <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-wide" style={{ color: isVacantShift(s) ? AMBER : BLUE }}>
        <Briefcase size={10} /> {isVacantShift(s) ? "Unfilled appointment" : "Appointment"}
      </div>
      <p className="mt-1 text-[12px] font-bold" style={{ color: TEXT }}>
        {s.participant_name || "Participant"} {s.worker_name && !isVacantShift(s) ? `· ${s.worker_name}` : ""}
      </p>
      <p className="mt-0.5 flex items-center gap-1 text-[10px]" style={{ color: MUTED }}>
        <Clock size={9} />
        {s.scheduled_start ? format(new Date(s.scheduled_start), "h:mmaaa").toLowerCase() : "—"}
        {s.scheduled_end ? ` – ${format(new Date(s.scheduled_end), "h:mmaaa").toLowerCase()}` : ""}
      </p>
    </div>
  );
}

/** One line on what happened to the calendar invites. */
function inviteSummary(invites: InviteResult | undefined, update: boolean): string {
  if (!invites) return "";
  if (invites.email_off) return "Email is turned off, so no invites were sent.";
  const sent = invites.sent.length;
  const failed = invites.failed.length;
  const parts = [];
  if (sent) parts.push(`${update ? "Updated invite" : "Calendar invite"} sent to ${sent} ${sent === 1 ? "person" : "people"}.`);
  if (failed) parts.push(`Couldn't reach ${invites.failed.join(", ")}.`);
  return parts.join(" ");
}

function EventCard({ ev, onOpen }: { ev: OrgEvent; onOpen: () => void }) {
  const cfg = EVENT_CFG[ev.event_type] ?? EVENT_CFG.meeting;
  const Icon = cfg.icon;
  const online = isOnlineMode(ev.meeting_mode);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full rounded-xl border p-3 text-left transition-colors hover:border-[var(--cc-plum)]"
      style={{ borderColor: BORDER, background: SURFACE }}
    >
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black" style={{ background: cfg.bg, color: cfg.color }}>
        <Icon size={9} /> {MEETING_CHOICES[choiceOf(ev)]?.label ?? cfg.label}
      </span>
      <p className="mt-1.5 text-[12px] font-bold" style={{ color: TEXT }}>{ev.title}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px]" style={{ color: MUTED }}>
        {ev.start_time && <span className="flex items-center gap-1"><Clock size={9} /> {ev.start_time}{ev.duration ? ` · ${ev.duration}` : ""}</span>}
        {!ev.start_time && ev.duration && <span className="flex items-center gap-1"><Clock size={9} /> {ev.duration}</span>}
        {online && ev.meeting_mode && <span className="flex items-center gap-1"><Video size={9} /> {MEETING_MODES[ev.meeting_mode].label}</span>}
        {!online && ev.location && <span className="flex items-center gap-1"><MapPin size={9} /> {ev.location}</span>}
        {ev.easy_capture && <span className="flex items-center gap-1"><Mic size={9} /> Easy Capture</span>}
      </div>
    </button>
  );
}

const SHIFT_STATUS_LABEL: Record<string, string> = {
  scheduled: "Scheduled",
  in_progress: "In progress",
  clocked_in: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  unassigned: "Unassigned",
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
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => new Date());
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
      const when = `${saved.title} on ${format(parseISO(saved.event_date), "d MMM")}${saved.start_time ? ` at ${saved.start_time}` : ""}.`;
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

  return (
    <HubLayout>
      <div className="space-y-5 pb-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-black flex items-center gap-2" style={{ color: TEXT }}>
              <CalendarDays size={19} style={{ color: PLUM }} /> Calendar
              <SectionInfo text="Every shift across the organisation, plus the meetings you book: participant meetings in person or online, team meetings, training and audits. Staff and shifts are managed in Rostering." />
            </h1>
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
              <Plus size={15} /> Book meeting
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
                {dayEvents.map((ev) => <EventCard key={ev.id} ev={ev} onOpen={() => setViewingEvent(ev)} />)}
                {dayShifts.map((s) => <ShiftCard key={s.id} s={s} onOpen={() => setViewingShift(s)} />)}
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
                            onClick={() => setViewingEvent(ev)}
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
                            onClick={(e) => { e.stopPropagation(); setViewingShift(s); }}
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
                            onClick={(e) => { e.stopPropagation(); setViewingEvent(ev); }}
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
      <Sheet open={!!viewingShift} onOpenChange={(open) => { if (!open) setViewingShift(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          {viewingShift && (
            <>
              <SheetHeader>
                <SheetTitle>{viewingShift.participant_name || "Participant"}</SheetTitle>
                <SheetDescription>
                  {viewingShift.scheduled_start ? format(new Date(viewingShift.scheduled_start), "EEEE d MMMM yyyy") : "Shift"}
                  {" · "}
                  {SHIFT_STATUS_LABEL[isVacantShift(viewingShift) ? "unassigned" : viewingShift.status ?? ""] ?? viewingShift.status}
                </SheetDescription>
              </SheetHeader>
              <div className="mt-5 space-y-4">
                <ShiftCard s={viewingShift} />
                <div className="flex flex-wrap gap-2">
                  <Button asChild variant="navy" className="gap-2">
                    <Link href={`/coordinator/rostering?openShift=${encodeURIComponent(viewingShift.id)}`}>
                      <Briefcase size={15} /> {isVacantShift(viewingShift) ? "Fill in Rostering" : "Open in Rostering"}
                    </Link>
                  </Button>
                  {viewingShift.participant_id && (
                    <Button
                      variant="outline"
                      className="gap-2"
                      onClick={() => {
                        const s = viewingShift;
                        setViewingShift(null);
                        setBookingDraft({ date: s.scheduled_start ? new Date(s.scheduled_start) : effectiveDay, start: "09:00", end: "09:30", participantId: s.participant_id ?? undefined });
                        setEditingEvent(null);
                        setBookingOpen(true);
                      }}
                    >
                      <CalendarDays size={15} /> Book a meeting with them
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </HubLayout>
  );
}
