import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { AppErrorBoundary, PageErrorBoundary } from "./ErrorBoundary";

const report = vi.hoisted(() => vi.fn());
vi.mock("@/lib/error-reporting", () => ({ reportClientError: report }));

let shouldThrow = true;
function Flaky() {
  if (shouldThrow) throw new Error("incident.date is undefined");
  return <p>Page content</p>;
}

beforeEach(() => {
  shouldThrow = true;
  report.mockClear();
  // React logs caught render errors to console.error; keep test output clean.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows the page fallback instead of blanking, and reports the crash", () => {
  const { hook } = memoryLocation({ path: "/incidents/1" });
  render(
    <Router hook={hook}>
      <PageErrorBoundary><Flaky /></PageErrorBoundary>
    </Router>,
  );
  expect(screen.getByRole("alert").textContent).toContain("This page ran into a problem");
  expect(report).toHaveBeenCalledTimes(1);
  expect(report.mock.calls[0][0].kind).toBe("page-crash");
  expect((report.mock.calls[0][0].error as Error).message).toBe("incident.date is undefined");
});

it("try again re-renders the page once the problem is gone", () => {
  const { hook } = memoryLocation({ path: "/incidents/1" });
  render(
    <Router hook={hook}>
      <PageErrorBoundary><Flaky /></PageErrorBoundary>
    </Router>,
  );
  shouldThrow = false;
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByText("Page content")).toBeTruthy();
});

it("navigating to another page clears the error", () => {
  const location = memoryLocation({ path: "/incidents/1" });
  render(
    <Router hook={location.hook}>
      <PageErrorBoundary><Flaky /></PageErrorBoundary>
    </Router>,
  );
  expect(screen.queryByRole("alert")).toBeTruthy();
  shouldThrow = false;
  act(() => location.navigate("/dashboard"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByText("Page content")).toBeTruthy();
});

it("app boundary catches anything the page boundary doesn't", () => {
  render(<AppErrorBoundary><Flaky /></AppErrorBoundary>);
  expect(screen.getByRole("alert").textContent).toContain("CareCliQ ran into a problem");
  expect(report.mock.calls[0][0].kind).toBe("app-crash");
});
