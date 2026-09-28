import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DirectorReportsHome } from "./DirectorReportsHome";
afterEach(cleanup);
it("filters the director library by reporting area and search", () => {
  render(<DirectorReportsHome onOpen={vi.fn()} />);
  fireEvent.change(screen.getByRole("combobox", { name: "Reporting area" }), {
    target: { value: "Finance" },
  });
  expect(
    screen.getByRole("heading", { name: "Revenue & invoices" }),
  ).toBeTruthy();
  expect(
    screen.queryByRole("heading", { name: "Shift documentation" }),
  ).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Find a report" }), {
    target: { value: "no match" },
  });
  expect(screen.getByText("No reports match your search.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(
    screen.getByRole("heading", { name: "Shift documentation" }),
  ).toBeTruthy();
});
it("opens the selected report and links to director workspaces", () => {
  const open = vi.fn();
  render(<DirectorReportsHome onOpen={open} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Open Incident register" }),
  );
  expect(open).toHaveBeenCalledWith("incidents");
  expect(
    screen
      .getAllByRole("link")
      .some((link) => link.getAttribute("href") === "/md/financial"),
  ).toBe(true);
});
