// Pure filtering logic for the admin Bug Reports list
// (src/pages/admin/bug-reports.tsx). Client-side, same pattern as the
// admin Providers page's search/filter (providers.tsx) — the full list is
// already fetched in one shot, so narrowing it down happens in the
// browser rather than via new query params on GET /admin/bug-reports.

import type { AdminBugReport, BugReportSeverity, BugReportStatus } from "@/services/adminService";

// Sentinel for the org filter/picker — an Internal report has
// organization_id: null, which can't be a real <Select> option value (the
// underlying Radix Select treats "" as "no value"), so this stands in for
// "no organisation" wherever a report needs to be filtered/grouped by org.
export const INTERNAL_ORG_FILTER_VALUE = "__internal__";

export type BugReportFilters = {
  search: string;
  status: "all" | BugReportStatus;
  severity: "all" | BugReportSeverity;
  organizationId: "all" | typeof INTERNAL_ORG_FILTER_VALUE | string;
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

// Search matches description and organisation only — not the reporter's
// name, which the admin portal deliberately never displays or searches by
// (it's the individual staff member's private info, not the org's — see
// bug-reports.tsx's card footer, which shows the org, not the reporter).
export function matchesBugReportFilters(report: AdminBugReport, filters: BugReportFilters): boolean {
  const query = filters.search.trim().toLowerCase();
  const matchesSearch =
    !query ||
    report.description.toLowerCase().includes(query) ||
    report.organization_name.toLowerCase().includes(query);
  const matchesStatus = filters.status === "all" || report.status === filters.status;
  const matchesSeverity = filters.severity === "all" || report.severity === filters.severity;
  const matchesOrg =
    filters.organizationId === "all" ||
    (filters.organizationId === INTERNAL_ORG_FILTER_VALUE
      ? report.organization_id === null
      : report.organization_id === filters.organizationId);
  return matchesSearch && matchesStatus && matchesSeverity && matchesOrg;
}

export function filterBugReports(reports: AdminBugReport[], filters: BugReportFilters): AdminBugReport[] {
  return reports.filter((r) => matchesBugReportFilters(r, filters));
}
