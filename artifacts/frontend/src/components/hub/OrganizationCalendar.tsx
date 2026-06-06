import { useEffect, useState } from "react";
import { format, parseISO, addDays, addWeeks, differenceInDays } from "date-fns";
import { Calendar, ClipboardCheck, Users, BookOpen, Target, Plus, Trash2, AlertTriangle, MapPin } from "lucide-react";
import { getOrgEvents, createOrgEvent, deleteOrgEvent, type OrgEvent } from "@/services/hubService";
import { useAuth } from "@/contexts/AuthContext";

const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT = "#F5F3FC";

type EventType = "audit" | "training" | "meeting" | "review";

const now = new Date();

const EVENT_CONFIG: Record<
  EventType,
  { icon: React.ComponentType<{ size?: number; strokeWidth?: number }>; label: string; color: string; bg: string; chip: string }
> = {
  audit: {
    icon: ClipboardCheck,
    label: "Audit",
    color: "#EF4444",
    bg: "#FEF2F2",
    chip: "bg-red-50 text-red-700 border border-red-200",
  },
  training: {
    icon: BookOpen,
    label: "Training",
    color: "#5533CC",
    bg: "#EEEAFB",
    chip: "bg-purple-50 text-purple-700 border border-purple-200",
  },
  meeting: {
    icon: Users,
    label: "Meeting",
    color: "#0EA5E9",
    bg: "#E0F2FE",
    chip: "bg-blue-50 text-blue-700 border border-blue-200",
  },
  review: {
    icon: Target,
    label: "Goal Review",
    color: "#10B981",
    bg: "#D1FAE5",
    chip: "bg-emerald-50 text-emerald-700 border border-emerald-200",
  },
};

const EVENT_TYPES: EventType[] = ["audit", "training", "meeting", "review"];

