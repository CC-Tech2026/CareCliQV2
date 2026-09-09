// Pure filtering logic for the admin Bug Reports list
// (src/pages/admin/bug-reports.tsx). Client-side, same pattern as the
// admin Providers page's search/filter (providers.tsx) — the full list is
// already fetched in one shot, so narrowing it down happens in the
// browser rather than via new query params on GET /admin/bug-reports.

import type { AdminBugReport, BugReportSeverity, BugReportStatus } from "@/services/adminService";

export type BugReportFilters = {
  search: string;
  status: "all" | BugReportStatus;
  severity: "all" | BugReportSeverity;
  organizationId: "all" | string;
};

export const DEFAULT_BUG_REPORT_FILTERS: BugReportFilters = {
  search: "",
  status: "all",
  severity: "all",
  organizationId: "all",
};

export function hasActiveBugReportFilters(filters: BugReportFilters): boolean {
  return (
    filters.search.trim() !== "" ||
    filters.status !== "all" ||
    filters.severity !== "all" ||
    filters.organizationId !== "all"
  );
}

// Search matches description, organisation, and reporter — the three
// pieces of text visible on each row (see bug-reports.tsx) — so a search
// box behaves the way a user reading the list would expect it to.
export function matchesBugReportFilters(report: AdminBugReport, filters: BugReportFilters): boolean {
  const query = filters.search.trim().toLowerCase();
  const matchesSearch =
    !query ||
    report.description.toLowerCase().includes(query) ||
    report.organization_name.toLowerCase().includes(query) ||
    report.reporter_name.toLowerCase().includes(query);
  const matchesStatus = filters.status === "all" || report.status === filters.status;
  const matchesSeverity = filters.severity === "all" || report.severity === filters.severity;
  const matchesOrg = filters.organizationId === "all" || report.organization_id === filters.organizationId;
  return matchesSearch && matchesStatus && matchesSeverity && matchesOrg;
}

export function filterBugReports(reports: AdminBugReport[], filters: BugReportFilters): AdminBugReport[] {
  return reports.filter((r) => matchesBugReportFilters(r, filters));
}
