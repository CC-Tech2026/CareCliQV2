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
  expect(screen.getAllByText("Plan-managed").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /No support worker 1/ }));
  expect(screen.queryByRole("button", { name: /Sam Morgan/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Alex Taylor/ })).toBeTruthy();
});

it("tells two people with the same name apart and finds them by birth date, suburb or worker", () => {
  const twins = [
    { id: "jo-1", full_name: "Jo Smith", ndis_number: "430000011", status: "active", service_category: "disability" },
    { id: "jo-2", full_name: "Jo Smith", ndis_number: "430000022", status: "active", service_category: "disability" },
  ] as any;
  const details = {
    "jo-1": { workerName: "Priya Nair", workers: ["Priya Nair"], dateOfBirth: "1950-03-12", address: "1 Beach Rd, Glenelg, SA 5045" },
    "jo-2": { workerName: "Ben Ito", workers: ["Ben Ito"], dateOfBirth: "1990-07-01", address: "9 Hill St, Norwood, SA 5067" },
  };
  render(<ActiveParticipantsPage intakes={twins} details={details} onBack={vi.fn()} onOpen={vi.fn()} onOpenComplaints={vi.fn()} />);
  expect(screen.getAllByText("Same name")).toHaveLength(2);
  expect(screen.getByText(/born 12 Mar 1950 · Glenelg · NDIS 430000011/)).toBeTruthy();

  const search = screen.getByRole("textbox", { name: "Search participants" });
  fireEvent.change(search, { target: { value: "12/03/1950" } });
  expect(screen.getAllByRole("button", { name: /Jo Smith/ })).toHaveLength(1);
  expect(screen.getByText(/Glenelg/)).toBeTruthy();

  fireEvent.change(search, { target: { value: "norwood" } });
  expect(screen.getByText(/NDIS 430000022/)).toBeTruthy();
  expect(screen.queryByText(/NDIS 430000011/)).toBeNull();

  fireEvent.change(search, { target: { value: "priya" } });
  expect(screen.getByText(/NDIS 430000011/)).toBeTruthy();
  expect(screen.queryByText(/NDIS 430000022/)).toBeNull();
});
