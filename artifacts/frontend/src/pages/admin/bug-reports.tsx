import { useCallback, useEffect, useMemo, useState } from "react";
import { Bug, Download, ExternalLink, Plus, RotateCcw, Search, Video, X } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { ReportBugPanel } from "@/components/admin/ReportBugPanel";
import { Button } from "@/components/ui/button";
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
  INTERNAL_ORG_FILTER_VALUE,
  type BugReportFilters,
} from "@/lib/bug-report-filters";
import { buildBugReportsCsv } from "@/lib/bug-report-csv";
import { downloadBlob } from "@/lib/download-file";

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
// next phase" button. Going backwards from Resolved is handled separately
// by the dedicated Reopen action below, not by this forward-only map.
const NEXT_STATUS: Record<BugReportStatus, BugReportStatus | null> = {
  open: "in_progress",
  in_progress: "resolved",
  resolved: null,
};

function formatCreatedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "numeric", day: "numeric", year: "numeric" });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[parts.length - 1][0] ?? "")).toUpperCase();
}

// Not a real ticket-numbering system — just the first 6 hex characters of
// the row's UUID, purely so a report is easy to point at/scan in the list
// (mirrors the "BUG-1234"-style badge on other bug trackers, without
// pretending we have a sequential id we don't).
function shortDisplayId(id: string): string {
  return `BR-${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`;
}

