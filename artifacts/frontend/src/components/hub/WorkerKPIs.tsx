import { useEffect, useMemo, useState } from "react";
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
  X,
  Send,
} from "lucide-react";

import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  getAnnouncements,
  createAnnouncement,
  deleteAnnouncement,
  type Announcement,
} from "@/services/hubService";
import { useAuth } from "@/contexts/AuthContext";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";

type Severity = "critical" | "high" | "medium" | "info" | "positive";

type Filter =
  | "all"
  | "important"
  | "policy"
  | "training"
  | "team";

const ICON_MAP: Record<
  string,
  React.ComponentType<{ size?: number; strokeWidth?: number }>
> = {
  "Policy Update": Shield,
  Training: GraduationCap,
  "Audit Reminder": AlertCircle,
  "Staff Achievement": Star,
  Announcement: Megaphone,
};

const SEVERITY_STYLES: Record<
  Severity,
  {
    labelKey: string;
    color: string;
    background: string;
  }
> = {
  critical: {
    labelKey: "hub.news.severity.critical",
    color: "#DC2626",
    background: "#FEF2F2",
  },
  high: {
    labelKey: "hub.news.severity.high",
    color: "#EA580C",
    background: "#FFF7ED",
  },
  medium: {
    labelKey: "hub.news.severity.medium",
    color: "#D97706",
    background: "#FFFBEB",
  },
  info: {
    labelKey: "hub.news.severity.info",
    color: "#2563EB",
    background: "#EFF6FF",
  },
  positive: {
    labelKey: "hub.news.severity.positive",
    color: "#059669",
    background: "#ECFDF5",
  },
};

const CATEGORIES = [
  "Announcement",
  "Policy Update",
  "Training",
  "Audit Reminder",
  "Staff Achievement",
];

const SEVERITIES: Severity[] = [
  "info",
  "positive",
  "medium",
  "high",
  "critical",
];

const CATEGORY_KEYS: Record<string, string> = {
  Announcement: "hub.news.category.announcement",
  "Policy Update": "hub.news.category.policy",
  Training: "hub.news.category.training",
  "Audit Reminder": "hub.news.category.audit",
  "Staff Achievement": "hub.news.category.achievement",
};

const BLANK_FORM = {
  title: "",
  body: "",
  severity: "info" as Severity,
  category: "Announcement",
};

function getSeverity(item: Announcement) {
  return (
    SEVERITY_STYLES[item.severity as Severity] ??
    SEVERITY_STYLES.info
  );
}

function getCategoryFilter(category: string): Filter {
  switch (category) {
    case "Policy Update":
      return "policy";
    case "Training":
      return "training";
    case "Staff Achievement":
      return "team";
    default:
      return "all";
  }
}

