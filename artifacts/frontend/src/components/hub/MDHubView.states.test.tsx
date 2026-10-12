import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MDHubView } from "./MDHubView";

const { query, retry } = vi.hoisted(() => ({ query: vi.fn(), retry: vi.fn() }));
vi.mock("@/hooks/useOrgQuery", () => ({ useOrgQuery: query }));
vi.mock("@/contexts/AccessibilityContext", () => ({ useAccessibility: () => ({ translate: (key: string) => key }) }));
vi.mock("@/components/hub/GovernanceTriage", () => ({ GovernanceTriage: () => <div>Action items</div> }));

const overview = {
  active_participants: 12, active_staff: 8, support_workers: 6, coordinators: 2,
  participants_by_sex: { male: 6, female: 6, unspecified: 0 },
  participants_by_plan_status: { active: 12, pending: 0, review: 0, expired: 0, inactive: 0 },
  staff_retention_rate: 95, sessions_this_week: 20, compliance_score: 90,
  compliance_target: 85, goal_achievement_rate: 80, workers_at_risk: [], common_issues: [],
};

function mockOverview(state: Record<string, unknown>) {
  query.mockImplementation((key: string[]) => key.includes("dashboard")
    ? { isLoading: false, isError: false, isFetching: false, refetch: retry, ...state }
    : { isLoading: true, isError: false, refetch: vi.fn() });
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

it("announces the initial loading state", () => {
  mockOverview({ isLoading: true });
  render(<MDHubView />);
  expect(screen.getByRole("status", { name: "Loading executive briefing" })).toBeTruthy();
});

it("offers a working retry when the overview fails", () => {
  mockOverview({ isError: true });
  render(<MDHubView />);
  expect(screen.getByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(retry).toHaveBeenCalledOnce();
});

it("preserves cached metrics after a failed background refresh", () => {
  mockOverview({ data: overview, isError: true });
  render(<MDHubView />);
  expect(screen.getByText("Refresh failed. Showing the last available overview.")).toBeTruthy();
  expect(screen.getByText("Support visits")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Refresh overview" }));
  expect(retry).toHaveBeenCalledOnce();
});

it("prevents repeated refresh requests while fetching", () => {
  mockOverview({ data: overview, isFetching: true });
  render(<MDHubView />);
  const button = screen.getByRole("button", { name: "Refreshing…" }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
  fireEvent.click(button);
  expect(retry).not.toHaveBeenCalled();
});
