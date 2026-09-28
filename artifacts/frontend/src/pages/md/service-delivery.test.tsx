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

it("opens the identified participant profile directly", () => {
  mocks.data = [
    {
      id: "quiet-1",
      participant_id: "participant-123",
      title: "Alex: check contact",
      detail: "Review records",
      source: "participants",
      severity: "high",
    },
  ];
  render(<MDServiceDeliveryPage />);
  expect(
    screen.getByRole("link", { name: "View participant" }).getAttribute("href"),
  ).toBe("/patients?id=participant-123&tab=overview");
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search care alerts" }),
    { target: { value: "participant-123" } },
  );
  expect(screen.getByText("Alex: check contact")).toBeTruthy();
});
it("paginates alerts and resets the page after filtering", () => {
  mocks.data = Array.from({ length: 12 }, (_, i) => ({
    id: String(i),
    title: `Concern ${i}`,
    detail: "Review records",
    source: "participants",
    severity: "high",
  }));
  render(<MDServiceDeliveryPage />);
  expect(screen.queryByText("Concern 11")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByText("Concern 11")).toBeTruthy();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search care alerts" }),
    { target: { value: "Concern 0" } },
  );
  expect(screen.getByText("Concern 0")).toBeTruthy();
  expect(
    screen.queryByRole("navigation", { name: "Care alert pages" }),
  ).toBeNull();
});
