import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IncidentReportsSection } from "./reports";
const state = vi.hoisted(() => ({
  error: true,
  loading: false,
  refetch: vi.fn(),
}));
vi.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({ translate: (key: string) => key }),
}));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: () => ({
    data: [],
    isError: state.error,
    isLoading: state.loading,
    refetch: state.refetch,
  }),
}));
afterEach(() => {
  cleanup();
  state.error = true;
  state.loading = false;
  vi.clearAllMocks();
});
it("shows an incident request failure rather than an empty register", () => {
  render(<IncidentReportsSection />);
  expect(screen.getByRole("alert").textContent).toContain(
    "Incident reports unavailable",
  );
  expect(screen.queryByText("reports.incidents.empty")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(state.refetch).toHaveBeenCalled();
});
it("keeps loading separate from empty results", () => {
  state.error = false;
  state.loading = true;
  render(<IncidentReportsSection />);
  expect(screen.getByRole("status").textContent).toContain(
    "Loading incident reports",
  );
  expect(screen.queryByText("reports.incidents.empty")).toBeNull();
});
