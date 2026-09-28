import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NotificationBell, NotificationPanel } from "./NotificationPanel";
const state = vi.hoisted(() => ({
  alerts: [] as Array<{ id: string; is_read: boolean }>,
  error: false,
  refetch: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { organizationId: "org-1" } }),
}));
vi.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({
    translate: (key: string) => key,
    translateParams: (key: string) => key,
  }),
}));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: () => ({
    data: state.alerts,
    isLoading: false,
    isError: state.error,
    refetch: state.refetch,
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isError: false }),
}));
afterEach(() => {
  cleanup();
  state.alerts = [];
  state.error = false;
  vi.clearAllMocks();
});
it("counts unread records and opens notifications when selected", () => {
  state.alerts = [
    { id: "1", is_read: true },
    { id: "2", is_read: false },
  ];
  const open = vi.fn();
  render(<NotificationBell onClick={open} />);
  expect(screen.getByText("1")).toBeTruthy();
  expect(screen.queryByText("2")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Notifications" }));
  expect(open).toHaveBeenCalledOnce();
});
it("shows a retry instead of saying all caught up after a failed request", () => {
  state.error = true;
  render(<NotificationPanel embedded onClose={vi.fn()} />);
  expect(screen.getByRole("alert").textContent).toContain(
    "Notifications could not be loaded",
  );
  expect(
    screen.queryByText("coordinator.notifications.allCaughtUp"),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(state.refetch).toHaveBeenCalledOnce();
});
