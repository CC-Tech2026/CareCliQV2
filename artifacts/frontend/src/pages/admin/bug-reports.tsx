import { useEffect, useMemo, useState } from "react";
import { Bug, Building2, ExternalLink, Search, Video, X } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  listAdminBugReports,
  updateAdminBugReportStatus,
  type AdminBugReport,
  type BugReportSeverity,
  type BugReportStatus,
} from "@/services/adminService";
import {
  DEFAULT_BUG_REPORT_FILTERS,
  filterBugReports,
  hasActiveBugReportFilters,
  type BugReportFilters,
} from "@/lib/bug-report-filters";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const AMBER = "#9A5B0A";
const AMBER_SOFT = "#FBF2E6";
const GREEN = "#0F7B57";
const GREEN_SOFT = "#E9F5F0";
const CORAL = "var(--cc-coral)";
const CORAL_SOFT = "var(--cc-coral-soft)";

const STATUS_STYLE: Record<BugReportStatus, { label: string; color: string; bg: string }> = {
  open: { label: "Open", color: AMBER, bg: AMBER_SOFT },
  in_progress: { label: "In Progress", color: PLUM, bg: "var(--cc-plum-soft)" },
  resolved: { label: "Resolved", color: GREEN, bg: GREEN_SOFT },
};

// Same severity → color mapping as the reporting form (Settings → Report a
// bug) so a report reads the same way on both sides.
const SEVERITY_STYLE: Record<BugReportSeverity, { label: string; color: string; bg: string }> = {
  low: { label: "Low", color: PLUM, bg: "var(--cc-plum-soft)" },
  medium: { label: "Medium", color: AMBER, bg: AMBER_SOFT },
  urgent: { label: "Urgent", color: CORAL, bg: CORAL_SOFT },
};

