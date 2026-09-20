import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { WorkerDetail } from "./WorkerDetail";
import type { WorkerStats } from "@/services/coordinatorService";
const state = vi.hoisted(() => ({
  role: "managing_director",
  credentialError: false,
  documentError: false,
  refetch: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { role: state.role } }),
}));
vi.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({ translate: (key: string) => key }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useReAuth", () => ({
  useReAuth: () => ({ requireReAuth: vi.fn(), modal: null }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: (key: string[]) => ({
    data:
      key[0] === "worker-training-assignments"
        ? { recommendations: [], history: [] }
        : key[0] === "worker-availability"
          ? null
          : [],
    isLoading: false,
    isError:
      (key[0] === "team-credentials" && state.credentialError) ||
      (key[0] === "worker-onboarding-documents" && state.documentError),
    refetch: state.refetch,
  }),
}));
vi.mock("@/components/coordinator/WorkerAvailabilityPanel", () => ({
  WorkerAvailabilityPanel: () => <p>Availability editor</p>,
}));
const worker: WorkerStats = {
  id: "worker-1",
  full_name: "Alexandra Taylor Morgan",
  email: "alexandra.morgan@example.test",
  role: "support_worker",
  total_sessions: 12,
  sessions_this_week: 2,
  avg_compliance: null,
  draft_count: 0,
  flagged_count: 0,
  onboarding_completed: true,
};
afterEach(() => {
  cleanup();
  state.credentialError = false;
  state.documentError = false;
  vi.clearAllMocks();
});
it.each(["managing_director", "support_coordinator"])(
  "offers the shared profile sections for %s",
  async (role) => {
    state.role = role;
    render(<WorkerDetail worker={worker} onBack={() => {}} />);
    expect(
      screen.getByRole("heading", { name: worker.full_name }),
    ).toBeTruthy();
    expect(screen.getByRole("link", { name: worker.email })).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /Next steps/ })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    fireEvent.change(
      screen.getByRole("combobox", { name: "Profile section" }),
      { target: { value: "availability" } },
    );
    expect(await screen.findByText("Availability editor")).toBeTruthy();
  },
);
it("does not present a failed credential lookup as missing credentials", () => {
  state.credentialError = true;
  render(<WorkerDetail worker={worker} onBack={() => {}} />);
  expect(screen.getByRole("alert").textContent).toContain(
    "Credential status could not be loaded",
  );
  expect(screen.queryByRole("button", { name: /Next steps/ })).toBeNull();
  expect(screen.queryByText(/^Nothing outstanding/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry credentials" }));
  expect(state.refetch).toHaveBeenCalledOnce();
});
it("resets the section when a different worker is opened", async () => {
  const { rerender } = render(
    <WorkerDetail worker={worker} onBack={() => {}} />,
  );
  fireEvent.change(screen.getByRole("combobox", { name: "Profile section" }), {
    target: { value: "availability" },
  });
  rerender(
    <WorkerDetail
      worker={{ ...worker, id: "worker-2", full_name: "Sam Taylor" }}
      onBack={() => {}}
    />,
  );
  await waitFor(() =>
    expect(
      (
        screen.getByRole("combobox", {
          name: "Profile section",
        }) as HTMLSelectElement
      ).value,
    ).toBe("personal"),
  );
});

it("offers document retry instead of an empty document record", async () => {
  state.documentError = true;
  render(
    <WorkerDetail worker={worker} initialTab="documents" onBack={() => {}} />,
  );
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByText("team.documents.empty")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry documents" }));
  expect(state.refetch).toHaveBeenCalledOnce();
});

it("groups secondary information and shows contact details once", () => {
  render(<WorkerDetail worker={worker} onBack={() => {}} />);
  expect(screen.getAllByText(worker.email!)).toHaveLength(1);
  for (const label of [
    "Work details",
    "Account & preferences",
    "Experience & interests",
  ]) {
    const group = screen.getByText(label).closest("details");
    expect(group).toBeTruthy();
    expect(group?.open).toBe(false);
  }
});

it("returns to the section start only when navigation happens below it", () => {
  render(<WorkerDetail worker={worker} onBack={() => {}} />);
  const sections = screen.getByRole("navigation", {
    name: "Worker profile sections",
  }).parentElement!;
  const scrollIntoView = vi.fn();
  sections.scrollIntoView = scrollIntoView;
  const rect = vi.spyOn(sections, "getBoundingClientRect");
  rect.mockReturnValue({ top: 200 } as DOMRect);
  fireEvent.change(screen.getByRole("combobox", { name: "Profile section" }), {
    target: { value: "availability" },
  });
  expect(scrollIntoView).not.toHaveBeenCalled();
  rect.mockReturnValue({ top: -400 } as DOMRect);
  fireEvent.change(screen.getByRole("combobox", { name: "Profile section" }), {
    target: { value: "personal" },
  });
  expect(scrollIntoView).toHaveBeenCalledWith({
    block: "start",
    behavior: "instant",
  });
});
