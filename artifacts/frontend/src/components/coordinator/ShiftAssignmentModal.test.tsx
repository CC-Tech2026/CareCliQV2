import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShiftAssignmentModal } from "./ShiftAssignmentModal";

// Mock the dependencies
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

// Real English strings so assertions match what users see.
vi.mock("@/contexts/AccessibilityContext", async () => {
  const { t, tParams } = await import("@/lib/i18n/translations");
  return {
    useAccessibility: () => ({
      translate: (key: string) => t("en", key),
      translateParams: (key: string, params: Record<string, string>) => tParams("en", key, params),
    }),
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { organizationId: "org-1" } }),
}));

const credentialStatus = vi.hoisted(() => ({
  value: { valid: true, missing_credentials: [] as string[], warning: null as string | null },
}));

vi.mock("@/services/coordinatorService", () => ({
  assignShift: vi.fn(),
  createUnassignedShift: vi.fn().mockResolvedValue({ shift_id: "s-1", shift: {} }),
  getParticipantAgreementSupports: vi.fn().mockResolvedValue([]),
  getAvailableWorkers: vi.fn().mockResolvedValue([]),
  checkParticipantGoalsAndTasks: vi.fn().mockResolvedValue({ has_valid: true, active_goals: 1, tasks_count: 1, has_active_plan: true }),
  getParticipantTasks: vi.fn().mockResolvedValue([]),
  getParticipantPriceItemOptions: vi.fn().mockResolvedValue([]),
  getCoordinatorCredentialAlerts: vi.fn().mockResolvedValue({ alerts: [], generated_at: "2026-01-01T00:00:00Z", training_due_count: 0 }),
  getCoordinatorWorkerCredentialStatus: vi.fn(async () => ({
    worker_id: "w-1",
    shift_type: "standard_support",
    credential_status: credentialStatus.value,
  })),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ...actual,
    useGetParticipants: () => ({
      data: [
        { id: "p-1", full_name: "Jane Participant" },
        { id: "p-2", full_name: "John Participant" },
      ],
      isLoading: false,
    }),
  };
});

const mockWorkers = [
  {
    id: "w-1",
    full_name: "Alice Worker",
    email: "alice@example.com",
    role: "support_worker",
    is_active: true,
    total_sessions: 10,
    sessions_this_week: 2,
    avg_compliance: 88,
    draft_count: 0,
    flagged_count: 0,
  },
  {
    id: "w-2",
    full_name: "Bob Worker",
    email: "bob@example.com",
    role: "support_worker",
    is_active: true,
    total_sessions: 8,
    sessions_this_week: 1,
    avg_compliance: 72,
    draft_count: 1,
    flagged_count: 0,
  },
];