function NewsCard({
  item,
  onDelete,
  isCoordinator,
}: {
  item: Announcement;
  onDelete?: (id: string) => void;
  isCoordinator: boolean;
}) {
  const { translate } = useAccessibility();

  const severity = getSeverity(item);
  const Icon = ICON_MAP[item.category] ?? FileText;

  return (
    <article
      className="group relative overflow-hidden rounded-xl border bg-cc-surface transition-all duration-200 hover:-translate-y-[1px] hover:shadow-sm"
      style={{ borderColor: BORDER }}
    >
      {/* Severity rail */}
      <div
        className="absolute inset-y-0 left-0 w-1"
        style={{ background: severity.color }}
      />

      <div className="px-5 py-4 pl-6">
        {/* Metadata */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <div
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
              style={{
                background: severity.background,
                color: severity.color,
              }}
            >
              <Icon size={14} strokeWidth={2} />
            </div>

            <span
              className="text-[10px] font-black uppercase tracking-wide"
              style={{ color: severity.color }}
            >
              {translate(severity.labelKey)}
            </span>

            <span
              className="truncate text-[10px] font-medium"
              style={{ color: MUTED }}
            >
              · {translate(CATEGORY_KEYS[item.category] ?? item.category)}
            </span>
          </div>

          <span
            className="shrink-0 text-[10px] font-medium"
            style={{ color: MUTED }}
          >
            {formatDistanceToNow(parseISO(item.created_at), {
              addSuffix: true,
            })}
          </span>
        </div>

        {/* Content */}
        <div className="mt-3">
          <h3
            className="text-[14px] font-bold leading-snug"
            style={{ color: TEXT }}
          >
            {item.title}
          </h3>

          <p
            className="mt-1.5 line-clamp-3 max-w-3xl text-[12px] leading-relaxed"
            style={{ color: MUTED }}
          >
            {item.body}
          </p>
        </div>

        {/* Footer */}
        <div className="mt-4 flex items-center justify-between">
          <span
            className="text-[10px] font-semibold"
            style={{ color: MUTED }}
          >
            {translate(CATEGORY_KEYS[item.category] ?? item.category)}
          </span>

          <div className="flex items-center gap-1.5">
            {isCoordinator && onDelete && (
              <button
                type="button"
                onClick={() => onDelete(item.id)}
                className="flex h-7 w-7 items-center justify-center rounded-lg opacity-0 transition-all hover:bg-red-50 group-hover:opacity-100"
                style={{ color: MUTED }}
                title={translate("hub.news.deleteAnnouncement")}
                aria-label={translate("hub.news.deleteAnnouncement")}
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            )}

            <button
              type="button"
              className="rounded-lg px-2 py-1 text-[10px] font-bold transition-colors hover:bg-cc-soft"
              style={{ color: PLUM }}
            >
              View →
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

function PublishDrawer({
  open,
  form,
  saving,
  saveError,
  onClose,
  onChange,
  onSubmit,
}: {
  open: boolean;
  form: typeof BLANK_FORM;
  saving: boolean;
  saveError: string | null;
  onClose: () => void;
  onChange: (
    field: keyof typeof BLANK_FORM,
    value: string
  ) => void;
  onSubmit: (e: React.FormEvent) => void;
}) {
  const { translate } = useAccessibility();

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer */}
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-cc-surface shadow-2xl"
        style={{ borderLeft: `1px solid ${BORDER}` }}
        role="dialog"
        aria-modal="true"
        aria-label={translate("hub.news.publish")}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-6 py-5"
          style={{ borderBottom: `1px solid ${BORDER}` }}
        >
          <div>
            <h2
              className="text-[15px] font-black"
              style={{ color: TEXT }}
            >
              Publish update
            </h2>

            <p
              className="mt-1 text-[11px]"
              style={{ color: MUTED }}
            >
              Share an important update with your organisation.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-cc-soft"
            style={{ color: MUTED }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={onSubmit}
          className="flex flex-1 flex-col overflow-y-auto"
        >
          <div className="flex-1 space-y-5 px-6 py-6">
            {/* Title */}
            <div>
              <label
                htmlFor="announcement-title"
                className="mb-1.5 block text-[11px] font-black"
                style={{ color: TEXT }}
              >
                Title
              </label>

              <input
                id="announcement-title"
                value={form.title}
                onChange={(e) =>
                  onChange("title", e.target.value)
                }
                placeholder="e.g. NDIS policy update"
                className="w-full rounded-lg border bg-transparent px-3 py-2.5 text-[13px] outline-none transition focus:ring-2"
                style={{
                  borderColor: BORDER,
                  color: TEXT,
                }}
                required
              />
            </div>

            {/* Body */}
            <div>
              <label
                htmlFor="announcement-body"
                className="mb-1.5 block text-[11px] font-black"
                style={{ color: TEXT }}
              >
                Message
              </label>

              <textarea
                id="announcement-body"
                value={form.body}
                onChange={(e) =>
                  onChange("body", e.target.value)
                }
                placeholder="Write the update your team needs to know..."
                rows={6}
                className="w-full resize-none rounded-lg border bg-transparent px-3 py-2.5 text-[13px] leading-relaxed outline-none transition focus:ring-2"
                style={{
                  borderColor: BORDER,
                  color: TEXT,
                }}
                required
              />
            </div>

            {/* Priority + Category */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label
                  htmlFor="announcement-severity"
                  className="mb-1.5 block text-[11px] font-black"
                  style={{ color: TEXT }}
                >
                  Priority
                </label>

                <select
                  id="announcement-severity"
                  value={form.severity}
                  onChange={(e) =>
                    onChange(
                      "severity",
                      e.target.value as Severity
                    )
                  }
                  className="w-full rounded-lg border bg-transparent px-3 py-2.5 text-[12px] outline-none"
                  style={{
                    borderColor: BORDER,
                    color: TEXT,
                  }}
                >
                  {SEVERITIES.map((severity) => (
                    <option key={severity} value={severity}>
                      {translate(
                        SEVERITY_STYLES[severity].labelKey
                      )}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="announcement-category"
                  className="mb-1.5 block text-[11px] font-black"
                  style={{ color: TEXT }}
                >
                  Category
                </label>

                <select
                  id="announcement-category"
                  value={form.category}
                  onChange={(e) =>
                    onChange("category", e.target.value)
                  }
                  className="w-full rounded-lg border bg-transparent px-3 py-2.5 text-[12px] outline-none"
                  style={{
                    borderColor: BORDER,
                    color: TEXT,
                  }}
                >
                  {CATEGORIES.map((category) => (
                    <option key={category} value={category}>
                      {translate(
                        CATEGORY_KEYS[category] ?? category
                      )}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Preview */}
            <div
              className="rounded-xl p-4"
              style={{
                background: SOFT,
                border: `1px solid ${BORDER}`,
              }}
            >
              <p
                className="mb-3 text-[10px] font-black uppercase tracking-wide"
                style={{ color: MUTED }}
              >
                Preview
              </p>

              <div className="flex gap-3">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background:
                      SEVERITY_STYLES[form.severity].background,
                    color:
                      SEVERITY_STYLES[form.severity].color,
                  }}
                >
                  {(() => {
                    const PreviewIcon =
                      ICON_MAP[form.category] ?? FileText;

                    return <PreviewIcon size={14} />;
                  })()}
                </div>

                <div className="min-w-0">
                  <p
                    className="text-[12px] font-bold"
                    style={{ color: TEXT }}
                  >
                    {form.title || "Your announcement title"}
                  </p>

                  <p
                    className="mt-1 line-clamp-3 text-[11px] leading-relaxed"
                    style={{ color: MUTED }}
                  >
                    {form.body ||
                      "Your announcement message will appear here."}
                  </p>
                </div>
              </div>
            </div>

            {saveError && (
              <div className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[11px] font-medium text-red-700">
                <AlertTriangle
                  size={14}
                  className="mt-0.5 shrink-0"
                />
                <span>{saveError}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-end gap-2 px-6 py-4"
            style={{ borderTop: `1px solid ${BORDER}` }}
          >
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-[11px] font-bold transition-colors hover:bg-cc-soft"
              style={{ color: MUTED }}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-1.5 rounded-lg px-4 py-2 text-[11px] font-bold text-white transition-opacity disabled:cursor-not-allowed"
              style={{
                background: PLUM,
                opacity: saving ? 0.6 : 1,
              }}
            >
              <Send size={12} />
              {saving ? "Publishing..." : "Publish update"}
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}

export function NewsFeed() {
  const { translate } = useAccessibility();
  const { user } = useAuth();

  const isCoordinator =
    user?.role === "support_coordinator";

  const [items, setItems] =
    useState<Announcement[] | null>(null);

  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState(false);

  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const [saveError, setSaveError] =
    useState<string | null>(null);

  const [deleteError, setDeleteError] =
    useState<string | null>(null);

  const [form, setForm] = useState(BLANK_FORM);

  const [activeFilter, setActiveFilter] =
    useState<Filter>("all");

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setFetchError(false);

    getAnnouncements()
      .then((data) => {
        if (!cancelled) {
          setItems(data);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFetchError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const displayItems = useMemo(() => {
    const all = items ?? [];

    if (activeFilter === "all") {
      return all;
    }

    if (activeFilter === "important") {
      return all.filter((item) =>
        ["critical", "high"].includes(item.severity)
      );
    }

    return all.filter(
      (item) => getCategoryFilter(item.category) === activeFilter
    );
  }, [items, activeFilter]);

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault();

    if (!form.title.trim() || !form.body.trim()) {
      return;
    }

    setSaving(true);
    setSaveError(null);

    try {
      const created = await createAnnouncement(form);

      setItems((prev) => [
        created,
        ...(prev ?? []),
      ]);

      setShowForm(false);
      setForm(BLANK_FORM);
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : translate("hub.news.publishFailed")
      );
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleteError(null);

    try {
      await deleteAnnouncement(id);

      setItems((prev) =>
        (prev ?? []).filter((item) => item.id !== id)
      );
    } catch (err) {
      setDeleteError(
        err instanceof Error
          ? err.message
          : translate("hub.news.deleteFailed")
      );
    }
  }

  function handleFormChange(
    field: keyof typeof BLANK_FORM,
    value: string
  ) {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  const filterOptions: {
    id: Filter;
    label: string;
  }[] = [
    { id: "all", label: "All updates" },
    { id: "important", label: "Important" },
    { id: "policy", label: "Policies" },
    { id: "training", label: "Training" },
    { id: "team", label: "Team" },
  ];

  return (
    <>
      <section
        className="overflow-hidden rounded-2xl border bg-cc-surface"
        style={{ borderColor: BORDER }}
      >
        {/* Header */}
        <div
          className="px-5 py-5 sm:px-6"
          style={{
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{
                    background: SOFT,
                    color: PLUM,
                  }}
                >
                  <Megaphone
                    size={15}
                    strokeWidth={2}
                  />
                </div>

                <h2
                  className="text-[15px] font-black"
                  style={{ color: TEXT }}
                >
                  Organisation Updates
                </h2>
              </div>

              <p
                className="mt-1 ml-[42px] text-[11px]"
                style={{ color: MUTED }}
              >
                Important updates, policies and team
                communication.
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {!loading && !fetchError && (
                <span
                  className="hidden text-[10px] font-semibold sm:block"
                  style={{ color: MUTED }}
                >
                  {items?.length ?? 0}{" "}
                  {(items?.length ?? 0) === 1
                    ? "update"
                    : "updates"}
                </span>
              )}

              {isCoordinator && (
                <button
                  type="button"
                  onClick={() => {
                    setSaveError(null);
                    setShowForm(true);
                  }}
                  className="flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11px] font-bold text-white shadow-sm transition-all hover:-translate-y-[1px] hover:opacity-90"
                  style={{ background: PLUM }}
                >
                  <Plus
                    size={13}
                    strokeWidth={2.5}
                  />
                  <span className="hidden sm:inline">
                    Publish update
                  </span>
                  <span className="sm:hidden">
                    Publish
                  </span>
                </button>
              )}
            </div>
          </div>

          {/* Filters */}
          {!loading && !fetchError && (
            <div className="mt-5 flex gap-1 overflow-x-auto pb-0.5">
              {filterOptions.map((filter) => {
                const active =
                  activeFilter === filter.id;

                return (
                  <button
                    key={filter.id}
                    type="button"
                    onClick={() =>
                      setActiveFilter(filter.id)
                    }
                    className="shrink-0 rounded-lg px-3 py-1.5 text-[10px] font-bold transition-colors"
                    style={{
                      background: active
                        ? SOFT
                        : "transparent",
                      color: active
                        ? PLUM
                        : MUTED,
                    }}
                  >
                    {filter.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="px-5 py-5 sm:px-6">
          {deleteError && (
            <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-[11px] font-medium text-red-700">
              <AlertTriangle
                size={14}
                className="mt-0.5 shrink-0"
              />

              <span>{deleteError}</span>
            </div>
          )}

          {/* Loading */}
          {loading ? (
            <div className="space-y-2.5">
              {[1, 2, 3].map((item) => (
                <div
                  key={item}
                  className="h-[130px] animate-pulse rounded-xl"
                  style={{
                    background: SOFT,
                  }}
                />
              ))}
            </div>
          ) : fetchError ? (
            /* Error */
            <div
              className="rounded-xl border px-6 py-8 text-center"
              style={{ borderColor: BORDER }}
            >
              <div
                className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl"
                style={{
                  background: "#FFF7ED",
                  color: "#F97316",
                }}
              >
                <AlertTriangle size={18} />
              </div>

              <p
                className="text-[13px] font-bold"
                style={{ color: TEXT }}
              >
                {translate("hub.news.loadFailed")}
              </p>

              <p
                className="mt-1 text-[11px]"
                style={{ color: MUTED }}
              >
                {translate("hub.news.retryHint")}
              </p>
            </div>
          ) : displayItems.length === 0 ? (
            /* Empty */
            <div
              className="rounded-xl border px-6 py-10 text-center"
              style={{ borderColor: BORDER }}
            >
              <div
                className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-xl"
                style={{
                  background: SOFT,
                  color: MUTED,
                }}
              >
                <Megaphone size={18} />
              </div>

              <p
                className="text-[13px] font-bold"
                style={{ color: TEXT }}
              >
                {activeFilter === "all"
                  ? "You're all caught up"
                  : "No updates found"}
              </p>

              <p
                className="mx-auto mt-1 max-w-xs text-[11px] leading-relaxed"
                style={{ color: MUTED }}
              >
                {activeFilter === "all"
                  ? isCoordinator
                    ? "Publish an update when there is something important your team needs to know."
                    : "There are no organisation updates to display right now."
                  : "Try another filter to see more organisation updates."}
              </p>

              {isCoordinator &&
                activeFilter === "all" && (
                  <button
                    type="button"
                    onClick={() => setShowForm(true)}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-bold text-white"
                    style={{ background: PLUM }}
                  >
                    <Plus size={12} />
                    Publish update
                  </button>
                )}
            </div>
          ) : (
            /* Feed */
            <div className="space-y-2.5">
              {displayItems.map((item) => (
                <NewsCard
                  key={item.id}
                  item={item}
                  onDelete={
                    isCoordinator
                      ? handleDelete
                      : undefined
                  }
                  isCoordinator={isCoordinator}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Publish drawer */}
      <PublishDrawer
        open={showForm}
        form={form}
        saving={saving}
        saveError={saveError}
        onClose={() => {
          if (!saving) {
            setShowForm(false);
            setSaveError(null);
          }
        }}
        onChange={handleFormChange}
        onSubmit={handlePublish}
      />
    </>
  );
}