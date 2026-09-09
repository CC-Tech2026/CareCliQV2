import { describe, expect, it } from "vitest";
import type { AdminBugReport } from "@/services/adminService";
import { buildBugReportsCsv } from "@/lib/bug-report-csv";

function makeReport(overrides: Partial<AdminBugReport> = {}): AdminBugReport {
  return {
    id: "r1",
    organization_id: "org-1",
    organization_name: "Sunshine Disability Services",
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

describe("CARECLIQV2-351 bug report CSV export", () => {
  it("includes a header row followed by one row per report", () => {
    const csv = buildBugReportsCsv([makeReport(), makeReport({ id: "r2" })]);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("id,organization,severity,status,description,page_url,jira_issue_key,created_at");
  });

  it("never includes reporter identity — the backend doesn't send it", () => {
    const csv = buildBugReportsCsv([makeReport()]);
    expect(csv).not.toMatch(/reporter/i);
  });

  it("quotes and escapes fields containing commas, quotes, or newlines", () => {
    const csv = buildBugReportsCsv([
      makeReport({ description: 'Says "Error", then freezes\nand won\'t recover' }),
    ]);
    expect(csv).toContain('"Says ""Error"", then freezes\nand won\'t recover"');
  });

  it("renders null page_url and jira_issue_key as empty fields", () => {
    const csv = buildBugReportsCsv([makeReport({ page_url: null, jira_issue_key: null })]);
    const [, row] = csv.split("\n");
    expect(row.endsWith(",,2026-09-01T00:00:00Z")).toBe(true);
  });

  it("returns just the header for an empty list", () => {
    const csv = buildBugReportsCsv([]);
    expect(csv.split("\n")).toHaveLength(1);
  });
});
