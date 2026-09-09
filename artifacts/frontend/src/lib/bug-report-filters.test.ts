import { describe, expect, it } from "vitest";
import type { AdminBugReport } from "@/services/adminService";
import {
  DEFAULT_BUG_REPORT_FILTERS,
  filterBugReports,
  hasActiveBugReportFilters,
  matchesBugReportFilters,
} from "@/lib/bug-report-filters";

function makeReport(overrides: Partial<AdminBugReport> = {}): AdminBugReport {
  return {
    id: "r1",
    organization_id: "org-1",
    organization_name: "Sunshine Disability Services",
    reporter_id: "u1",
    reporter_name: "Jamie Lee",
    page_url: "/shifts/123",
    description: "Task checklist wouldn't save",
    status: "open",
    severity: "medium",
    jira_issue_key: null,
    jira_url: null,
    attachments: [],
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
    ...overrides,
  };
}

describe("CARECLIQV2-349 bug report filters", () => {
  it("matches everything with no filters active", () => {
    const report = makeReport();
    expect(matchesBugReportFilters(report, DEFAULT_BUG_REPORT_FILTERS)).toBe(true);
    expect(hasActiveBugReportFilters(DEFAULT_BUG_REPORT_FILTERS)).toBe(false);
  });

  it("search matches description, organisation, or reporter name, case-insensitively", () => {
    const report = makeReport();
    const filters = { ...DEFAULT_BUG_REPORT_FILTERS, search: "sunshine" };
    expect(matchesBugReportFilters(report, filters)).toBe(true);
    expect(matchesBugReportFilters(report, { ...filters, search: "JAMIE" })).toBe(true);
    expect(matchesBugReportFilters(report, { ...filters, search: "checklist" })).toBe(true);
    expect(matchesBugReportFilters(report, { ...filters, search: "nope" })).toBe(false);
  });

  it("filters by status", () => {
    const report = makeReport({ status: "in_progress" });
    expect(matchesBugReportFilters(report, { ...DEFAULT_BUG_REPORT_FILTERS, status: "in_progress" })).toBe(true);
    expect(matchesBugReportFilters(report, { ...DEFAULT_BUG_REPORT_FILTERS, status: "resolved" })).toBe(false);
  });

  it("filters by severity", () => {
    const report = makeReport({ severity: "urgent" });
    expect(matchesBugReportFilters(report, { ...DEFAULT_BUG_REPORT_FILTERS, severity: "urgent" })).toBe(true);
    expect(matchesBugReportFilters(report, { ...DEFAULT_BUG_REPORT_FILTERS, severity: "low" })).toBe(false);
  });

  it("filters by organization", () => {
    const report = makeReport({ organization_id: "org-2" });
    expect(matchesBugReportFilters(report, { ...DEFAULT_BUG_REPORT_FILTERS, organizationId: "org-2" })).toBe(true);
    expect(matchesBugReportFilters(report, { ...DEFAULT_BUG_REPORT_FILTERS, organizationId: "org-1" })).toBe(false);
  });

  it("requires every active filter to match at once", () => {
    const report = makeReport({ status: "open", severity: "urgent", organization_id: "org-1" });
    const filters = { search: "", status: "open" as const, severity: "urgent" as const, organizationId: "org-1" };
    expect(matchesBugReportFilters(report, filters)).toBe(true);
    expect(matchesBugReportFilters(report, { ...filters, severity: "low" as const })).toBe(false);
  });

  it("flags when at least one filter is active", () => {
    expect(hasActiveBugReportFilters({ ...DEFAULT_BUG_REPORT_FILTERS, search: "  " })).toBe(false);
    expect(hasActiveBugReportFilters({ ...DEFAULT_BUG_REPORT_FILTERS, search: "x" })).toBe(true);
    expect(hasActiveBugReportFilters({ ...DEFAULT_BUG_REPORT_FILTERS, status: "resolved" })).toBe(true);
    expect(hasActiveBugReportFilters({ ...DEFAULT_BUG_REPORT_FILTERS, severity: "urgent" })).toBe(true);
    expect(hasActiveBugReportFilters({ ...DEFAULT_BUG_REPORT_FILTERS, organizationId: "org-1" })).toBe(true);
  });

  it("filterBugReports narrows a list down to matching reports only", () => {
    const reports = [
      makeReport({ id: "r1", severity: "low" }),
      makeReport({ id: "r2", severity: "urgent" }),
      makeReport({ id: "r3", severity: "urgent" }),
    ];
    const result = filterBugReports(reports, { ...DEFAULT_BUG_REPORT_FILTERS, severity: "urgent" });
    expect(result.map((r) => r.id)).toEqual(["r2", "r3"]);
  });
});
