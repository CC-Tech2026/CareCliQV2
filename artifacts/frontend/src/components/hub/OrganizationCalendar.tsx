import { useEffect, useState } from "react";
import { format, parseISO, differenceInDays } from "date-fns";
import {
  Calendar, ClipboardCheck, Users, BookOpen, Target,
  Plus, Trash2, AlertTriangle, MapPin,
} from "lucide-react";
import { getOrgEvents, createOrgEvent, deleteOrgEvent, type OrgEvent } from "@/services/hubService";
import { useAuth } from "@/contexts/AuthContext";

const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT   = "#F5F3FC";
const PLUM   = "#5533CC";

type EventType = "audit" | "training" | "meeting" | "review";

const now = new Date();

const EVENT_CONFIG: Record<
  EventType,
  { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; label: string; color: string; bg: string; chip: string }
> = {
  audit:    { icon: ClipboardCheck, label: "Audit",    color: "#EF4444", bg: "#FEF2F2", chip: "bg-red-50 text-red-700" },
  training: { icon: BookOpen,       label: "Training", color: PLUM,      bg: "#EEEAFB", chip: "bg-purple-50 text-purple-700" },
  meeting:  { icon: Users,          label: "Meeting",  color: "#0EA5E9", bg: "#E0F2FE", chip: "bg-sky-50 text-sky-700" },
  review:   { icon: Target,         label: "Review",   color: "#10B981", bg: "#D1FAE5", chip: "bg-emerald-50 text-emerald-700" },
};

const EVENT_TYPES: EventType[] = ["audit", "training", "meeting", "review"];

