import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { CalendarPlus, Users } from "lucide-react";
import { ManagementPageSearch } from "./ManagementPageSearch";
const navigate = vi.hoisted(() => vi.fn());
vi.mock("wouter", () => ({ useLocation: () => ["/hub", navigate] }));
vi.mock("@workspace/api-client-react", () => ({
  getGetParticipantsQueryKey: () => ["participants"],
  useGetParticipants: () => ({
    isLoading: false,
    data: [
      { id: "p-1", full_name: "Liam Mitchell", ndis_number: "431990001", address: "12 Glenroy St, Woodville, SA 5011" },
      { id: "p-2", full_name: "Priya Singh", ndis_number: "431990004", address: "4 Beach Rd, Glenelg, SA 5045" },
    ],
  }),
}));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: () => ({
    isLoading: false,
    data: [{ id: "w-1", full_name: "Aisha Rahman", role: "support_worker", email: "aisha@example.com", suburb: "Glenelg" }],
  }),
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const groups = [
  {
    label: "Management",
    items: [
      { href: "/md/staff", label: "Staff", icon: Users },
      { href: "/reports", label: "Reports & insights", icon: Users },
    ],
  },
];
const actions = [{ href: "/md/calendar?book=1", label: "Book a meeting", detail: "With a participant", icon: CalendarPlus }];

it("opens with the keyboard shortcut, filters and navigates", () => {
  render(<ManagementPageSearch groups={groups} />);
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.change(screen.getByRole("textbox", { name: "Search" }), { target: { value: "reports" } });
  expect(screen.getByText("1 result")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(navigate).toHaveBeenCalledWith("/reports");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("shows a useful empty state rather than non-working results", () => {
  render(<ManagementPageSearch groups={groups} />);
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "missing" } });
  expect(screen.getByText('Nothing matches "missing"')).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(navigate).not.toHaveBeenCalled();
});

it("finds participants and staff by name or suburb, people first", () => {
  render(<ManagementPageSearch groups={groups} actions={actions} includePeople />);
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "glenelg" } });
  const participants = screen.getByRole("group", { name: "Participants" });
  expect(within(participants).getByRole("option", { name: /Priya Singh/ })).toBeTruthy();
  expect(within(participants).queryByRole("option", { name: /Liam Mitchell/ })).toBeNull();
  expect(within(screen.getByRole("group", { name: "Staff" })).getByRole("option", { name: /Aisha Rahman/ })).toBeTruthy();
  // The first result is highlighted, so Enter opens it.
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(navigate).toHaveBeenCalledWith("/patients?id=p-2");
});

it("moves through results with the arrow keys", () => {
  render(<ManagementPageSearch groups={groups} actions={actions} includePeople />);
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "4319900" } });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "ArrowDown" });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(navigate).toHaveBeenCalledWith("/patients?id=p-2");
});

it("offers quick actions before anything is typed", () => {
  render(<ManagementPageSearch groups={groups} actions={actions} includePeople />);
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  const quick = screen.getByRole("group", { name: "Quick actions" });
  fireEvent.click(within(quick).getByRole("option", { name: /Book a meeting/ }));
  expect(navigate).toHaveBeenCalledWith("/md/calendar?book=1");
});

it("does not open over an existing dialog", () => {
  render(
    <>
      <div role="dialog" aria-label="Editing a record" />
      <ManagementPageSearch groups={groups} />
    </>,
  );
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  expect(screen.queryByRole("textbox", { name: "Search" })).toBeNull();
});
