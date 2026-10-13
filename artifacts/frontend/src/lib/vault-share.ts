/**
 * The parts of "Share with auditor" that aren't UI: which documents fall in
 * the chosen time period, the document register (CSV) and the cover note
 * that can go into the pack. Tested in vault-share.test.ts.
 */
import type { DocRef, VaultDocument } from "@/services/vaultService";

/** A document being shared: always a reference, usually with its details. */
export type SharedDoc = DocRef & Partial<Omit<VaultDocument, "category" | "id">>;

export type PeriodPreset = "all" | "3m" | "6m" | "12m" | "custom";

export const PERIOD_PRESETS: { key: PeriodPreset; label: string }[] = [
  { key: "all", label: "All time" },
  { key: "3m", label: "Last 3 months" },
  { key: "6m", label: "Last 6 months" },
  { key: "12m", label: "Last 12 months" },
  { key: "custom", label: "Custom range" },
];

export interface Period {
  /** Inclusive start, as YYYY-MM-DD. */
  from?: string;
  /** Inclusive end, as YYYY-MM-DD. */
  to?: string;
  label: string;
}

function isoDay(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function longDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

export function resolvePeriod(preset: PeriodPreset, custom: { from?: string; to?: string } = {}, today = new Date()): Period {
  if (preset === "all") return { label: "All time" };
  if (preset === "custom") {
    const from = custom.from || undefined;
    const to = custom.to || undefined;
    const label =
      from && to ? `${longDay(from)} to ${longDay(to)}` : from ? `From ${longDay(from)}` : to ? `Up to ${longDay(to)}` : "All time";
    return { from, to, label };
  }
  const months = preset === "3m" ? 3 : preset === "6m" ? 6 : 12;
  const start = new Date(today.getFullYear(), today.getMonth() - months, today.getDate());
  return { from: isoDay(start), to: isoDay(today), label: `Last ${months} months` };
}

/** True when the document's date falls in the period. Undated documents are
 * kept: leaving one out of an audit pack silently is worse than including it. */
export function inPeriod(doc: SharedDoc, period: Period): boolean {
  if (!period.from && !period.to) return true;
  if (!doc.date) return true;
  const day = doc.date.slice(0, 10);
  if (period.from && day < period.from) return false;
  if (period.to && day > period.to) return false;
  return true;
}

function csvCell(value: unknown) {
  const text = value == null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** One row per file, for the auditor to tick off against the pack. */
export function buildRegisterCsv(docs: SharedDoc[]): string {
  const header = ["Document ID", "Title", "Folder", "Person", "Person type", "Person ID", "Date", "Status", "Source"];
  const rows = docs.map((d) => [
    d.doc_id || d.reference || d.id,
    d.title ?? "",
    d.folder_label ?? d.category,
    d.person_name ?? "",
    d.person_type ?? "",
    d.person_ref ?? "",
    d.date ? d.date.slice(0, 10) : "",
    d.status ?? "",
    d.source_label ?? "",
  ]);
  // BOM so Excel opens it as UTF-8.
  return "﻿" + [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

/** A printable first page for the pack: who prepared it, the period and what's inside. */
export function buildCoverNote(input: {
  preparedBy: string;
  preparedAt?: Date;
  period: Period;
  folders: { label: string; count: number }[];
  total: number;
  note?: string;
  includesRegister: boolean;
}): string {
  const when = (input.preparedAt ?? new Date()).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
  const rows = input.folders
    .map((f) => `<tr><td>${escapeHtml(f.label)}</td><td class="n">${f.count}</td></tr>`)
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Audit pack cover note</title>
<style>
body{font-family:Inter,Arial,sans-serif;color:#1A1A2E;max-width:720px;margin:48px auto;padding:0 24px;line-height:1.55}
h1{font-size:24px;margin:0 0 4px}p.meta{color:#6A6A77;margin:0 0 24px}
table{width:100%;border-collapse:collapse;margin:16px 0}td,th{padding:8px 0;border-bottom:1px solid #E8E8EA;text-align:left}
td.n,th.n{text-align:right}.note{background:#F5EFFE;border-radius:12px;padding:12px 16px;white-space:pre-wrap}
</style></head><body>
<h1>Audit pack</h1>
<p class="meta">Prepared by ${escapeHtml(input.preparedBy)} on ${when}, from the CareCliQ Documents &amp; Audit Vault.</p>
<p><strong>Period:</strong> ${escapeHtml(input.period.label)}<br><strong>Documents:</strong> ${input.total}</p>
${input.note ? `<p class="note">${escapeHtml(input.note)}</p>` : ""}
<table><thead><tr><th>Folder</th><th class="n">Documents</th></tr></thead><tbody>${rows}</tbody></table>
${input.includesRegister ? "<p>Every file is listed in <strong>Document register.csv</strong>, with its document ID, the person it relates to, its date and status.</p>" : ""}
</body></html>
`;
}

/** Drop repeats of the same document (it can sit in more than one folder). */
export function uniqueDocs(docs: SharedDoc[]): SharedDoc[] {
  const seen = new Set<string>();
  return docs.filter((d) => {
    const key = `${d.category}:${d.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
