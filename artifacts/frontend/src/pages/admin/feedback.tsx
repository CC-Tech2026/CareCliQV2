import { useEffect, useState } from "react";
import { Lightbulb, Building2, ExternalLink } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { useToast } from "@/hooks/use-toast";
import {
  listAdminImprovementFeedback,
  updateAdminImprovementFeedbackStatus,
  type AdminImprovementFeedback,
  type BugReportStatus as FeedbackStatus,
} from "@/services/adminService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";
const AMBER = "#9A5B0A";
const AMBER_SOFT = "#FBF2E6";
const GREEN = "#0F7B57";
const GREEN_SOFT = "#E9F5F0";

const STATUS_STYLE: Record<FeedbackStatus, { label: string; color: string; bg: string }> = {
  open: { label: "Open", color: AMBER, bg: AMBER_SOFT },
  in_progress: { label: "In Progress", color: PLUM, bg: "var(--cc-plum-soft)" },
  resolved: { label: "Resolved", color: GREEN, bg: GREEN_SOFT },
};

// Same "advance to next phase" model as Bug Reports — no going backwards
// from this button.
const NEXT_STATUS: Record<FeedbackStatus, FeedbackStatus | null> = {
  open: "in_progress",
  in_progress: "resolved",
  resolved: null,
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AdminFeedbackPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<AdminImprovementFeedback[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    listAdminImprovementFeedback()
      .then((data) => { if (!cancelled) setItems(data); })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Could not load feedback.");
        setItems([]);
      });
    return () => { cancelled = true; };
  }, []);

  async function advance(item: AdminImprovementFeedback) {
    const next = NEXT_STATUS[item.status];
    if (!next) return;
    setUpdatingId(item.id);
    try {
      await updateAdminImprovementFeedbackStatus(item.id, next);
      setItems((prev) => prev?.map((i) => (i.id === item.id ? { ...i, status: next } : i)) ?? prev);
    } catch (e) {
      toast({
        title: "Couldn't update status",
        description: e instanceof Error ? e.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setUpdatingId(null);
    }
  }

  const openCount = items?.filter((i) => i.status === "open").length ?? 0;
  const inProgressCount = items?.filter((i) => i.status === "in_progress").length ?? 0;

  return (
    <AdminShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-black" style={{ color: TEXT }}>Improvements & Feedback</h1>
          <p className="text-[12px] font-medium" style={{ color: MUTED }}>Feature requests and feedback about CareCliQ, submitted by providers.</p>
        </div>

        {items === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }} />)}
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border p-12 text-center" style={{ borderColor: BORDER, background: SURFACE }}>
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ background: AMBER_SOFT }}>
              <Lightbulb size={20} style={{ color: AMBER }} />
            </span>
            <p className="mt-3 text-[13px] font-black" style={{ color: TEXT }}>Couldn't load feedback</p>
            <p className="mx-auto mt-1 max-w-sm text-[12px] font-medium" style={{ color: MUTED }}>{loadError}</p>
          </div>
        ) : items.length === 0 ? (
          <div className="rounded-2xl border p-12 text-center" style={{ borderColor: BORDER, background: SURFACE }}>
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--cc-plum-soft)" }}>
              <Lightbulb size={20} style={{ color: PLUM }} />
            </span>
            <p className="mt-3 text-[13px] font-black" style={{ color: TEXT }}>Nothing submitted yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[12px] font-medium" style={{ color: MUTED }}>
              Feedback managing directors submit from Settings → Improvements &amp; Feedback will show up here.
            </p>
          </div>
        ) : (
          <>
            {(openCount > 0 || inProgressCount > 0) && (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border p-3.5" style={{ borderColor: BORDER, background: SURFACE }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Open</p>
                  <p className="mt-1 text-xl font-black" style={{ color: openCount > 0 ? AMBER : TEXT }}>{openCount}</p>
                </div>
                <div className="rounded-2xl border p-3.5" style={{ borderColor: BORDER, background: SURFACE }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>In progress</p>
                  <p className="mt-1 text-xl font-black" style={{ color: PLUM }}>{inProgressCount}</p>
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
              {items.map((item, i) => {
                const st = STATUS_STYLE[item.status];
                const next = NEXT_STATUS[item.status];
                return (
                  <div
                    key={item.id}
                    className="flex items-start justify-between gap-4 px-5 py-4"
                    style={{ borderTop: i > 0 ? `1px solid ${BORDER}` : undefined }}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--cc-plum-soft)" }}>
                        <Building2 size={13} style={{ color: PLUM }} />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-bold" style={{ color: TEXT }}>{item.organization_name}</p>
                        <p className="text-[11px] font-medium" style={{ color: MUTED }}>
                          {item.reporter_name} · {timeAgo(item.created_at)}
                        </p>
                        <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed" style={{ color: TEXT }}>{item.description}</p>
                        {item.jira_url && (
                          <a
                            href={item.jira_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold hover:underline"
                            style={{ color: PLUM }}
                          >
                            {item.jira_issue_key} <ExternalLink size={11} />
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className="rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: st.bg, color: st.color }}>
                        {st.label}
                      </span>
                      {next && (
                        <button
                          onClick={() => advance(item)}
                          disabled={updatingId === item.id}
                          className="text-[11px] font-bold hover:underline disabled:opacity-50"
                          style={{ color: MUTED }}
                        >
                          Mark {STATUS_STYLE[next].label.toLowerCase()} →
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </AdminShell>
  );
}
