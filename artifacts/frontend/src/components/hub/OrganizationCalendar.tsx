import { useEffect, useMemo, useState } from "react";
import {
  format, parseISO, differenceInDays, startOfMonth, endOfMonth,
  startOfWeek, endOfWeek, eachDayOfInterval, isSameDay, isSameMonth,
  isToday, addMonths, subMonths,
} from "date-fns";
import {
  Calendar, ClipboardCheck, Users, BookOpen, Target,
  Plus, Trash2, AlertTriangle, MapPin, ChevronLeft, ChevronRight, Clock,
} from "lucide-react";
import { getOrgEvents, createOrgEvent, deleteOrgEvent, type OrgEvent } from "@/services/hubService";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";
const PLUM   = "var(--cc-plum)";

type EventType = "audit" | "training" | "meeting" | "review";

const EVENT_CFG: Record<EventType, {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties; className?: string }>;
  labelKey: string;
  color: string;
  bg: string;
  dot: string;
}> = {
  audit:    { icon: ClipboardCheck, labelKey: "hub.calendar.eventType.audit",    color: "#EF4444", bg: "#FEF2F2", dot: "#EF4444" },
  training: { icon: BookOpen,       labelKey: "hub.calendar.eventType.training", color: PLUM,      bg: "var(--cc-active-bg)", dot: PLUM },
  meeting:  { icon: Users,          labelKey: "hub.calendar.eventType.meeting",  color: "#0EA5E9", bg: "#E0F2FE", dot: "#0EA5E9" },
  review:   { icon: Target,         labelKey: "hub.calendar.eventType.review",   color: "#10B981", bg: "#D1FAE5", dot: "#10B981" },
};

const EVENT_TYPES: EventType[] = ["audit", "training", "meeting", "review"];

function cfgOf(type: string) {
  return EVENT_CFG[type as EventType] ?? EVENT_CFG.meeting;
}

const BLANK = {
  title: "", event_date: "", duration: "1 hour",
  event_type: "meeting" as EventType, location: "", participants_desc: "",
};

