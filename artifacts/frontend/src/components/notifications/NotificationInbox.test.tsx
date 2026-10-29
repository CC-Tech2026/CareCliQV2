import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { NotificationBell, NotificationInbox } from "./NotificationInbox";

const state = vi.hoisted(() => ({
  role: "support_worker",
  inbox: [] as Array<Record<string, unknown>>,
  unread: 0,
  team: [] as Array<Record<string, unknown>>,
  error: false,
  refetch: vi.fn(),
  navigate: vi.fn(),
  markRead: vi.fn(),
  reply: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", organizationId: "org-1", role: state.role } }),
}));
vi.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({
    translate: (key: string) => key,
    translateParams: (key: string, params: Record<string, string>) => `${key}:${Object.values(params).join(",")}`,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }), toast: vi.fn() }));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: (key: string[]) => {
    const base = { isLoading: false, isError: state.error, refetch: state.refetch };
    if (key[0] === "notification-inbox") return { ...base, data: { notifications: state.inbox, count: state.inbox.length } };
    if (key[0] === "worker-notifications-unread") return { ...base, data: { notifications: [], count: state.unread } };
    return { ...base, data: state.team };
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
  useMutation: (opts: { mutationFn: (v?: unknown) => unknown }) => ({
    mutate: (v?: unknown) => opts.mutationFn(v),
    isPending: false,
  }),
}));
vi.mock("wouter", () => ({
  useLocation: () => ["/", state.navigate],
  Link: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("@/services/notificationService", () => ({
  fetchNotifications: vi.fn(),
  markInboxNotificationRead: (id: string) => state.markRead(id),
  markAllInboxNotificationsRead: vi.fn(),
  dismissNotification: vi.fn(),
  acknowledgeNotification: vi.fn(),
  replyToNotification: (id: string, message: string) => state.reply(id, message),
}));
vi.mock("@/services/coordinatorService", () => ({
  getCoordinatorNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));
vi.mock("@/services/shiftService", () => ({ acceptShiftOffer: vi.fn(), declineShiftOffer: vi.fn() }));
vi.mock("@/components/worker/WorkerBannerToastContent", () => ({ WorkerBannerToastContent: () => null }));

const now = new Date().toISOString();

afterEach(() => {
  cleanup();
  Object.assign(state, { role: "support_worker", inbox: [], unread: 0, team: [], error: false });
  vi.clearAllMocks();
});

it("counts a worker's unread notifications on the bell", () => {
  state.unread = 3;
  const open = vi.fn();
  render(<NotificationBell onClick={open} />);
  fireEvent.click(screen.getByRole("button", { name: "inbox.bellUnread:3" }));
  expect(open).toHaveBeenCalledOnce();
});

it("adds unread team alerts to an office user's bell", () => {
  state.role = "support_coordinator";
  state.unread = 2;
  state.team = [{ id: "a1", is_read: false }, { id: "a2", is_read: false }];
  render(<NotificationBell onClick={vi.fn()} />);
  expect(screen.getByText("4")).toBeTruthy();
});

it("offers a retry instead of saying all caught up when loading fails", () => {
  state.error = true;
  render(<NotificationInbox onClose={vi.fn()} />);
  expect(screen.getByRole("alert").textContent).toContain("inbox.loadFailed");
  expect(screen.queryByText("inbox.empty")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "inbox.tryAgain" }));
  expect(state.refetch).toHaveBeenCalledOnce();
});

it("opens a notification's full view, then its button goes to the shift", () => {
  state.inbox = [{ id: "n1", event_type: "shift_change", title: "Shift moved", body: "Now 9am. Was 8am.", severity: "medium", shift_id: "s1", created_at: now }];
  const close = vi.fn();
  render(<NotificationInbox onClose={close} />);
  fireEvent.click(screen.getByText("Shift moved"));
  // Full view: whole message, read on open, nothing navigated yet.
  expect(screen.getByRole("heading", { name: "Shift moved" })).toBeTruthy();
  expect(state.markRead).toHaveBeenCalledWith("n1");
  expect(state.navigate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: /inbox.go.shift/ }));
  expect(state.navigate).toHaveBeenCalledWith("/my-shifts/s1");
  expect(close).toHaveBeenCalledOnce();
});

