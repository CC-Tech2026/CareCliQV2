import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { OrgSetupChecklist } from "./OrgSetupChecklist";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@/hooks/useOrgQuery", () => ({ useOrgQuery: query }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { organizationId: "org-1" } }) }));

function orgDetails(data: Record<string, unknown> | undefined) {
  query.mockReturnValue({ isLoading: false, data });
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
afterEach(cleanup);

it("shows what a brand-new organisation still has to do", () => {
  orgDetails({ abn: null, address: null });
  const navigate = vi.fn();
  render(<OrgSetupChecklist staffCount={0} participantCount={0} onNavigate={navigate} />);
  expect(screen.getByText("0 of 3 done")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Add details/ }));
  expect(navigate).toHaveBeenCalledWith("/settings?section=provider");
  fireEvent.click(screen.getByRole("button", { name: /Invite staff/ }));
  expect(navigate).toHaveBeenCalledWith("/settings?section=team");
  fireEvent.click(screen.getByRole("button", { name: /Add participant/ }));
  expect(navigate).toHaveBeenCalledWith("/onboard-participant");
});

it("ticks steps from real records", () => {
  orgDetails({ abn: "51824753556", address: "24 King Street Adelaide SA 5000" });
  render(<OrgSetupChecklist staffCount={2} participantCount={0} onNavigate={vi.fn()} />);
  expect(screen.getByText("2 of 3 done")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Add details/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Add participant/ })).toBeTruthy();
});

it("disappears once the organisation is set up", () => {
  orgDetails({ abn: "51824753556", address: "24 King Street Adelaide SA 5000" });
  const { container } = render(<OrgSetupChecklist staffCount={3} participantCount={1} onNavigate={vi.fn()} />);
  expect(container.innerHTML).toBe("");
});

it("stays hidden for this organisation after Hide for now", () => {
  orgDetails({ abn: null, address: null });
  render(<OrgSetupChecklist staffCount={0} participantCount={0} onNavigate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Hide for now" }));
  expect(screen.queryByText("Get your organisation ready")).toBeNull();
  cleanup();
  const { container } = render(<OrgSetupChecklist staffCount={0} participantCount={0} onNavigate={vi.fn()} />);
  expect(container.innerHTML).toBe("");
});