function EventCard({
  event,
  onDelete,
  isCoordinator,
}: {
  event: OrgEvent;
  onDelete?: (id: string) => void;
  isCoordinator: boolean;
}) {
  const cfg = EVENT_CONFIG[event.event_type as EventType] ?? EVENT_CONFIG.meeting;
  const Icon = cfg.icon;
  const eventDate = parseISO(event.event_date);
  const daysUntil = differenceInDays(eventDate, now);
  const isImminent = daysUntil >= 0 && daysUntil < 7;

  return (
    <div className="flex gap-4 rounded-xl border p-4" style={{ borderColor: BORDER }}>
      <div
        className="flex w-14 shrink-0 flex-col items-center justify-center rounded-xl py-2 text-center"
        style={{ background: cfg.bg }}
      >
        <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: cfg.color }}>
          {format(eventDate, "MMM")}
        </span>
        <span className="text-xl font-black leading-none" style={{ color: cfg.color }}>
          {format(eventDate, "d")}
        </span>
        <span className="text-[9px] font-bold" style={{ color: cfg.color }}>
          {format(eventDate, "EEE")}
        </span>
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black ${cfg.chip}`}>
            <Icon size={9} strokeWidth={2.5} />
            {cfg.label}
          </span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: SOFT, color: MUTED }}>
            {event.duration}
          </span>
          {isImminent && (
            <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-700 border border-amber-200">
              Coming up
            </span>
          )}
        </div>
        <h3 className="mt-1.5 text-[13px] font-black leading-snug" style={{ color: TEXT }}>
          {event.title}
        </h3>
        {event.location && (
          <p className="mt-0.5 flex items-center gap-1 text-[12px] font-medium" style={{ color: MUTED }}>
            <MapPin size={11} strokeWidth={2.5} />
            {event.location}
          </p>
        )}
        {event.participants_desc && (
          <p className="mt-0.5 flex items-center gap-1 text-[12px] font-medium" style={{ color: MUTED }}>
            <Users size={11} strokeWidth={2.5} />
            {event.participants_desc}
          </p>
        )}
      </div>

      {isCoordinator && onDelete && (
        <button
          onClick={() => onDelete(event.id)}
          className="ml-1 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-red-50"
          style={{ color: MUTED }}
          title="Delete event"
        >
          <Trash2 size={13} strokeWidth={2.5} />
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
  const isCoordinator = user?.role === "support_coordinator";

  const [events, setEvents] = useState<OrgEvent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [form, setForm] = useState(BLANK_FORM);

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
        title: form.title,
        event_date: form.event_date,
        duration: form.duration || "1 hour",
        event_type: form.event_type,
        location: form.location || null,
        participants_desc: form.participants_desc || null,
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
    <section className="rounded-2xl border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black" style={{ color: TEXT }}>
            Organisation Calendar
          </h2>
          <p className="mt-0.5 text-[12px] font-medium" style={{ color: MUTED }}>
            Upcoming audits, training, meetings & reviews
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isCoordinator && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black transition-colors"
              style={{ background: SOFT, color: "#5533CC" }}
            >
              <Plus size={13} strokeWidth={2.5} />
              Add
            </button>
          )}
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{ background: SOFT, color: "#5533CC" }}
          >
            <Calendar size={16} strokeWidth={2.5} />
          </div>
        </div>
      </div>

      {deleteError && (
        <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 border border-red-200">
          {deleteError}
        </p>
      )}

      {showForm && isCoordinator && (
        <form onSubmit={handleAdd} className="mb-4 rounded-xl border p-4 space-y-3" style={{ borderColor: BORDER, background: SOFT }}>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2">
              <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>Title *</label>
              <input
                className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
                style={{ borderColor: BORDER }}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Event title"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>Date *</label>
              <input
                type="date"
                className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
                style={{ borderColor: BORDER }}
                value={form.event_date}
                onChange={(e) => setForm((f) => ({ ...f, event_date: e.target.value }))}
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>Duration</label>
              <input
                className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
                style={{ borderColor: BORDER }}
                value={form.duration}
                onChange={(e) => setForm((f) => ({ ...f, duration: e.target.value }))}
                placeholder="e.g. 2 hours"
              />
            </div>
            <div>
              <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>Type</label>
              <select
                className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
                style={{ borderColor: BORDER }}
                value={form.event_type}
                onChange={(e) => setForm((f) => ({ ...f, event_type: e.target.value as EventType }))}
              >
                {EVENT_TYPES.map((t) => (
                  <option key={t} value={t}>{EVENT_CONFIG[t].label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>Location</label>
              <input
                className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
                style={{ borderColor: BORDER }}
                value={form.location}
                onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                placeholder="Optional"
              />
            </div>
            <div className="col-span-2">
              <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>Who attends</label>
              <input
                className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
                style={{ borderColor: BORDER }}
                value={form.participants_desc}
                onChange={(e) => setForm((f) => ({ ...f, participants_desc: e.target.value }))}
                placeholder="e.g. All clinical staff"
              />
            </div>
          </div>
          {saveError && (
            <p className="rounded-lg bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 border border-red-200">
              {saveError}
            </p>
          )}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={() => { setShowForm(false); setSaveError(null); }}
              className="rounded-lg px-3 py-1.5 text-[11px] font-black"
              style={{ background: "#E2DEF2", color: MUTED }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg px-4 py-1.5 text-[11px] font-black text-white"
              style={{ background: "#5533CC", opacity: saving ? 0.6 : 1 }}
            >
              {saving ? "Saving…" : "Add Event"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl" style={{ background: SOFT }} />
          ))}
        </div>
      ) : fetchError ? (
        <div className="rounded-xl border p-6 text-center" style={{ borderColor: BORDER }}>
          <AlertTriangle size={24} className="mx-auto mb-2" style={{ color: "#F97316" }} />
          <p className="text-[13px] font-black" style={{ color: TEXT }}>Could not load calendar</p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>Check your connection and try again.</p>
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-xl border p-6 text-center" style={{ borderColor: BORDER }}>
          <Calendar size={24} className="mx-auto mb-2" style={{ color: MUTED }} />
          <p className="text-[13px] font-black" style={{ color: TEXT }}>No upcoming events</p>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>
            {isCoordinator ? "Use the Add button above to schedule the first event." : "Your coordinator will add events here."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sorted.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onDelete={isCoordinator ? handleDelete : undefined}
              isCoordinator={isCoordinator}
            />
          ))}
        </div>
      )}
    </section>
  );
}
