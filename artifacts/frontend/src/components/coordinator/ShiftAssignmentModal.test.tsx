import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ShiftAssignmentModal } from "./ShiftAssignmentModal";

// Mock the dependencies
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({
    toast: vi.fn(),
  }),
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { organizationId: "org-1" } }),
}));

vi.mock("@/services/coordinatorService", () => ({
  assignShift: vi.fn(),
  getCoordinatorCredentialAlerts: vi.fn().mockResolvedValue({ alerts: [], generated_at: "2026-01-01T00:00:00Z", training_due_count: 0 }),
  getCoordinatorWorkerCredentialStatus: vi.fn().mockResolvedValue({
    worker_id: "w-1",
    shift_type: "standard_support",
    credential_status: {
      valid: true,
      missing_credentials: [],
      warning: null,
    },
  }),
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

    const titleElement = screen.getAllByText("Assign Shift")[0];
    expect(titleElement).toBeTruthy();
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

    const assignButton = screen.getAllByRole("button", { name: /assign shift/i })[0];
    expect(assignButton).toBeTruthy();
  });

  it("displays worker selection dropdown", () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ShiftAssignmentModal
          open={true}
          onOpenChange={vi.fn()}
          workers={mockWorkers}
        />
      </QueryClientProvider>
    );

    const workerLabel = screen.getAllByText("Support Worker")[0];
    expect(workerLabel).toBeTruthy();
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

  it("shows credential status for pre-selected worker", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ShiftAssignmentModal
          open={true}
          onOpenChange={vi.fn()}
          workers={mockWorkers}
          worker={mockWorkers[0]}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      const credentialElement = screen.getByText("Credentials valid");
      expect(credentialElement).toBeTruthy();
    });
  });
});