export default function AdminBugReportsPage() {
  const { toast } = useToast();
  const [reports, setReports] = useState<AdminBugReport[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [filters, setFilters] = useState<BugReportFilters>(DEFAULT_BUG_REPORT_FILTERS);
  const [reportPanelOpen, setReportPanelOpen] = useState(false);

  const refetch = useCallback(() => {
    return listAdminBugReports()
      .then((data) => setReports(data))
      .catch((e) => {
        setLoadError(e instanceof Error ? e.message : "Could not load bug reports.");
        setReports((prev) => prev ?? []);
      });
  }, []);

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

  async function changeStatus(report: AdminBugReport, targetStatus: BugReportStatus) {
    setUpdatingId(report.id);
    try {
      await updateAdminBugReportStatus(report.id, targetStatus);
      setReports((prev) => prev?.map((r) => (r.id === report.id ? { ...r, status: targetStatus } : r)) ?? prev);
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
  const resolvedCount = reports?.filter((r) => r.status === "resolved").length ?? 0;

  // Distinct orgs among the loaded reports, alphabetised — there's no
  // separate "all orgs" endpoint call here, so the org filter's options
  // are only ever the orgs that actually have a report, same as how the
  // rest of this page derives everything from the one list call. An
  // Internal report (organization_id: null) gets the sentinel value so
  // it's still filterable/groupable like a real org.
  const orgOptions = useMemo(() => {
    const byId = new Map<string, string>();
    for (const r of reports ?? []) byId.set(r.organization_id ?? INTERNAL_ORG_FILTER_VALUE, r.organization_name);
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

  // Exports whatever's currently visible (i.e. respects the active
  // filters) — an admin who's just filtered down to "Urgent" reports
  // almost certainly wants a CSV of those, not the full unfiltered list.
  function exportCsv() {
    if (!visibleReports || visibleReports.length === 0) return;
    const csv = buildBugReportsCsv(visibleReports);
    downloadBlob(new Blob([csv], { type: "text/csv" }), `carecliq-bug-reports-${new Date().toISOString().slice(0, 10)}.csv`);
  }

  return (
    <AdminShell>
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-3xl font-black" style={{ color: TEXT }}>Bug Management</h1>
          <Button className="gap-1.5" onClick={() => setReportPanelOpen(true)}>
            <Plus size={15} /> Report Bug
          </Button>
        </div>

        <ReportBugPanel open={reportPanelOpen} onOpenChange={setReportPanelOpen} onSubmitted={refetch} />

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
            {(openCount > 0 || inProgressCount > 0 || resolvedCount > 0) && (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-2xl border p-3.5" style={{ borderColor: BORDER, background: SURFACE }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Open</p>
                  <p className="mt-1 text-xl font-black" style={{ color: openCount > 0 ? AMBER : TEXT }}>{openCount}</p>
                </div>
                <div className="rounded-2xl border p-3.5" style={{ borderColor: BORDER, background: SURFACE }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>In progress</p>
                  <p className="mt-1 text-xl font-black" style={{ color: PLUM }}>{inProgressCount}</p>
                </div>
                <div className="rounded-2xl border p-3.5" style={{ borderColor: BORDER, background: SURFACE }}>
                  <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Resolved</p>
                  <p className="mt-1 text-xl font-black" style={{ color: GREEN }}>{resolvedCount}</p>
                </div>
              </div>
            )}

            <div className="flex flex-col gap-3 rounded-2xl border p-3 sm:flex-row sm:items-center" style={{ borderColor: BORDER, background: SURFACE }}>
              <div className="relative min-w-0 flex-1">
                <Search size={15} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
                <Input
                  value={filters.search}
                  onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                  placeholder="Search description or organisation"
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

              <button
                onClick={exportCsv}
                disabled={!visibleReports || visibleReports.length === 0}
                title="Export the reports below as CSV"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl disabled:opacity-40"
                style={{ background: SOFT, color: MUTED }}
              >
                <Download size={16} />
              </button>
            </div>

            {visibleReports && visibleReports.length === 0 ? (
              <div className="rounded-2xl border p-10 text-center" style={{ borderColor: BORDER, background: SURFACE }}>
                <p className="text-[13px] font-black" style={{ color: TEXT }}>No bug reports match these filters.</p>
              </div>
            ) : (
            <div className="space-y-3">
              {(visibleReports ?? []).map((report) => {
                const st = STATUS_STYLE[report.status];
                const sev = SEVERITY_STYLE[report.severity];
                const next = NEXT_STATUS[report.status];
                return (
                  <div
                    key={report.id}
                    className="rounded-2xl border p-4"
                    style={{ borderColor: BORDER, background: SURFACE }}
                  >
                    <div className="flex flex-wrap items-center gap-1.5">
                      {report.jira_url ? (
                        <a
                          href={report.jira_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold hover:underline"
                          style={{ borderColor: PLUM, color: PLUM }}
                        >
                          {report.jira_issue_key} <ExternalLink size={10} />
                        </a>
                      ) : (
                        <span
                          className="rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold"
                          style={{ borderColor: BORDER, color: MUTED }}
                        >
                          {shortDisplayId(report.id)}
                        </span>
                      )}
                      <span
                        className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wide"
                        style={{ background: sev.bg, color: sev.color }}
                      >
                        {sev.label}
                      </span>
                      <span className="rounded-full px-2.5 py-0.5 text-[10px] font-black" style={{ background: st.bg, color: st.color }}>
                        {st.label}
                      </span>
                    </div>

                    <p className="mt-2.5 text-[14px] font-bold leading-snug" style={{ color: TEXT }}>{report.description}</p>

                    {report.page_url && (
                      <p className="mt-0.5 text-[11px] font-medium" style={{ color: MUTED }}>{report.page_url}</p>
                    )}

                    {report.attachments.length > 0 && (
                      <div className="mt-2.5 flex flex-wrap gap-2">
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

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3" style={{ borderColor: BORDER }}>
                      <div className="flex items-center gap-3 text-[11px] font-medium" style={{ color: MUTED }}>
                        {/* Org identifies the report, never the individual staff
                            member who filed it — see the "which provider hit
                            it" framing in the page subtitle above. */}
                        <span className="flex items-center gap-1.5">
                          <span
                            className="flex h-6 w-6 items-center justify-center rounded-full text-[9px] font-black"
                            style={{ background: "var(--cc-plum-soft)", color: PLUM }}
                          >
                            {initials(report.organization_name)}
                          </span>
                          {report.organization_name}
                        </span>
                        <span>Created {formatCreatedDate(report.created_at)}</span>
                      </div>
                      {next && (
                        <button
                          onClick={() => changeStatus(report, next)}
                          disabled={updatingId === report.id}
                          className="text-[11px] font-bold hover:underline disabled:opacity-50"
                          style={{ color: MUTED }}
                        >
                          Mark {STATUS_STYLE[next].label.toLowerCase()} →
                        </button>
                      )}
                      {report.status === "resolved" && (
                        <button
                          onClick={() => changeStatus(report, "open")}
                          disabled={updatingId === report.id}
                          className="flex items-center gap-1 text-[11px] font-bold hover:underline disabled:opacity-50"
                          style={{ color: AMBER }}
                        >
                          <RotateCcw size={11} /> Reopen
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
