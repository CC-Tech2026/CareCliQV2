import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { DirectorOverview } from "@/services/directorParticipantService";
import { CareProfileCard, DeliveryBand, RecentShiftsCard, SummaryBand } from "./DirectorParticipantCards";
import { OpenParticipantTabs } from "./OpenParticipantTabs";

vi.mock("@/hooks/useOrgQuery", () => ({ useOrgQuery: () => ({ data: { documents: [] }, isLoading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

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
  team: { coordinator: null, main_worker: null, backups: [] },
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
  ],
} as unknown as DirectorOverview;

it("sums up the participant: who, the plan, the risk and how long they've been with you", () => {
  render(<SummaryBand overview={overview} />);
  expect(screen.getByRole("heading", { name: "Ralph Edwards" })).toBeTruthy();
  expect(screen.getByText(/Acquired brain injury/)).toBeTruthy();
  expect(screen.getByText("High risk")).toBeTruthy();
  expect(screen.getByText("+1 open")).toBeTruthy();
  expect(screen.getByText(/Plan managed/)).toBeTruthy();
});

it("shows delivered, cancelled and unfilled shifts", () => {
  render(<DeliveryBand overview={overview} />);
  const band = screen.getByRole("region", { name: "How support has gone" });
  expect(within(band).getByText("21")).toBeTruthy();
  expect(within(band).getByText("63 hours, last 30 days")).toBeTruthy();
  expect(within(band).getByRole("img").getAttribute("aria-label")).toBe("21 delivered, 3 cancelled, 1 unfilled");
});

it("lists allergies, alerts and medication by name, each opening the care record", () => {
  const onOpenCare = vi.fn();
  const onOpenMedication = vi.fn();
  render(<CareProfileCard overview={overview} onOpenCare={onOpenCare} onOpenMedication={onOpenMedication} onOpenRisks={vi.fn()} />);
  expect(screen.getByText("Penicillin")).toBeTruthy();
  expect(screen.getByText("Choking risk with dry food")).toBeTruthy();
  expect(screen.getByText(/Warfarin, Paracetamol/)).toBeTruthy();
  expect(screen.getByText("1 high-risk")).toBeTruthy();
  expect(screen.getByText("Jo Edwards · Daughter · 0400 000 000")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Medication/ }));
  expect(onOpenMedication).toHaveBeenCalled();
});

it("shows the latest shifts with where each stands with the office", () => {
  const onOpenShift = vi.fn();
  render(<RecentShiftsCard overview={overview} onOpenShift={onOpenShift} onNewShift={vi.fn()} />);
  expect(screen.getByText("Changes requested")).toBeTruthy();
  expect(screen.getByText("Verified")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Priya Sharma/ }));
  expect(onOpenShift).toHaveBeenCalledWith("s1", "changes_requested");
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
