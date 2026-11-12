import { describe, expect, it } from "vitest";
import { buildGaps, groupIssues, type GapInput } from "./compliance-gaps";
import type { AuditChecklist, AuditItem } from "@/services/auditReadinessService";

const base: GapInput = {
  compliance_score: 90,
  compliance_target: 85,
  common_issues: [],
  org_alerts: [],
  team_compliance_breakdown: { compliant: 10, at_risk: 0, non_compliant: 0 },
};

function item(over: Partial<AuditItem>): AuditItem {
  return {
    id: Math.random().toString(36).slice(2),
    requirement_code: "STAFF_FIRST_AID",
    area: "staff",
    title: "First aid certificate",
    critical: false,
    subject_type: "worker",
    subject_id: "w-1",
    subject_name: "Aisha Rahman",
    status: "missing",
    applies_reason: "",
    due_date: null,
    next_action: "Upload a current first aid certificate.",
    evidence: [],
    not_applicable: null,
    ...over,
  };
}

function checklist(items: AuditItem[], byArea: AuditChecklist["summary"]["by_area"]): AuditChecklist {
  return {
    generated_at: "2026-11-12T00:00:00Z",
    profile_configured: true,
    items,
    summary: {
      total: 0,
      applicable: 0,
      counts: { missing: 0, awaiting_review: 0, current: 0, due_soon: 0, overdue: 0, not_applicable: 0 },
      readiness_percent: null,
      critical_gaps: 0,
      by_area: byArea,
    },
  };
}

describe("groupIssues", () => {
  it("counts one rule once however it was worded, with its fix", () => {
    const groups = groupIssues([
      { issue: "R2: Note completed 3 days after session", count: 4 },
      { issue: "R5: Session not linked to any NDIS goals", count: 5 },
      { issue: "R2: Note completed 6 days after session", count: 2 },
    ]);
    expect(groups[0]).toMatchObject({ label: "Notes written more than 48 hours after the shift", count: 6 });
    expect(groups[0].fix).toMatch(/finish notes on the day/);
    expect(groups[1].label).toBe("Notes not linked to an NDIS goal");
  });

  it("keeps an unknown issue as written", () => {
    expect(groupIssues([{ issue: "Add more detail about community access", count: 1 }])[0].label).toBe(
      "Add more detail about community access",
    );
  });
});

describe("buildGaps", () => {
  it("is audit ready when every measure is on target", () => {
    const report = buildGaps({
      data: base,
      checklist: checklist([], [{ area: "staff", label: "Staff", total: 4, ready: 4, gaps: 0 }]),
      attentionWorkers: [],
      workersBelow: 0,
    });
    expect(report.gaps).toEqual([]);
    expect(report.onTrack.map((t) => t.label)).toEqual(["Shift note documentation", "Staff documentation", "Staff files"]);
  });

  it("explains a low documentation score by its most common rule failures", () => {
    const report = buildGaps({
      data: {
        ...base,
        compliance_score: 72,
        team_compliance_breakdown: { compliant: 5, at_risk: 3, non_compliant: 2 },
        common_issues: [{ issue: "R5: Session not linked to any NDIS goals", count: 3 }],
      },
      attentionWorkers: [],
      workersBelow: 0,
    });
    const gap = report.gaps[0];
    expect(gap.key).toBe("documentation");
    expect(gap.summary).toBe("13 points below target. 2 notes non-compliant and 3 at risk out of 10 scored.");
    expect(gap.reasons[0]).toMatchObject({ text: "Notes not linked to an NDIS goal", detail: "3 notes flagged" });
    expect(gap.fixes[0]).toMatch(/goal tasks/);
    expect(gap.action.href).toBe("/sessions?band=non_compliant");
  });

  it("lists missing evidence by requirement, critical first, with who it is for and the next step", () => {
    const items = [
      item({ subject_name: "Aisha Rahman" }),
      item({ subject_name: "Tom Walsh", status: "overdue" }),
      item({ subject_name: "Grace Kim" }),
      item({ requirement_code: "STAFF_SCREENING", title: "NDIS worker screening", critical: true, next_action: "Record the screening ID." }),
      item({ requirement_code: "STAFF_INDUCTION", title: "Induction", status: "awaiting_review" }),
    ];
    const report = buildGaps({
      data: base,
      checklist: checklist(items, [{ area: "staff", label: "Staff", total: 10, ready: 5, gaps: 4 }]),
      attentionWorkers: [],
      workersBelow: 0,
    });
    const gap = report.gaps.find((g) => g.key === "staff")!;
    expect(gap.tone).toBe("danger");
    expect(gap.critical).toBe(1);
    expect(gap.summary).toBe("4 requirements missing or overdue out of 10, 1 critical. 1 more is waiting for approval.");
    expect(gap.reasons[0]).toMatchObject({ text: "NDIS worker screening", critical: true });
    expect(gap.reasons[1]).toMatchObject({ text: "First aid certificate", detail: "2 missing, 1 overdue · Aisha Rahman, Tom Walsh and 1 more" });
    expect(gap.reasons[1].href).toBe("/md/compliance?view=checklist&area=staff&status=gaps&q=First%20aid%20certificate");
    expect(gap.reasons.at(-1)?.text).toBe("1 document uploaded and waiting for approval");
    expect(gap.fixes).toEqual([
      "NDIS worker screening: record the screening ID.",
      "First aid certificate: upload a current first aid certificate.",
      "Approve the 1 document waiting for review.",
    ]);
    expect(report.criticalTotal).toBe(1);
  });

  it("names the requirement in each step instead of repeating the checklist's wording", () => {
    const items = [
      item({ title: "Risk management", requirement_code: "GOV_RISK", area: "governance", subject_type: "organisation", next_action: "Add or link evidence. A document in the vault's Risk Management folder." }),
      item({ title: "Public liability insurance", requirement_code: "INS_PL", area: "insurance", subject_type: "organisation", status: "overdue" }),
    ];
    const report = buildGaps({
      data: base,
      checklist: checklist(items, [
        { area: "governance", label: "Governance", total: 3, ready: 2, gaps: 1 },
        { area: "insurance", label: "Insurance", total: 1, ready: 0, gaps: 1 },
      ]),
      attentionWorkers: [],
      workersBelow: 0,
    });
    const gap = report.gaps.find((g) => g.key === "organisation")!;
    expect(gap.fixes).toEqual([
      "Risk management: add a document in the vault's Risk Management folder.",
      "Public liability insurance: replace or re-review the evidence, as it's no longer current.",
    ]);
    // Organisation-wide requirements aren't for a named person.
    expect(gap.reasons[0].detail).toBe("1 missing");
  });

  it("puts the most urgent gaps first", () => {
    const report = buildGaps({
      data: { ...base, org_alerts: [{ type: "x", severity: "high", message: "Incident overdue for NDIS notification" }] },
      attentionWorkers: [{ id: "w-1", full_name: "Kwame Mensah", compliance_score: 82 }],
      workersBelow: 1,
    });
    expect(report.gaps.map((g) => g.key)).toEqual(["alerts", "workers"]);
    expect(report.gaps[1].reasons[0]).toMatchObject({ text: "Kwame Mensah", detail: "82% average", href: "/md/staff?workerId=w-1" });
  });
});