function EventRow({
  event,
  onDelete,
  isCoordinator,
}: {
  event: OrgEvent;
  onDelete?: (id: string) => void;
  isCoordinator: boolean;
}) {
  const cfg       = EVENT_CONFIG[event.event_type as EventType] ?? EVENT_CONFIG.meeting;
  const Icon      = cfg.icon;
  const eventDate = parseISO(event.event_date);
  const daysUntil = differenceInDays(eventDate, now);
  const isImminent = daysUntil >= 0 && daysUntil < 7;

  return (
    <div
      className="flex items-start gap-3 py-3"
      style={{ borderBottom: `1px solid ${BORDER}` }}
    >
      {/* Compact date block */}
      <div
        className="flex w-10 shrink-0 flex-col items-center justify-center rounded-xl py-1.5 text-center"
        style={{ background: cfg.bg }}
      >
        <span className="text-[9px] font-black uppercase tracking-wide leading-none" style={{ color: cfg.color }}>
          {format(eventDate, "MMM")}
        </span>
        <span className="text-[16px] font-black leading-none mt-0.5" style={{ color: cfg.color }}>
          {format(eventDate, "d")}
        </span>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-black ${cfg.chip}`}>
            <Icon size={9} strokeWidth={2} />
            {cfg.label}
          </span>
          {isImminent && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700">
              Soon
            </span>
          )}
        </div>
        <p className="mt-1 truncate text-[12px] font-bold leading-snug" style={{ color: TEXT }}>
          {event.title}
        </p>
        {event.location && (
          <p className="mt-0.5 flex items-center gap-1 truncate text-[11px]" style={{ color: MUTED }}>
            <MapPin size={10} strokeWidth={2} />
            {event.location}
          </p>
        )}
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

const BLANK_FORM = {
  title: "",
  event_date: "",
  duration: "1 hour",
  event_type: "meeting" as EventType,
  location: "",
  participants_desc: "",
};

export function OrganizationCalendar() {
  const { user } = useAuth();
  const isCoordinator = user?.role === "support_coordinator" || user?.role === "managing_director";

  const [events,      setEvents]      = useState<OrgEvent[] | null>(null);
  const [loading,     setLoading]     = useState(true);
  const [fetchError,  setFetchError]  = useState(false);
  const [showForm,    setShowForm]    = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [saveError,   setSaveError]   = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [form,        setForm]        = useState(BLANK_FORM);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFetchError(false);
    getOrgEvents()
      .then((data) => { if (!cancelled) setEvents(data); })
      .catch(() => { if (!cancelled) setFetchError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const sorted = events ? [...events].sort((a, b) => a.event_date.localeCompare(b.event_date)) : [];

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.event_date) return;
    setSaving(true);
    setSaveError(null);
    try {
      const created = await createOrgEvent({
        title:            form.title,
        event_date:       form.event_date,
        duration:         form.duration || "1 hour",
        event_type:       form.event_type,
        location:         form.location || null,
        participants_desc:form.participants_desc || null,
      });
      setEvents((prev) => [...(prev ?? []), created]);
      setShowForm(false);
      setForm(BLANK_FORM);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not create event.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleteError(null);
    try {
      await deleteOrgEvent(id);
      setEvents((prev) => (prev ?? []).filter((e) => e.id !== id));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete event.");
    }
  }

  return (
    <div className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
        <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: MUTED }}>
          Upcoming Events
        </p>
        <div className="flex items-center gap-2">
          {isCoordinator && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition-colors"
              style={{ background: SOFT, color: PLUM }}
            >
              <Plus size={11} strokeWidth={2} />
              Add
            </button>
          )}
          <div
            className="flex h-7 w-7 items-center justify-center rounded-lg"
            style={{ background: SOFT, color: PLUM }}
          >
            <Calendar size={13} strokeWidth={2} />
          </div>
        </div>
      </div>

      <div className="px-5">
        {deleteError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 border border-red-200">
            {deleteError}
          </p>
        )}

        {showForm && isCoordinator && (
          <form
            onSubmit={handleAdd}
            className="mt-3 rounded-xl border p-4 space-y-3"
            style={{ borderColor: BORDER, background: SOFT }}
          >
            <div className="space-y-2">
              <div>
                <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>Title *</label>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-[12px] outline-none"
                  style={{ borderColor: BORDER }}
                  value={form.title}
                  onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                  placeholder="Event title"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>Date *</label>
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
                  <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>Type</label>
                  <select
                    className="w-full rounded-lg border px-3 py-2 text-[12px] outline-none"
                    style={{ borderColor: BORDER }}
                    value={form.event_type}
                    onChange={(e) => setForm((f) => ({ ...f, event_type: e.target.value as EventType }))}
                  >
                    {EVENT_TYPES.map((t) => (
                      <option key={t} value={t}>{EVENT_CONFIG[t].label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>Location</label>
                <input
                  className="w-full rounded-lg border px-3 py-2 text-[12px] outline-none"
                  style={{ borderColor: BORDER }}
                  value={form.location}
                  onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                  placeholder="Optional"
                />
              </div>
            </div>
            {saveError && (
              <p className="rounded-lg bg-red-50 px-3 py-2 text-[11px] font-medium text-red-700">
                {saveError}
              </p>
            )}
            <div className="flex gap-2 justify-end">
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
                {saving ? "Saving…" : "Add Event"}
              </button>
            </div>
          </form>
        )}

        {loading ? (
          <div className="py-4 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-start gap-3">
                <div className="h-10 w-10 animate-pulse rounded-xl" style={{ background: SOFT }} />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-28 animate-pulse rounded" style={{ background: SOFT }} />
                  <div className="h-2.5 w-20 animate-pulse rounded" style={{ background: SOFT }} />
                </div>
              </div>
            ))}
          </div>
        ) : fetchError ? (
          <div className="py-6 text-center">
            <AlertTriangle size={18} className="mx-auto mb-2" style={{ color: "#F97316" }} />
            <p className="text-[12px] font-bold" style={{ color: TEXT }}>Could not load calendar</p>
          </div>
        ) : sorted.length === 0 ? (
          <div className="py-6 text-center">
            <Calendar size={18} className="mx-auto mb-2" style={{ color: MUTED }} />
            <p className="text-[12px] font-bold" style={{ color: TEXT }}>No upcoming events</p>
            <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
              {isCoordinator ? "Use Add to schedule events." : "Your coordinator will add events here."}
            </p>
          </div>
        ) : (
          <div>
            {sorted.slice(0, 5).map((event) => (
              <EventRow
                key={event.id}
                event={event}
                onDelete={isCoordinator ? handleDelete : undefined}
                isCoordinator={isCoordinator}
              />
            ))}
            {sorted.length > 5 && (
              <p className="py-3 text-[11px] font-bold" style={{ color: PLUM }}>
                +{sorted.length - 5} more events
              </p>
            )}
            <div style={{ marginBottom: "4px" }} />
          </div>
        )}
      </div>
    </div>
  );
}
