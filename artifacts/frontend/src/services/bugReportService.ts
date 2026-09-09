import { jsonFetch } from "@/services/http";

export type BugReportAttachment = {
  mime_type: string;
  data: string; // base64, data: URL prefix optional — backend strips it
};

export type BugReportSeverity = "low" | "medium" | "urgent";

export function submitBugReport(
  description: string,
  pageUrl: string,
  attachments: BugReportAttachment[] = [],
  severity: BugReportSeverity = "low",
) {
  return jsonFetch<{ id: string; status: string }>("/api/bug-reports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ description, page_url: pageUrl, attachments, severity }),
  });
}
