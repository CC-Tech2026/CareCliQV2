import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MDServiceDeliveryPage from "./service-delivery";
const mocks = vi.hoisted(() => ({
  error: false,
  data: [] as any[],
  refetch: vi.fn(),
}));
vi.mock("@/components/layout/HubLayout", () => ({
  HubLayout: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: () => ({
    data: mocks.data,
    isLoading: false,
    isFetching: false,
    isError: mocks.error,
    refetch: mocks.refetch,
  }),
}));
afterEach(() => {
  cleanup();
  mocks.error = false;
  mocks.data = [];
  vi.clearAllMocks();
});
it("routes shift concerns to the schedule and combines area and search filters", () => {
  mocks.data = [
    {
      id: "s",
      title: "Unfilled morning shift",
      detail: "Cover needed",
      source: "shifts",
      severity: "high",
      category: "urgent",
    },
    {
      id: "p",
      title: "Review participant contact",
      detail: "Alex Morgan",
      source: "participants",
      severity: "medium",
    },
  ];
  render(<MDServiceDeliveryPage />);
  expect(
    screen.getByRole("link", { name: "Review schedule" }).getAttribute("href"),
  ).toBe("/md/schedule");
  fireEvent.click(screen.getByRole("button", { name: /Participant contact/ }));
  expect(screen.queryByText("Unfilled morning shift")).toBeNull();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search care alerts" }),
    { target: { value: "nobody" } },
  );
  expect(screen.getByText("No alerts match these filters")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(screen.getByText("Unfilled morning shift")).toBeTruthy();
});
it("offers retry instead of showing an empty result when the request fails", () => {
  mocks.error = true;
  render(<MDServiceDeliveryPage />);
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.queryByText("No care alerts returned")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(mocks.refetch).toHaveBeenCalledOnce();
});
it("shows a neutral empty state without declaring care quality complete", () => {
  render(<MDServiceDeliveryPage />);
  expect(screen.getByText("No care alerts returned")).toBeTruthy();
});
