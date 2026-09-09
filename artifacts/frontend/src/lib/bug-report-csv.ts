// CSV export for the admin Bug Reports list (src/pages/admin/bug-reports.tsx).
// Same manual Blob-building approach as reports.tsx's session export — no
// CSV library needed for a handful of flat columns.

import type { AdminBugReport } from "@/services/adminService";

// No reporter column — the backend never sends reporter identity for bug
// reports (see admin.py's list_bug_reports), so there's nothing to export.
const COLUMNS = [
  "id",
  "organization",
  "severity",
  "status",
  "description",
  "page_url",
  "jira_issue_key",
  "created_at",
] as const;

function escapeCsvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function buildBugReportsCsv(reports: AdminBugReport[]): string {
  const lines = [COLUMNS.join(",")];
  for (const r of reports) {
    lines.push(
      [
        r.id,
        r.organization_name,
        r.severity,
        r.status,
        r.description,
        r.page_url ?? "",
        r.jira_issue_key ?? "",
        r.created_at,
      ]
        .map((v) => escapeCsvField(String(v)))
        .join(","),
    );
  }
  return lines.join("\n");
}