function EventCard({
  event, onDelete, isCoordinator,
}: {
  event: OrgEvent;
  onDelete?: (id: string) => void;
  isCoordinator: boolean;
}) {
  const { translate } = useAccessibility();
  const cfg       = cfgOf(event.event_type);
  const Icon      = cfg.icon;
  const eventDate = parseISO(event.event_date);
  const daysLeft  = differenceInDays(eventDate, new Date());
  const passed    = daysLeft < 0;
  const soon      = daysLeft >= 0 && daysLeft < 7;

  return (
    <div className="flex items-start gap-3 py-2.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
      <div
        className="flex w-10 shrink-0 flex-col items-center justify-center rounded-xl py-1.5"
        style={{ background: passed ? "#F1F5F9" : cfg.bg, opacity: passed ? 0.6 : 1 }}
      >
        <span className="text-[9px] font-black uppercase tracking-wide leading-none" style={{ color: passed ? MUTED : cfg.color }}>
          {format(eventDate, "MMM")}
        </span>
        <span className="text-[17px] font-black leading-none mt-0.5" style={{ color: passed ? MUTED : cfg.color }}>
          {format(eventDate, "d")}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
          <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black" style={{ background: cfg.bg, color: cfg.color }}>
            <Icon size={9} strokeWidth={2} /> {translate(cfg.labelKey)}
          </span>
          {soon   && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">{translate("hub.calendar.soon")}</span>}
          {passed && <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-bold text-slate-400">{translate("hub.calendar.past")}</span>}
        </div>
        <p className="truncate text-[12px] font-bold" style={{ color: TEXT }}>{event.title}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px]" style={{ color: MUTED }}>
          {event.duration && <span className="flex items-center gap-1"><Clock size={9} /> {event.duration}</span>}
          {event.location  && <span className="flex items-center gap-1"><MapPin size={9} /> {event.location}</span>}
        </div>
      </div>
      {isCoordinator && onDelete && (
        <button
          onClick={() => onDelete(event.id)}
          className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-red-50"
          style={{ color: MUTED }}
        >
          <Trash2 size={11} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

export function OrganizationCalendar() {
  const { translate, translateParams } = useAccessibility();
  const { user } = useAuth();
  const isCoordinator = user?.role === "support_coordinator" || user?.role === "managing_director";

  const [events,      setEvents]      = useState<OrgEvent[] | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [fetchError,  setFetchError]  = useState(false);
  const [showForm,    setShowForm]    = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [saveError,   setSaveError]   = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [form,        setForm]        = useState(BLANK);
  const [calMonth,    setCalMonth]    = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getOrgEvents()
      .then((data) => { if (!cancelled) setEvents(data); })
      .catch(() => { if (!cancelled) setFetchError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const sorted = useMemo(
    () => (events ?? []).sort((a, b) => a.event_date.localeCompare(b.event_date)),
    [events]
  );

  const eventsByDay = useMemo(() => {
    const map = new Map<string, OrgEvent[]>();
    for (const ev of (events ?? [])) {
      const key = ev.event_date.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), ev]);
    }
    return map;
  }, [events]);

  const calGridStart = startOfWeek(startOfMonth(calMonth), { weekStartsOn: 1 });
  const calGridEnd   = endOfWeek(endOfMonth(calMonth),     { weekStartsOn: 1 });
  const calDays      = eachDayOfInterval({ start: calGridStart, end: calGridEnd });

  const upcoming = useMemo(() => {
    const now     = new Date();
    const cutoff  = addMonths(now, 1);
    return sorted.filter((e) => {
      const d = parseISO(e.event_date);
      return d >= now && d <= cutoff;
    });
  }, [sorted]);

  const dayEvents = selectedDay
    ? (eventsByDay.get(format(selectedDay, "yyyy-MM-dd")) ?? [])
    : [];

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.event_date) return;
    setSaving(true);
    setSaveError(null);
    try {
      const created = await createOrgEvent({
        title:             form.title,
        event_date:        form.event_date,
        duration:          form.duration || "1 hour",
        event_type:        form.event_type,
        location:          form.location || null,
        participants_desc: form.participants_desc || null,
      });
      setEvents((prev) => [...(prev ?? []), created]);
      setShowForm(false);
      setForm(BLANK);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : translate("hub.calendar.createFailed"));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleteError(null);
    try {
      await deleteOrgEvent(id);
      setEvents((prev) => (prev ?? []).filter((e) => e.id !== id));
      if (selectedDay && dayEvents.length <= 1) setSelectedDay(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : translate("hub.calendar.deleteFailed"));
    }
  }

  return (
    <div className="rounded-2xl border bg-cc-surface shadow-sm overflow-hidden" style={{ borderColor: BORDER }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3.5" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <p className="text-[11px] font-black uppercase tracking-[0.2em]" style={{ color: MUTED }}>{translate("hub.calendar.title")}</p>
        <div className="flex items-center gap-2">
          {isCoordinator && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-bold transition-colors hover:bg-cc-active-bg"
              style={{ background: SOFT, color: PLUM }}
            >
              <Plus size={11} strokeWidth={2} /> {translate("hub.calendar.addEvent")}
            </button>
          )}
          <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: SOFT, color: PLUM }}>
            <Calendar size={13} strokeWidth={2} />
          </div>
        </div>
      </div>

      <div className="px-4 pb-2">
        {deleteError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 border border-red-200">
            {deleteError}
          </p>
        )}

        {/* Add event form */}
        {showForm && isCoordinator && (
          <form onSubmit={handleAdd} className="mt-3 rounded-xl border p-4 space-y-3" style={{ borderColor: BORDER, background: SOFT }}>
            <div>
              <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>{translate("hub.calendar.formTitle")}</label>
              <input
                className="w-full rounded-lg border px-3 py-2 text-[12px] outline-none focus:border-cc-plum transition-colors"
                style={{ borderColor: BORDER }}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder={translate("hub.calendar.eventTitlePlaceholder")}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>{translate("hub.calendar.date")}</label>
                <input
                  type="date"
                  className="w-full rounded-lg border px-3 py-2 text-[12px] outline-none"
                  style={{ borderColor: BORDER }}
                  value={form.event_date}
                  onChange={(e) => setForm((f) => ({ ...f, event_date: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>{translate("hub.calendar.type")}</label>
                <select
                  className="w-full rounded-lg border px-3 py-2 text-[12px] outline-none"
                  style={{ borderColor: BORDER }}
                  value={form.event_type}
                  onChange={(e) => setForm((f) => ({ ...f, event_type: e.target.value as EventType }))}
                >
                  {EVENT_TYPES.map((t) => <option key={t} value={t}>{translate(EVENT_CFG[t].labelKey)}</option>)}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>{translate("hub.calendar.duration")}</label>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-[12px] outline-none"
                  style={{ borderColor: BORDER }}
                  value={form.duration}
                  onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
                  placeholder={translate("hub.calendar.durationPlaceholder")}
                />
              </div>
              <div>
                <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>{translate("hub.calendar.location")}</label>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-[12px] outline-none"
                  style={{ borderColor: BORDER }}
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder={translate("common.optional")}
                />
              </div>
            </div>
            {saveError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] font-medium text-red-700">{saveError}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => { setShowForm(false); setSaveError(null); }}
                className="rounded-lg px-3 py-1.5 text-[11px] font-bold"
                style={{ background: BORDER, color: MUTED }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="rounded-lg px-4 py-1.5 text-[11px] font-bold text-white"
                style={{ background: PLUM, opacity: saving ? 0.65 : 1 }}
              >
                {saving ? translate("common.saving") : translate("hub.calendar.addEvent")}
              </button>
            </div>
          </form>
        )}

        {/* Mini calendar */}
        <div className="mt-3">
          {/* Month navigation */}
          <div className="flex items-center justify-between mb-2">
            <button
              onClick={() => setCalMonth((m) => subMonths(m, 1))}
              className="h-6 w-6 flex items-center justify-center rounded transition-colors hover:bg-cc-soft"
              style={{ color: MUTED }}
            >
              <ChevronLeft size={13} />
            </button>
            <p className="text-[12px] font-black" style={{ color: TEXT }}>{format(calMonth, "MMMM yyyy")}</p>
            <button
              onClick={() => setCalMonth((m) => addMonths(m, 1))}
              className="h-6 w-6 flex items-center justify-center rounded transition-colors hover:bg-cc-soft"
              style={{ color: MUTED }}
            >
              <ChevronRight size={13} />
            </button>
          </div>

          {/* Week labels */}
          <div className="grid grid-cols-7 mb-0.5">
            {["M", "T", "W", "T", "F", "S", "S"].map((l, i) => (
              <div key={i} className="text-center text-[9px] font-black uppercase py-0.5" style={{ color: MUTED }}>{l}</div>
            ))}
          </div>

          {/* Day cells */}
          <div className="grid grid-cols-7">
            {calDays.map((day) => {
              const key        = format(day, "yyyy-MM-dd");
              const evs        = eventsByDay.get(key) ?? [];
              const today      = isToday(day);
              const inMonth    = isSameMonth(day, calMonth);
              const isSelected = selectedDay ? isSameDay(day, selectedDay) : false;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedDay(isSelected ? null : day)}
                  className="flex flex-col items-center py-0.5 rounded-lg transition-colors hover:bg-cc-soft"
                  style={{ background: isSelected ? "var(--cc-active-bg)" : "transparent", opacity: inMonth ? 1 : 0.3 }}
                >
                  <span
                    className="flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold"
                    style={{
                      background: today ? PLUM : "transparent",
                      color:      today ? "white" : isSelected ? PLUM : inMonth ? TEXT : MUTED,
                    }}
                  >
                    {format(day, "d")}
                  </span>
                  {evs.length > 0 && (
                    <div className="flex gap-0.5 mt-0.5 mb-0.5">
                      {evs.slice(0, 3).map((ev, idx) => (
                        <span
                          key={idx}
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: cfgOf(ev.event_type).dot }}
                        />
                      ))}
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Selected day events */}
        {selectedDay && dayEvents.length > 0 && (
          <div className="mt-2 mb-1 rounded-xl border p-3" style={{ borderColor: BORDER, background: SOFT }}>
            <p className="text-[10px] font-black uppercase tracking-widest mb-2" style={{ color: MUTED }}>
              {format(selectedDay, "EEEE d MMMM")}
            </p>
            {dayEvents.map((ev) => {
              const cfg  = cfgOf(ev.event_type);
              const Icon = cfg.icon;
              return (
                <div key={ev.id} className="flex items-center gap-2 py-1.5">
                  <div className="h-5 w-5 shrink-0 flex items-center justify-center rounded" style={{ background: cfg.bg }}>
                    <Icon size={10} style={{ color: cfg.color }} />
                  </div>
                  <p className="flex-1 truncate text-[12px] font-bold" style={{ color: TEXT }}>{ev.title}</p>
                  {isCoordinator && (
                    <button
                      onClick={() => handleDelete(ev.id)}
                      className="flex h-5 w-5 items-center justify-center rounded hover:bg-red-50 transition-colors"
                    >
                      <Trash2 size={10} style={{ color: MUTED }} />
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Upcoming events list */}
        <div style={{ borderTop: `1px solid ${BORDER}` }} className="mt-2">
          <p className="pt-3 pb-1 text-[10px] font-black uppercase tracking-widest" style={{ color: MUTED }}>
            {translate("hub.calendar.upcoming")}
          </p>
          {loading ? (
            <div className="py-3 space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="h-10 w-10 animate-pulse rounded-xl" style={{ background: SOFT }} />
                  <div className="flex-1 space-y-1.5 pt-1">
                    <div className="h-2.5 w-28 animate-pulse rounded" style={{ background: SOFT }} />
                    <div className="h-2 w-20 animate-pulse rounded" style={{ background: SOFT }} />
                  </div>
                </div>
              ))}
            </div>
          ) : fetchError ? (
            <div className="py-5 text-center">
              <AlertTriangle size={16} className="mx-auto mb-1" style={{ color: "#F97316" }} />
              <p className="text-[12px] font-bold" style={{ color: TEXT }}>{translate("hub.calendar.loadFailed")}</p>
            </div>
          ) : upcoming.length === 0 ? (
            <div className="py-5 text-center">
              <Calendar size={16} className="mx-auto mb-1.5" style={{ color: MUTED }} />
              <p className="text-[12px] font-bold" style={{ color: TEXT }}>{translate("hub.calendar.noUpcoming")}</p>
              <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
                {isCoordinator ? translate("hub.calendar.coordinatorHint") : translate("hub.calendar.workerHint")}
              </p>
            </div>
          ) : (
            <div className="pb-2">
              {upcoming.slice(0, 6).map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onDelete={isCoordinator ? handleDelete : undefined}
                  isCoordinator={isCoordinator}
                />
              ))}
              {upcoming.length > 6 && (
                <p className="py-2 text-[11px] font-bold" style={{ color: PLUM }}>
                  {translateParams("hub.calendar.moreEvents", { count: String(upcoming.length - 6) })}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