// The order a report normally moves through — used for the "advance to
// next phase" button. There's no going backwards from this button (an
// admin can still reopen by other means later if that's ever needed).
const NEXT_STATUS: Record<BugReportStatus, BugReportStatus | null> = {
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

export default function AdminBugReportsPage() {
  const { toast } = useToast();
  const [reports, setReports] = useState<AdminBugReport[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [filters, setFilters] = useState<BugReportFilters>(DEFAULT_BUG_REPORT_FILTERS);

  useEffect(() => {
    let cancelled = false;
    listAdminBugReports()
      .then((data) => { if (!cancelled) setReports(data); })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Could not load bug reports.");
        setReports([]);
      });
    return () => { cancelled = true; };
  }, []);

  async function advance(report: AdminBugReport) {
    const next = NEXT_STATUS[report.status];
    if (!next) return;
    setUpdatingId(report.id);
    try {
      await updateAdminBugReportStatus(report.id, next);
      setReports((prev) => prev?.map((r) => (r.id === report.id ? { ...r, status: next } : r)) ?? prev);
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

  const openCount = reports?.filter((r) => r.status === "open").length ?? 0;
  const inProgressCount = reports?.filter((r) => r.status === "in_progress").length ?? 0;

  // Distinct orgs among the loaded reports, alphabetised — there's no
  // separate "all orgs" endpoint call here, so the org filter's options
  // are only ever the orgs that actually have a report, same as how the
  // rest of this page derives everything from the one list call.
  const orgOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of reports ?? []) byId.set(r.organization_id, r.organization_name);
    return [...byId.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [reports]);

  const visibleReports = useMemo(
    () => (reports ? filterBugReports(reports, filters) : null),
    [reports, filters],
  );
  const filtersActive = hasActiveBugReportFilters(filters);
  function clearFilters() {
    setFilters(DEFAULT_BUG_REPORT_FILTERS);
  }

  return (
    <AdminShell>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-black" style={{ color: TEXT }}>Bug Reports</h1>
          <p className="text-[12px] font-medium" style={{ color: MUTED }}>
            Errors and issues, scoped to which provider hit them — never the participant data involved.
          </p>
        </div>

        {reports === null ? (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-16 animate-pulse rounded-2xl" style={{ background: SURFACE, border: `1px solid ${BORDER}` }} />)}
          </div>
        ) : loadError ? (
          <div className="rounded-2xl border p-12 text-center" style={{ borderColor: BORDER, background: SURFACE }}>
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ background: AMBER_SOFT }}>
              <Bug size={20} style={{ color: AMBER }} />
            </span>
            <p className="mt-3 text-[13px] font-black" style={{ color: TEXT }}>Couldn't load bug reports</p>
            <p className="mx-auto mt-1 max-w-sm text-[12px] font-medium" style={{ color: MUTED }}>{loadError}</p>
          </div>
        ) : reports.length === 0 ? (
          <div className="rounded-2xl border p-12 text-center" style={{ borderColor: BORDER, background: SURFACE }}>
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--cc-plum-soft)" }}>
              <Bug size={20} style={{ color: PLUM }} />
            </span>
            <p className="mt-3 text-[13px] font-black" style={{ color: TEXT }}>No bug reports yet</p>
            <p className="mx-auto mt-1 max-w-sm text-[12px] font-medium" style={{ color: MUTED }}>
              Reports staff submit from Settings → Account will show up here, e.g. "Error 500 — Org abc-123", never the record that triggered it.
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

            <div className="flex flex-col gap-3 rounded-2xl border p-3 sm:flex-row sm:items-center" style={{ borderColor: BORDER, background: SURFACE }}>
              <div className="relative min-w-0 flex-1">
                <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
                <Input
                  value={filters.search}
                  onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                  placeholder="Search description, organisation, or reporter"
                  className="h-11 rounded-xl border-0 pl-11 text-[13px] shadow-none focus-visible:ring-1"
                  style={{ background: SOFT }}
                />
                {filters.search && (
                  <button
                    onClick={() => setFilters((f) => ({ ...f, search: "" }))}
                    className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-black/5"
                  >
                    <X size={14} style={{ color: MUTED }} />
                  </button>
                )}
              </div>

              <Select
                value={filters.status}
                onValueChange={(v) => setFilters((f) => ({ ...f, status: v as BugReportFilters["status"] }))}
              >
                <SelectTrigger className="h-11 w-full rounded-xl border-0 text-[12px] shadow-none sm:w-[150px]" style={{ background: SOFT }}>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Status</SelectItem>
                  {(Object.keys(STATUS_STYLE) as BugReportStatus[]).map((s) => (
                    <SelectItem key={s} value={s}>{STATUS_STYLE[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select
                value={filters.severity}
                onValueChange={(v) => setFilters((f) => ({ ...f, severity: v as BugReportFilters["severity"] }))}
              >
                <SelectTrigger className="h-11 w-full rounded-xl border-0 text-[12px] shadow-none sm:w-[150px]" style={{ background: SOFT }}>
                  <SelectValue placeholder="Severity Level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Severity Level</SelectItem>
                  {(Object.keys(SEVERITY_STYLE) as BugReportSeverity[]).map((s) => (
                    <SelectItem key={s} value={s}>{SEVERITY_STYLE[s].label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {orgOptions.length > 1 && (
                <Select
                  value={filters.organizationId}
                  onValueChange={(v) => setFilters((f) => ({ ...f, organizationId: v }))}
                >
                  <SelectTrigger className="h-11 w-full rounded-xl border-0 text-[12px] shadow-none sm:w-[190px]" style={{ background: SOFT }}>
                    <SelectValue placeholder="All organisations" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All organisations</SelectItem>
                    {orgOptions.map(([id, name]) => (
                      <SelectItem key={id} value={id}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              {filtersActive && (
                <button
                  onClick={clearFilters}
                  className="flex h-11 shrink-0 items-center justify-center gap-1 rounded-xl px-3 text-[11px] font-bold hover:bg-black/5"
                  style={{ color: MUTED }}
                >
                  <X size={13} /> Clear
                </button>
              )}
            </div>

            {visibleReports && visibleReports.length === 0 ? (
              <div className="rounded-2xl border p-10 text-center" style={{ borderColor: BORDER, background: SURFACE }}>
                <p className="text-[13px] font-black" style={{ color: TEXT }}>No bug reports match these filters.</p>
              </div>
            ) : (
            <div className="overflow-hidden rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
              {(visibleReports ?? []).map((report, i) => {
                const st = STATUS_STYLE[report.status];
                const sev = SEVERITY_STYLE[report.severity];
                const next = NEXT_STATUS[report.status];
                return (
                  <div
                    key={report.id}
                    className="flex items-start justify-between gap-4 px-5 py-4"
                    style={{ borderTop: i > 0 ? `1px solid ${BORDER}` : undefined }}
                  >
                    <div className="flex min-w-0 items-start gap-3">
                      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--cc-plum-soft)" }}>
                        <Building2 size={13} style={{ color: PLUM }} />
                      </span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-[13px] font-bold" style={{ color: TEXT }}>{report.organization_name}</p>
                          <span
                            className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide"
                            style={{ background: sev.bg, color: sev.color }}
                          >
                            {sev.label}
                          </span>
                        </div>
                        <p className="text-[11px] font-medium" style={{ color: MUTED }}>
                          {report.reporter_name} · {timeAgo(report.created_at)}
                          {report.page_url && <> · {report.page_url}</>}
                        </p>
                        <p className="mt-1.5 max-w-2xl text-[12px] leading-relaxed" style={{ color: TEXT }}>{report.description}</p>
                        {report.attachments.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {report.attachments.map((a, ai) =>
                              a.mime_type.startsWith("image/") ? (
                                <a key={ai} href={a.url ?? undefined} target="_blank" rel="noopener noreferrer">
                                  <img
                                    src={a.url ?? undefined}
                                    alt="Attachment"
                                    className="h-14 w-14 rounded-lg border object-cover"
                                    style={{ borderColor: BORDER }}
                                  />
                                </a>
                              ) : (
                                <a
                                  key={ai}
                                  href={a.url ?? undefined}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-lg border text-[9px] font-bold"
                                  style={{ borderColor: BORDER, color: MUTED }}
                                >
                                  <Video size={16} />
                                  Video
                                </a>
                              ),
                            )}
                          </div>
                        )}
                        {report.jira_url && (
                          <a
                            href={report.jira_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold hover:underline"
                            style={{ color: PLUM }}
                          >
                            {report.jira_issue_key} <ExternalLink size={11} />
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
                          onClick={() => advance(report)}
                          disabled={updatingId === report.id}
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
            )}
          </>
        )}
      </div>
    </AdminShell>
  );
}
