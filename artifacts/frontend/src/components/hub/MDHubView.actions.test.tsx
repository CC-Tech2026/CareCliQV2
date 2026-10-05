import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DemandCapacityPanel, DocumentationInsights } from "./MDHubView";

afterEach(cleanup);
const data = {
  waitlist: { count: 3, hours: 24 },
  capacity: { reliable_hours: 20, casual_hours: 12, workers_counted: 4, workers_without_availability: 2, week_start: "2026-10-05" },
};

it("opens the relevant workflow from each demand and capacity card", () => {
  const navigate = vi.fn();
  render(<DemandCapacityPanel data={data} loading={false} error={false} onRetry={() => {}} onNavigate={navigate} />);
  fireEvent.click(screen.getByRole("button", { name: /Review participant intake/ }));
  expect(navigate).toHaveBeenLastCalledWith("/onboard-participant");
  fireEvent.click(screen.getByRole("button", { name: /Review support requests/ }));
  expect(navigate).toHaveBeenLastCalledWith("/onboard-participant");
  fireEvent.click(screen.getByRole("button", { name: /Review staff availability/ }));
  expect(navigate).toHaveBeenLastCalledWith("/md/schedule");
  expect(screen.getByText("32 h")).toBeTruthy();
  expect(screen.getByText(/2 workers have no availability recorded/)).toBeTruthy();
});

it("does not turn missing data into zero demand or capacity", () => {
  render(<DemandCapacityPanel loading error={false} onRetry={() => {}} onNavigate={() => {}} />);
  expect(screen.getByRole("status")).toBeTruthy();
  expect(screen.queryByText("0 h")).toBeNull();
  expect(screen.queryByRole("button")).toBeNull();
});

it("offers retry after a failed demand request", () => {
  const retry = vi.fn();
  render(<DemandCapacityPanel loading={false} error onRetry={retry} onNavigate={() => {}} />);
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledOnce();
});

it("separates unscored sessions and opens staff documentation from the quality breakdown", () => {
  const navigate = vi.fn();
  render(<DocumentationInsights data={{ compliance_score: 70, compliance_target: 85, documentation_summary: { sample_size: 10, scored: 8, unscored: 2, on_target: 4, needs_review: 3, priority_review: 1 }, common_issues: [{ issue: "Missing outcome detail", count: 5 }], workers_at_risk: [{ id: "worker-1", full_name: "Test worker", compliance_score: 70, sessions: 8 }] }} onNavigate={navigate} />);
  expect(screen.getByText("15 percentage points below the 85% target")).toBeTruthy();
  expect(screen.getByText(/4 of 8 scored sessions/)).toBeTruthy();
  expect(screen.getByRole("img").getAttribute("aria-label")).toContain("Not scored: 2");
  expect(screen.getByText("5 mentions")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Test worker/ }));
  expect(navigate).toHaveBeenCalledWith("/md/staff?workerId=worker-1&tab=shifts");
});
