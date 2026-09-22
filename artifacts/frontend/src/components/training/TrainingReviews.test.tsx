import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TrainingReviews } from "./TrainingReviews";
const mocks = vi.hoisted(() => ({ review: vi.fn(), refetch: vi.fn() }));
vi.mock("@/services/coordinatorService", () => ({
  getPendingTrainingCompletions: vi.fn(),
  reviewTrainingCompletion: mocks.review,
}));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: () => ({
    data: [
      {
        id: "r1",
        users: { full_name: "Sam Taylor" },
        training_modules: { title: "Safe transfers" },
        completed_at: "2026-09-15T10:00:00Z",
      },
    ],
    refetch: mocks.refetch,
    isLoading: false,
    isError: false,
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { organizationId: "org1" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("requires feedback for revision and sends it with the selected completion", async () => {
  render(<TrainingReviews />);
  const action = screen.getByRole("button", { name: "Request revision" });
  expect((action as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(
    screen.getByRole("textbox", { name: "Revision feedback for Sam Taylor" }),
    { target: { value: "  Please attach the assessment.  " } },
  );
  fireEvent.click(action);
  await waitFor(() =>
    expect(mocks.review).toHaveBeenCalledWith(
      "r1",
      false,
      "Please attach the assessment.",
    ),
  );
  expect(screen.queryByText(/2026-09-15T/)).toBeNull();
});
