import { describe, expect, it } from "vitest";
import { buildCoverNote, buildRegisterCsv, inPeriod, resolvePeriod, uniqueDocs } from "./vault-share";

const today = new Date(2026, 9, 12); // 12 Oct 2026

describe("time period", () => {
  it("covers the last few months up to today", () => {
    expect(resolvePeriod("3m", {}, today)).toEqual({ from: "2026-07-12", to: "2026-10-12", label: "Last 3 months" });
    expect(resolvePeriod("12m", {}, today).from).toBe("2025-10-12");
    expect(resolvePeriod("all", {}, today)).toEqual({ label: "All time" });
  });

  it("keeps documents in range, and undated ones, out of caution", () => {
    const period = resolvePeriod("custom", { from: "2026-08-01", to: "2026-08-31" }, today);
    expect(period.label).toBe("1 Aug 2026 to 31 Aug 2026");
    expect(inPeriod({ category: "c", id: "1", date: "2026-08-15T10:00:00Z" }, period)).toBe(true);
    expect(inPeriod({ category: "c", id: "2", date: "2026-07-31" }, period)).toBe(false);
    expect(inPeriod({ category: "c", id: "3", date: "2026-08-31" }, period)).toBe(true);
    expect(inPeriod({ category: "c", id: "4" }, period)).toBe(true);
  });
});

describe("register", () => {
  it("lists every file and escapes awkward values", () => {
    const csv = buildRegisterCsv([
      { category: "session_notes", id: "s1", doc_id: "SUNR-SN-000047", title: 'Note, "draft"', folder_label: "Session & Progress Notes", person_name: "Lily Parker", person_type: "Participant", person_ref: "431000101", date: "2026-10-01T03:00:00Z", status: "completed" },
    ]);
    const [header, row] = csv.replace("﻿", "").trim().split("\r\n");
    expect(header).toBe("Document ID,Title,Folder,Person,Person type,Person ID,Date,Status,Source");
    expect(row).toBe('SUNR-SN-000047,"Note, ""draft""",Session & Progress Notes,Lily Parker,Participant,431000101,2026-10-01,completed,');
  });
});

it("writes a cover note with the period, folders and total", () => {
  const html = buildCoverNote({
    preparedBy: "Alex Director",
    preparedAt: today,
    period: resolvePeriod("3m", {}, today),
    folders: [{ label: "Incident <Reports>", count: 4 }],
    total: 4,
    note: "For the October verification audit.",
    includesRegister: true,
  });
  expect(html).toContain("Prepared by Alex Director on 12 October 2026");
  expect(html).toContain("Last 3 months");
  expect(html).toContain("Incident &lt;Reports&gt;");
  expect(html).toContain("For the October verification audit.");
  expect(html).toContain("Document register.csv");
});

it("drops a document that appears in two folders", () => {
  expect(uniqueDocs([{ category: "a", id: "1" }, { category: "a", id: "1" }, { category: "b", id: "1" }])).toHaveLength(2);
});
