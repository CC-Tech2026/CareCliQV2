import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActiveParticipantsPage } from "./onboard-participant";

vi.mock("@/components/ui/section-info", () => ({ SectionInfo: () => null }));
afterEach(cleanup);
const intakes = [
  { id: "active-1", full_name: "Alex Taylor", ndis_number: "123", status: "active", service_category: "disability" },
  { id: "inactive-1", full_name: "Sam Morgan", ndis_number: "456", status: "inactive", service_category: "aged_care" },
] as any;

it("filters by status, clears a failed search and opens a participant", () => {
  const open = vi.fn();
  render(<ActiveParticipantsPage intakes={intakes} onBack={vi.fn()} onOpen={open} onOpenComplaints={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: /Inactive 1/ }));
  expect(screen.queryByText("Alex Taylor")).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Search participants" }), { target: { value: "missing" } });
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  fireEvent.click(screen.getByRole("button", { name: /Alex Taylor/ }));
  expect(open).toHaveBeenCalledWith("active-1");
});

it("provides an onboarding action when there are no participants", () => {
  const back = vi.fn();
  render(<ActiveParticipantsPage intakes={[]} onBack={back} onOpen={vi.fn()} onOpenComplaints={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Open participant onboarding" }));
  expect(back).toHaveBeenCalledOnce();
});

it("shows a retry instead of an empty directory when participants fail to load", () => {
  const retry = vi.fn();
  render(<ActiveParticipantsPage intakes={[]} loadFailed onRetry={retry} onBack={vi.fn()} onOpen={vi.fn()} onOpenComplaints={vi.fn()} />);
  expect(screen.queryByText("Your participant directory starts here")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledOnce();
});

it("shows each participant's worker, plan and budget, and filters to those without a worker", () => {
  const details = {
    "active-1": { workerName: null, planEnd: "2099-06-30", totalBudget: 40000, usedBudget: 10000, planManagement: "plan-managed", activeGoals: 2 },
    "inactive-1": { workerName: "Priya Nair", planEnd: null, totalBudget: 0 },
  };
  render(<ActiveParticipantsPage intakes={intakes} details={details} onBack={vi.fn()} onOpen={vi.fn()} onOpenComplaints={vi.fn()} />);
  expect(screen.getAllByText("Not assigned").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Priya Nair").length).toBeGreaterThan(0);
  expect(screen.getAllByText("25% used").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Plan managed").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /No support worker 1/ }));
  expect(screen.queryByRole("button", { name: /Sam Morgan/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Alex Taylor/ })).toBeTruthy();
});
