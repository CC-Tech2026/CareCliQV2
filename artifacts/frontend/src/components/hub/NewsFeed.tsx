import { useEffect, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import {
  Megaphone,
  GraduationCap,
  AlertCircle,
  Star,
  FileText,
  Shield,
  Plus,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import { getAnnouncements, createAnnouncement, deleteAnnouncement, type Announcement } from "@/services/hubService";
import { useAuth } from "@/contexts/AuthContext";

const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT   = "#F5F3FC";
const PLUM   = "#5533CC";

type Severity = "critical" | "high" | "medium" | "info" | "positive";

const ICON_MAP: Record<string, React.ComponentType<{ size?: number; strokeWidth?: number }>> = {
  "Policy Update":    Shield,
  "Training":         GraduationCap,
  "Audit Reminder":   AlertCircle,
  "Staff Achievement":Star,
  "Announcement":     Megaphone,
};

const SEVERITY_STYLES: Record<Severity, { badge: string; label: string }> = {
  critical: { badge: "bg-red-50 text-red-700 border border-red-200",     label: "Critical" },
  high:     { badge: "bg-orange-50 text-orange-700 border border-orange-200", label: "High" },
  medium:   { badge: "bg-amber-50 text-amber-700 border border-amber-200",   label: "Medium" },
  info:     { badge: "bg-blue-50 text-blue-700 border border-blue-200",       label: "Info" },
  positive: { badge: "bg-emerald-50 text-emerald-700 border border-emerald-200", label: "Positive" },
};

const CATEGORIES = ["Announcement", "Policy Update", "Training", "Audit Reminder", "Staff Achievement"];
const SEVERITIES: Severity[] = ["info", "positive", "medium", "high", "critical"];

function NewsCard({
  item,
  onDelete,
  isCoordinator,
}: {
  item: Announcement;
  onDelete?: (id: string) => void;
  isCoordinator: boolean;
}) {
  const sty  = SEVERITY_STYLES[item.severity as Severity] ?? SEVERITY_STYLES.info;
  const Icon = ICON_MAP[item.category] ?? FileText;

  return (
    <div
      className="flex gap-4 rounded-xl border p-4 transition-colors hover:bg-[#FAFAFA]"
      style={{ borderColor: BORDER }}
    >
      <div
        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
        style={{ background: SOFT, color: PLUM }}
      >
        <Icon size={15} strokeWidth={2} />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-black ${sty.badge}`}>
            {sty.label}
          </span>
          <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: SOFT, color: MUTED }}>
            {item.category}
          </span>
        </div>
        <h3 className="mt-1.5 text-[13px] font-bold leading-snug" style={{ color: TEXT }}>
          {item.title}
        </h3>
        <p className="mt-1 text-[12px] leading-relaxed" style={{ color: MUTED }}>
          {item.body}
        </p>
        <p className="mt-2 text-[11px] font-semibold" style={{ color: MUTED }}>
          {formatDistanceToNow(parseISO(item.created_at), { addSuffix: true })}
        </p>
      </div>

      {isCoordinator && onDelete && (
        <button
          onClick={() => onDelete(item.id)}
          className="ml-1 mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-red-50"
          style={{ color: MUTED }}
          title="Delete announcement"
        >
          <Trash2 size={13} strokeWidth={2} />
        </button>
      )}
    </div>
  );
}

const BLANK_FORM = { title: "", body: "", severity: "info" as Severity, category: "Announcement" };

export function NewsFeed() {
  const { user } = useAuth();
  const isCoordinator = user?.role === "support_coordinator";

  const [items,       setItems]       = useState<Announcement[] | null>(null);
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
    getAnnouncements()
      .then((data) => { if (!cancelled) setItems(data); })
      .catch(() => { if (!cancelled) setFetchError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const displayItems = items ?? [];

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title || !form.body) return;
    setSaving(true);
    setSaveError(null);
    try {
      const created = await createAnnouncement(form);
      setItems((prev) => [created, ...(prev ?? [])]);
      setShowForm(false);
      setForm(BLANK_FORM);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not publish announcement.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleteError(null);
    try {
      await deleteAnnouncement(id);
      setItems((prev) => (prev ?? []).filter((i) => i.id !== id));
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Could not delete announcement.");
    }
  }

  return (
    <section className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      {/* Header */}
      <div
        className="flex items-center justify-between gap-3 px-6 py-4"
        style={{ borderBottom: `1px solid ${BORDER}` }}
      >
        <div>
          <h2 className="text-[14px] font-black" style={{ color: TEXT }}>
            News & Announcements
          </h2>
          <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>
            Policy updates, training and org-wide communications
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isCoordinator && (
            <button
              onClick={() => setShowForm((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors"
              style={{ background: SOFT, color: PLUM }}
            >
              <Plus size={12} strokeWidth={2} />
              Publish
            </button>
          )}
          {!loading && (
            <span
              className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-black"
              style={{ background: SOFT, color: PLUM }}
            >
              {fetchError ? "!" : displayItems.length}
            </span>
          )}
        </div>
      </div>

      <div className="px-6 py-5 space-y-4">
        {deleteError && (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-[12px] font-medium text-red-700 border border-red-200">
            {deleteError}
          </p>
        )}

        {showForm && isCoordinator && (
          <form
            onSubmit={handlePublish}
            className="rounded-xl border p-4 space-y-3"
            style={{ borderColor: BORDER, background: SOFT }}
          >
            <div>
              <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>Title *</label>
              <input
                className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
                style={{ borderColor: BORDER }}
                value={form.title}
                onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                placeholder="Announcement title"
                required
              />
            </div>
            <div>
              <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>Body *</label>
              <textarea
                className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1 resize-none"
                style={{ borderColor: BORDER }}
                rows={3}
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                placeholder="Write the announcement content…"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>Priority</label>
                <select
                  className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
                  style={{ borderColor: BORDER }}
                  value={form.severity}
                  onChange={(e) => setForm((f) => ({ ...f, severity: e.target.value as Severity }))}
                >
                  {SEVERITIES.map((s) => (
                    <option key={s} value={s}>{SEVERITY_STYLES[s].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-black mb-1" style={{ color: TEXT }}>Category</label>
                <select
                  className="w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
                  style={{ borderColor: BORDER }}
                  value={form.category}
                  onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
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
                {saving ? "Publishing…" : "Publish"}
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
            <AlertTriangle size={22} className="mx-auto mb-2" style={{ color: "#F97316" }} />
            <p className="text-[13px] font-bold" style={{ color: TEXT }}>Could not load announcements</p>
            <p className="mt-1 text-[12px]" style={{ color: MUTED }}>Check your connection and try again.</p>
          </div>
        ) : displayItems.length === 0 ? (
          <div className="rounded-xl border p-6 text-center" style={{ borderColor: BORDER }}>
            <Megaphone size={22} className="mx-auto mb-2" style={{ color: MUTED }} />
            <p className="text-[13px] font-bold" style={{ color: TEXT }}>No announcements yet</p>
            <p className="mt-1 text-[12px]" style={{ color: MUTED }}>
              {isCoordinator
                ? "Use the Publish button to post the first announcement."
                : "Your coordinator will post announcements here."}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {displayItems.map((item) => (
              <NewsCard
                key={item.id}
                item={item}
                onDelete={isCoordinator ? handleDelete : undefined}
                isCoordinator={isCoordinator}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
