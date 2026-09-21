import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import MDOnboardingTrainingPage from "./onboarding-training";
const mocks = vi.hoisted(() => ({ modules: vi.fn() }));
vi.mock("@/services/coordinatorService", () => ({
  getTrainingModules: mocks.modules,
  updateTrainingModule: vi.fn(),
}));
vi.mock("@/components/layout/HubLayout", () => ({
  HubLayout: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({ translate: (s: string) => s }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/training/TrainingModuleEditor", () => ({
  TrainingModuleEditor: () => null,
}));
vi.mock("@/components/training/WorkerResourceLibrary", () => ({
  SharedResourceAccess: () => null,
}));
vi.mock("@/components/training/CourseCover", () => ({
  CourseCover: () => null,
}));
vi.mock("@/components/training/TrainingReviews", () => ({
  TrainingReviews: () => <p>Review queue</p>,
}));
vi.mock("@/components/ui/section-info", () => ({ SectionInfo: () => null }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it("combines catalogue search with availability filters", async () => {
  mocks.modules.mockResolvedValue([
    {
      id: "a",
      title: "Safe transfers",
      is_locked: false,
      auto_assign_on_hire: true,
    },
    {
      id: "b",
      title: "Communication skills",
      is_locked: true,
      auto_assign_on_hire: false,
    },
  ]);
  render(<MDOnboardingTrainingPage />);
  await screen.findByText("Safe transfers");
  fireEvent.change(screen.getByRole("combobox", { name: "Show modules" }), {
    target: { value: "maintenance" },
  });
  expect(screen.queryByText("Safe transfers")).toBeNull();
  expect(screen.getByText("Communication skills")).toBeTruthy();
  fireEvent.change(
    screen.getByRole("textbox", { name: "Search training modules" }),
    { target: { value: "  transfers  " } },
  );
  expect(
    screen.getByText("No modules match your search and filter."),
  ).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Show modules" }), {
    target: { value: "all" },
  });
  expect(screen.getByText("Safe transfers")).toBeTruthy();
});
it("marks the selected section and opens completion reviews", async () => {
  mocks.modules.mockResolvedValue([]);
  render(<MDOnboardingTrainingPage />);
  await screen.findByText("No training modules yet");
  const reviews = screen.getByRole("button", { name: "Completion reviews" });
  fireEvent.click(reviews);
  expect(reviews.getAttribute("aria-pressed")).toBe("true");
  expect(screen.getByText("Review queue")).toBeTruthy();
});