it("shows a notification with nowhere to go in full, with a way back", () => {
  state.inbox = [{ id: "n1", event_type: "coordinator_message", title: "Team lunch", body: "Friday at noon, everyone welcome.", severity: "low", action_url: "/notifications", created_at: now }];
  state.role = "support_coordinator";
  render(<NotificationInbox onClose={vi.fn()} />);
  fireEvent.click(screen.getByText("Team lunch"));
  expect(screen.getByText("Friday at noon, everyone welcome.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /inbox.go/ })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /inbox.back/ }));
  expect(screen.getByRole("button", { name: /inbox.tab.all/ })).toBeTruthy();
});

it("opens straight to a linked notification", () => {
  state.inbox = [{ id: "n7", event_type: "training_recommended", title: "New training assigned", body: "Manual handling.", severity: "medium", created_at: now }];
  render(<NotificationInbox variant="page" initialOpenId="n7" />);
  expect(screen.getByRole("heading", { name: "New training assigned" })).toBeTruthy();
  expect(state.markRead).toHaveBeenCalledWith("n7");
  fireEvent.click(screen.getByRole("button", { name: /inbox.go.training/ }));
  expect(state.navigate).toHaveBeenCalledWith("/worker/training");
});

it("hides dismissed notifications and filters to unread", () => {
  state.inbox = [
    { id: "n1", event_type: "shift_reminder", title: "Unread one", body: "", severity: "low", created_at: now },
    { id: "n2", event_type: "shift_reminder", title: "Read one", body: "", severity: "low", read_at: now, created_at: now },
    { id: "n3", event_type: "shift_reminder", title: "Dismissed one", body: "", severity: "low", read_at: now, dismissed_at: now, created_at: now },
  ];
  render(<NotificationInbox />);
  expect(screen.queryByText("Dismissed one")).toBeNull();
  expect(screen.getByText("Read one")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /inbox.tab.unread/ }));
  expect(screen.getByText("Unread one")).toBeTruthy();
  expect(screen.queryByText("Read one")).toBeNull();
});

it("lets a worker accept a shift offer from the panel; office staff don't get the buttons", () => {
  state.inbox = [{ id: "n1", event_type: "shift_offer", title: "Shift offer", body: "", severity: "medium", shift_id: "s1", created_at: now }];
  render(<NotificationInbox />);
  expect(screen.getByRole("button", { name: "notifications.panel.acceptShift" })).toBeTruthy();
  cleanup();
  state.role = "support_coordinator";
  render(<NotificationInbox />);
  expect(screen.queryByRole("button", { name: "notifications.panel.acceptShift" })).toBeNull();
  expect(screen.getByRole("button", { name: /inbox.tab.team/ })).toBeTruthy();
});

it("lets office staff answer a worker's on-shift message from the notification", () => {
  state.role = "support_coordinator";
  state.inbox = [{
    id: "n1", event_type: "coordinator_message", title: "Message from Tom Reid on shift", body: "Can you call me?",
    severity: "medium", shift_id: "s2", payload: { worker_id: "w9" }, created_at: now,
  }];
  render(<NotificationInbox onClose={vi.fn()} />);
  fireEvent.click(screen.getByText("Message from Tom Reid on shift"));
  fireEvent.click(screen.getAllByRole("button", { name: "inbox.reply" })[0]);
  fireEvent.change(screen.getByLabelText("inbox.replyLabel"), { target: { value: "Calling now" } });
  fireEvent.click(screen.getByRole("button", { name: "notifications.panel.sendReply" }));
  expect(state.reply).toHaveBeenCalledWith("n1", "Calling now");
});

it("doesn't offer office staff a reply on notifications that aren't from a worker", () => {
  state.role = "support_coordinator";
  state.inbox = [{ id: "n1", event_type: "coordinator_message", title: "New incident report", body: "", severity: "high", action_url: "/incidents/i1", created_at: now }];
  render(<NotificationInbox />);
  expect(screen.queryByRole("button", { name: "inbox.reply" })).toBeNull();
});
