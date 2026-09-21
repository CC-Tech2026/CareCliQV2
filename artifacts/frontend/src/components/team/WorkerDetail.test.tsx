import { Sheet, SheetContent } from "@/components/ui/sheet";
import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ShiftAuditPanel, WorkerDetail } from "./WorkerDetail";
import type { WorkerStats } from "@/services/coordinatorService";
const state = vi.hoisted(() => ({
  role: "managing_director",
  credentialError: false,
  documentError: false,
  failedQuery: "",
  validCredential: false,
  documents: [] as {
    id: string;
    title: string;
    document_type: string;
    created_at: string;
  }[],
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
      key[0] === "team-credentials" && state.validCredential
        ? [
            {
              id: "first-aid",
              user_id: "worker-1",
              credential_type: "first_aid",
              status: "valid",
            },
          ]
        : key[0] === "worker-onboarding-documents"
          ? state.documents
          : key[0] === "worker-training-assignments"
            ? { recommendations: [], history: [] }
            : key[0] === "worker-availability"
              ? null
              : [],
    isLoading: false,
    isError:
      key[0] === state.failedQuery ||
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
  state.failedQuery = "";
  state.validCredential = false;
  state.documents = [];
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

it.each([
  "personal",
  "shifts",
  "participants",
  "documents",
  "credentials",
  "availability",
  "training",
  "induction",
] as const)("gives the %s section a clear heading", (tab) => {
  render(<WorkerDetail worker={worker} initialTab={tab} onBack={() => {}} />);
  expect(
    screen.getByRole("heading", { name: `team.detail.tab.${tab}`, level: 2 }),
  ).toBeTruthy();
});
it("filters staff documents without changing the source count", () => {
  state.documents = [
    {
      id: "a",
      title: "Employment agreement",
      document_type: "other",
      created_at: "2026-09-01",
    },
    {
      id: "b",
      title: "Reference letter",
      document_type: "other",
      created_at: "2026-09-01",
    },
  ];
  render(
    <WorkerDetail worker={worker} initialTab="documents" onBack={() => {}} />,
  );
  fireEvent.change(screen.getByRole("searchbox", { name: "Find a document" }), {
    target: { value: "reference" },
  });
  expect(screen.queryByText("Employment agreement")).toBeNull();
  expect(screen.getByText("Reference letter")).toBeTruthy();
  expect(screen.getByText("1 of 2 documents").getAttribute("role")).toBe(
    "status",
  );
});
it.each([
  [
    "participants",
    "worker-assignments",
    "Participant assignments",
    "Not currently assigned to any participant.",
  ],
  [
    "shifts",
    "worker-shift-history",
    "Shift history",
    "No completed shifts on file yet.",
  ],
] as const)(
  "distinguishes a failed %s request from an empty record",
  (tab, query, label, empty) => {
    state.failedQuery = query;
    render(<WorkerDetail worker={worker} initialTab={tab} onBack={() => {}} />);
    expect(screen.queryByText(empty)).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: `Retry ${label.toLowerCase()}` }),
    );
    expect(state.refetch).toHaveBeenCalledOnce();
  },
);

it("keeps missing credentials visible while filtering out valid credentials", () => {
  state.validCredential = true;
  render(
    <WorkerDetail worker={worker} initialTab="credentials" onBack={() => {}} />,
  );
  expect(screen.getByText("First Aid")).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: /Needs attention/ }));
  expect(screen.queryByText("First Aid")).toBeNull();
  expect(screen.getByText("CPR")).toBeTruthy();
  fireEvent.click(screen.getByRole("checkbox", { name: /Needs attention/ }));
  expect(screen.getByText("First Aid")).toBeTruthy();
});

function renderShiftPanel() {
  HTMLElement.prototype.scrollTo = vi.fn();
  return render(
    <Sheet open>
      <SheetContent>
        <ShiftAuditPanel
          workerId="worker-1"
          shift={{
            id: "shift-1",
            participant_name: "Sam Taylor",
            scheduled_start: "2026-09-20T09:00:00",
            compliance_band: "green",
            compliance_score: 95,
          }}
        />
      </SheetContent>
    </Sheet>,
  );
}
it("opens on the summary and reveals only the selected shift section", () => {
  renderShiftPanel();
  expect(screen.getByRole("region", { name: "Shift summary" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Shift pay" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Timeline" }));
  expect(screen.getByRole("region", { name: "Shift timeline" })).toBeTruthy();
  expect(screen.queryByRole("region", { name: "Shift summary" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Pay" }));
  expect(screen.getByRole("region", { name: "Shift pay" })).toBeTruthy();
  expect(
    screen.getByRole("button", { name: "Pay" }).getAttribute("aria-pressed"),
  ).toBe("true");
});
it.each([
  [
    "Timeline",
    "shift-event-timeline",
    "Retry timeline",
    "No events recorded for this shift.",
  ],
  [
    "Incidents",
    "shift-incidents",
    "Retry incidents",
    "No incidents reported for this shift.",
  ],
  [
    "Pay",
    "shift-pay-preview",
    "Retry pay details",
    "No pay preview is available for this shift.",
  ],
  [
    "Summary",
    "worker-shift-history-detail",
    "Retry shift documentation",
    "No shift notes recorded.",
  ],
])(
  "shows a retry on %s when its request fails",
  (section, query, retry, empty) => {
    state.failedQuery = query;
    renderShiftPanel();
    fireEvent.click(screen.getByRole("button", { name: section }));
    expect(screen.queryByText(empty)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: retry }));
    expect(state.refetch).toHaveBeenCalledOnce();
  },
);