describe("ShiftAssignmentModal", () => {
  let queryClient: QueryClient;

  afterEach(() => cleanup());

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
  });

  it("renders the modal when open", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ShiftAssignmentModal
          open={true}
          onOpenChange={vi.fn()}
          workers={mockWorkers}
        />
      </QueryClientProvider>
    );

    expect(screen.getByText("Create shift")).toBeTruthy();
    expect(screen.getByText("Assign a shift to a support worker")).toBeTruthy();
    // The footer says what's still needed.
    expect(screen.getByText("Choose a participant")).toBeTruthy();
  });

  it("closes modal when cancel button is clicked", () => {
    const onOpenChange = vi.fn();
    render(
      <QueryClientProvider client={queryClient}>
        <ShiftAssignmentModal
          open={true}
          onOpenChange={onOpenChange}
          workers={mockWorkers}
        />
      </QueryClientProvider>
    );

    const cancelButtons = screen.getAllByRole("button", { name: /cancel/i });
    const cancelButton = cancelButtons[cancelButtons.length - 1];
    fireEvent.click(cancelButton);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("disables submit button when required fields are missing", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ShiftAssignmentModal
          open={true}
          onOpenChange={vi.fn()}
          workers={mockWorkers}
        />
      </QueryClientProvider>
    );

    // No participant chosen yet, so the submit button can't be used.
    const submitButton = screen.getAllByRole("button", { name: /create unassigned shift/i })[0];
    expect((submitButton as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks for a participant and time before suggesting workers", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ShiftAssignmentModal
          open={true}
          onOpenChange={vi.fn()}
          workers={mockWorkers}
        />
      </QueryClientProvider>
    );

    expect(screen.getByText("Suggested workers")).toBeTruthy();
    expect(screen.getByText("Choose a participant and time to see who fits best.")).toBeTruthy();
  });

  it("fills date and times from the roster cell, with the shift length", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ShiftAssignmentModal
          open={true}
          onOpenChange={vi.fn()}
          workers={mockWorkers}
          initialDate="2026-10-01"
        />
      </QueryClientProvider>
    );

    expect((screen.getByLabelText("Date") as HTMLInputElement).value).toBe("2026-10-01");
    expect((screen.getByLabelText("Start") as HTMLInputElement).value).toBe("09:00");
    expect((screen.getByLabelText(/^End/) as HTMLInputElement).value).toBe("13:00");
    expect(screen.getByText("· 4h")).toBeTruthy();
    // An end before the start runs overnight.
    fireEvent.change(screen.getByLabelText(/^End/), { target: { value: "07:00" } });
    expect(screen.getByText("· 22h · overnight")).toBeTruthy();
  });

  it("displays participant selection dropdown", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ShiftAssignmentModal
          open={true}
          onOpenChange={vi.fn()}
          workers={mockWorkers}
        />
      </QueryClientProvider>
    );

    const participantLabel = screen.getAllByText("Participant")[0];
    expect(participantLabel).toBeTruthy();
  });

  it("displays shift type selection dropdown", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ShiftAssignmentModal
          open={true}
          onOpenChange={vi.fn()}
          workers={mockWorkers}
        />
      </QueryClientProvider>
    );

    const shiftTypeLabel = screen.getAllByText("Shift Type")[0];
    expect(shiftTypeLabel).toBeTruthy();
  });

  it("keeps the clicked worker selected and explains a credential block", async () => {
    credentialStatus.value = { valid: false, missing_credentials: ["First Aid"], warning: null };
    render(
      <QueryClientProvider client={queryClient}>
        <ShiftAssignmentModal
          open={true}
          onOpenChange={vi.fn()}
          workers={mockWorkers}
          worker={mockWorkers[0]}
          initialParticipantId="p-1"
          initialDate="2026-10-01"
        />
      </QueryClientProvider>
    );

    const radio = await screen.findByRole("radio", { name: /Alice Worker/ });
    expect((radio as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(screen.getByText(/First Aid/)).toBeTruthy());
    expect(screen.getByText("Alice Worker is missing a required credential")).toBeTruthy();
    expect((screen.getByRole("button", { name: /Assign shift/ }) as HTMLButtonElement).disabled).toBe(true);
    credentialStatus.value = { valid: true, missing_credentials: [], warning: null };
  });

  it("says up front when the participant has no active NDIS plan", async () => {
    const service = await import("@/services/coordinatorService");
    vi.mocked(service.checkParticipantGoalsAndTasks).mockResolvedValueOnce({
      has_valid: true, active_goals: 1, tasks_count: 1, has_active_plan: false,
    } as never);
    render(
      <QueryClientProvider client={queryClient}>
        <ShiftAssignmentModal
          open={true}
          onOpenChange={vi.fn()}
          workers={mockWorkers}
          initialParticipantId="p-1"
          initialDate="2026-10-01"
        />
      </QueryClientProvider>
    );

    expect(await screen.findByText(/has no active NDIS plan/)).toBeTruthy();
    expect(screen.getByText("Add an active NDIS plan first")).toBeTruthy();
  });

  it("rosters against an agreed support, with hours used and its warnings", async () => {
    const service = await import("@/services/coordinatorService");
    const line = (over: Record<string, unknown>) => ({
      service_agreement_id: "sa-1", agreement_number: "SA-0001", agreement_status: "active",
      start_date: "2026-07-01", end_date: "2027-06-30", frequency: "weekly", location: "home",
      group_codes: [], in_current_catalogue: true, counted: true, hours_allocated: 52,
      delivered_hours: 18, booked_soon_hours: 6, booked_later_hours: 0, left_hours: 28, warnings: [], ...over,
    });
    vi.mocked(service.getParticipantAgreementSupports).mockResolvedValue([
      line({
        id: "line-1", support_item_code: "01_011_0107_1_1", item_name: "Assistance With Self-Care Activities - Standard - Weekday Daytime",
        unit: "H", agreement_status: "pending_signature", warnings: ["This agreement hasn't been signed yet."],
      }),
      line({
        id: "line-2", support_item_code: "04_590_0125_6_1", item_name: "Activity Based Transport", unit: "E",
        counted: false, hours_allocated: null, left_hours: null,
      }),
    ] as never);
    render(
      <QueryClientProvider client={queryClient}>
        <ShiftAssignmentModal open={true} onOpenChange={vi.fn()} workers={mockWorkers} initialParticipantId="p-1" initialDate="2026-10-05" />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Agreed support")).toBeTruthy();
    expect(screen.getByText("18h used · 6h booked")).toBeTruthy();
    expect(screen.getByText("28h left of 52h")).toBeTruthy();
    expect(screen.getByText("Per item, not counted in hours")).toBeTruthy();
    expect(screen.getByText(/SA-0001 · Not signed yet/)).toBeTruthy();
    // The proposed shift's times go with the request, so warnings fit this shift.
    expect(vi.mocked(service.getParticipantAgreementSupports)).toHaveBeenCalledWith(
      "p-1", expect.objectContaining({ start: expect.any(String), end: expect.any(String) }),
    );

    fireEvent.click(screen.getByRole("button", { name: /Self-Care Activities/ }));
    expect(screen.getByText("This agreement hasn't been signed yet.")).toBeTruthy();

    const submit = screen.getAllByRole("button", { name: /create unassigned shift/i })[0] as HTMLButtonElement;
    await waitFor(() => expect(submit.disabled).toBe(false));
    fireEvent.click(submit);
    await waitFor(() =>
      expect(vi.mocked(service.createUnassignedShift)).toHaveBeenCalledWith(
        expect.objectContaining({ service_agreement_support_id: "line-1", expected_price_item_code: "01_011_0107_1_1" }),
      ),
    );
    vi.mocked(service.getParticipantAgreementSupports).mockResolvedValue([]);
  });
});
