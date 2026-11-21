import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DirectorOverview } from "@/services/directorParticipantService";
import { AgreementsSection, ProfileHeader, RecentShiftsSection, SupportNeedsSection } from "./DirectorParticipantCards";
import { CareTeamPanel, DeliverySection, FundingSection } from "./DirectorParticipantSections";
import { OpenParticipantTabs } from "./OpenParticipantTabs";

vi.mock("@/hooks/useOrgQuery", () => ({ useOrgQuery: () => ({ data: { documents: [] }, isLoading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/labels/labels", () => ({ PersonLabels: () => null }));

afterEach(cleanup);

const overview = {
  participant: {
    id: "p1",
    full_name: "Ralph Edwards",
    date_of_birth: "1941-01-15",
    primary_disability: "Acquired brain injury",
    risk_level: "high",
    plan_start_date: "2026-03-01",
    plan_end_date: "2027-02-28",
    plan_management_type: "plan-managed",
    ndis_number: "430000001",
  },
  intake: { id: "i1", status: "active", activated_at: "2024-03-09" },
  team: { coordinator: null, main_worker: { id: "w1", name: "Priya Sharma" }, backups: [{ id: "w2", name: "Ben Ito", allocation_id: "a1" }] },
  funding: { has_plan: true, total: 50000, used: 20000, remaining: 30000, percent_used: 40, percent_time_elapsed: 55, ahead_by: null, categories: [] },
  delivery: { completed_30d: 21, cancelled_30d: 3, hours_30d: 63, upcoming_14d: 8, unfilled_14d: 1, next_shift: null, last_shift_at: null },
  quality: { notes_30d: 21, average_score: 88, needs_attention_30d: 1 },
  risk: {
    incidents_total: 4,
    incidents_open: [{ id: "inc1", title: "Fall", ndis_reportable: false }],
    latest_incident: null,
    complaints_total: 0,
    complaints_open: [],
  },
  medication: { active: 2, pending_verification: 0, high_risk: 1, prn: 1 },
  agreement: null,
  portal: { status: null, people: [] },
  decisions: [],
  care: {
    primary_disability: "Acquired brain injury",
    allergies: ["Penicillin", "Atopic eczema"],
    alerts: ["Choking risk with dry food"],
    communication: "Short sentences",
    medications: [
      { name: "Warfarin", high_risk: true, prn: false },
      { name: "Paracetamol", high_risk: false, prn: true },
    ],
    emergency_contact: { name: "Jo Edwards", relationship: "Daughter", phone: "0400 000 000" },
  },
  recent_shifts: [
    { id: "s1", start: "2026-11-05T22:45:00Z", end: "2026-11-05T23:15:00Z", status: "completed", worker: { id: "w1", name: "Priya Sharma" }, review: "changes_requested" },
    { id: "s2", start: "2026-11-04T22:45:00Z", end: "2026-11-04T23:15:00Z", status: "completed", worker: { id: "w2", name: "Ben Ito" }, review: "verified" },
    { id: "s3", start: "2026-11-03T22:45:00Z", end: null, status: "completed", worker: null, review: null },
  ],
} as unknown as DirectorOverview;

it("heads the profile with who they are and where their NDIS plan stands", () => {
  render(<ProfileHeader overview={overview} actions={<button type="button">Add a shift</button>} />);
  expect(screen.getByRole("heading", { level: 1, name: "Ralph Edwards" })).toBeTruthy();
  expect(screen.getByText("Receiving supports")).toBeTruthy();
  expect(screen.getByText(/Acquired brain injury/)).toBeTruthy();
  expect(screen.getByText(/NDIS 430000001/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Copy NDIS number" })).toBeTruthy();
  expect(screen.getByText(/NDIS plan 1 Mar 2026 to 28 Feb 2027/)).toBeTruthy();
  expect(screen.getByText(/Plan-managed/)).toBeTruthy();
  expect(screen.getByText("High risk")).toBeTruthy();
  expect(screen.getByText("(1 open)")).toBeTruthy();
  expect(screen.getByText(/Supported since 9 Mar 2024/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Add a shift" })).toBeTruthy();
});

it("says when services are suspended instead of receiving supports", () => {
  render(<ProfileHeader overview={{ ...overview, intake: { id: "i1", status: "inactive" } } as DirectorOverview} />);
  expect(screen.getByText("Services suspended")).toBeTruthy();
});

it("shows the plan budget against the plan's time, and delivery in the last 30 days", () => {
  render(<><FundingSection overview={overview} onReview={vi.fn()} /><DeliverySection overview={overview} onOpenSchedule={vi.fn()} onOpenShifts={vi.fn()} /></>);
  const budget = screen.getByRole("region", { name: "NDIS plan budget" });
  expect(within(budget).getByText("$30,000")).toBeTruthy();
  expect(within(budget).getByText("Remaining")).toBeTruthy();
  const delivered = screen.getByRole("region", { name: "Support delivered" });
  expect(within(delivered).getByText("21")).toBeTruthy();
  expect(within(delivered).getByText("63h")).toBeTruthy();
  expect(within(delivered).getByText("progress note quality")).toBeTruthy();
  expect(within(delivered).getByText(/1 without a worker/)).toBeTruthy();
});

it("lists support needs by name, each row opening Support needs", () => {
  const onOpenNeeds = vi.fn();
  const onOpenMedication = vi.fn();
  render(<SupportNeedsSection overview={overview} onOpenNeeds={onOpenNeeds} onOpenMedication={onOpenMedication} />);
  expect(screen.getByText("Penicillin")).toBeTruthy();
  expect(screen.getByText("Choking risk with dry food")).toBeTruthy();
  expect(screen.getByText(/Warfarin, Paracetamol/)).toBeTruthy();
  expect(screen.getByText("1 high-risk")).toBeTruthy();
  expect(screen.getByText("Jo Edwards · Daughter · 0400 000 000")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Medication/ }));
  expect(onOpenMedication).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "All support needs" }));
  expect(onOpenNeeds).toHaveBeenCalled();
});

it("names the key worker, backups, and a missing care coordinator", () => {
  render(<CareTeamPanel overview={overview} onChange={vi.fn()} />);
  const team = screen.getByRole("region", { name: "Support team" });
  expect(within(team).getByText("Key worker")).toBeTruthy();
  expect(within(team).getByText("Priya Sharma")).toBeTruthy();
  expect(within(team).getByText("Ben Ito")).toBeTruthy();
  expect(within(team).getByText("Care coordinator").nextSibling?.textContent).toBe("Not set");
});

it("shows the latest shifts with where each progress note stands", () => {
  const onOpenShift = vi.fn();
  render(<RecentShiftsSection overview={overview} onOpenShift={onOpenShift} onSeeAll={vi.fn()} />);
  expect(screen.getByText("Changes requested")).toBeTruthy();
  expect(screen.getByText("Verified")).toBeTruthy();
  expect(screen.getByText("Progress note not written")).toBeTruthy();
  expect(screen.getByText("No worker")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Priya Sharma/ }));
  expect(onOpenShift).toHaveBeenCalledWith("s1", "changes_requested");
});

it("flags a missing service agreement and opens each piece of paperwork", () => {
  const onOpenAgreement = vi.fn();
  const onManagePortal = vi.fn();
  render(<AgreementsSection overview={overview} onOpenAgreement={onOpenAgreement} onOpenIntake={vi.fn()} onManagePortal={onManagePortal} />);
  expect(screen.getByText("None on file")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Set up service agreement" }));
  expect(onOpenAgreement).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Manage participant portal" }));
  expect(onManagePortal).toHaveBeenCalled();
});

beforeEach(() => sessionStorage.clear());

it("keeps opened participants as tabs and moves to the next one when the open tab closes", () => {
  const people = [
    { id: "a", name: "Ralph Edwards" },
    { id: "b", name: "Aliyah Mueller" },
  ];
  const onOpen = vi.fn();
  const onShowList = vi.fn();
  const { rerender } = render(<OpenParticipantTabs activeId="a" participants={people} onOpen={onOpen} onShowList={onShowList} />);
  rerender(<OpenParticipantTabs activeId="b" participants={people} onOpen={onOpen} onShowList={onShowList} />);
  const tabs = screen.getByRole("navigation", { name: "Open participants" });
  expect(within(tabs).getByRole("button", { name: "Ralph Edwards" })).toBeTruthy();
  expect(within(tabs).getByRole("button", { name: "Aliyah Mueller" }).getAttribute("aria-current")).toBe("page");

  fireEvent.click(within(tabs).getByRole("button", { name: "Close Aliyah Mueller" }));
  expect(onOpen).toHaveBeenCalledWith("a");

  fireEvent.click(within(tabs).getByRole("button", { name: "Close Ralph Edwards" }));
  expect(within(tabs).queryByRole("button", { name: "Ralph Edwards" })).toBeNull();
  fireEvent.click(within(tabs).getByRole("button", { name: "All participants" }));
  expect(onShowList).toHaveBeenCalled();
});
