import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Users } from "lucide-react";
import { ManagementPageSearch } from "./ManagementPageSearch";
const navigate = vi.hoisted(() => vi.fn());
vi.mock("wouter", () => ({ useLocation: () => ["/hub", navigate] }));
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
it("opens with the keyboard shortcut, filters and navigates", () => {
  render(<ManagementPageSearch groups={groups} />);
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  expect(screen.getByRole("dialog")).toBeTruthy();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search management pages" }),
    { target: { value: "reports" } },
  );
  expect(screen.getByText("1 matching pages")).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(navigate).toHaveBeenCalledWith("/reports");
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("shows a useful empty state rather than non-working results", () => {
  render(<ManagementPageSearch groups={groups} />);
  fireEvent.click(screen.getByRole("button", { name: "Find a page" }));
  fireEvent.change(screen.getByRole("textbox"), {
    target: { value: "missing" },
  });
  expect(
    screen.getByText("No matching pages. Try a different name."),
  ).toBeTruthy();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
  expect(navigate).not.toHaveBeenCalled();
});
it("does not open over an existing dialog", () => {
  render(
    <>
      <div role="dialog" aria-label="Editing a record" />
      <ManagementPageSearch groups={groups} />
    </>,
  );
  fireEvent.keyDown(document, { key: "k", ctrlKey: true });
  expect(
    screen.queryByRole("textbox", { name: "Search management pages" }),
  ).toBeNull();
});
