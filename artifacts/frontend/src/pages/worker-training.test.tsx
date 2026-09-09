import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import WorkerTrainingPage from "./worker-training";

const fixtures = vi.hoisted(() => ({
  history: [] as Record<string, unknown>[],
  failed: false,
  locked: false,
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { organizationId: "org" } }),
}));
vi.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({
    translate: (key: string) => key,
    translateParams: (key: string) => key,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/ui/section-info", () => ({ SectionInfo: () => null }));
vi.mock("@/services/workerPerformanceService", () => ({
  getTrainingModules: vi.fn(),
  getSharedTrainingResources: vi.fn(),
  getSharedTrainingResourceUrl: vi
    .fn()
    .mockResolvedValue({ url: "https://example.org/signed.pdf" }),
  getTrainingRequests: vi.fn(),
  getTrainingHistory: vi.fn(),
  getTrainingRecommendations: vi.fn(),
  startTrainingModule: vi.fn().mockResolvedValue({ started_at: "2026-09-08" }),
  markTrainingComplete: vi.fn().mockResolvedValue({}),
  createTrainingRequest: vi.fn(),
}));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: (key: string[]) => ({
    isLoading: false,
    isError: fixtures.failed,
    refetch: vi.fn(),
    data:
      key[1] === "training-modules"
        ? {
            modules: [
              {
                id: "module",
                is_locked: fixtures.locked,
                lock_reason: "Updating our guidelines",
                title: "Safe support",
                description: "Build practical skills",
                resources: [
                  {
                    id: "pdf",
                    title: "Worker guide",
                    resource_type: "pdf",
                    external_url: "https://example.org/guide.pdf",
                  },
                  {
                    id: "missing",
                    title: "Private video",
                    resource_type: "video",
                    storage_path: "private/video.mp4",
                  },
                ],
              },
            ],
          }
        : key[1] === "training-history"
          ? { history: fixtures.history }
          : key[1] === "training-recommendations"
            ? {
                recommendations: [
                  {
                    training_module_id: "module",
                    started_at: "2026-09-08",
                    due_at: "2020-01-01",
                  },
                ],
              }
            : key[1] === "training-shared-resources"
              ? {
                  resources: [
                    {
                      id: "guideline",
                      name: "Workplace guidelines",
                      category: "Safety",
                      resource_type: "pdf",
                    },
                  ],
                }
              : { requests: [] },
  }),
}));

function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <WorkerTrainingPage />
    </QueryClientProvider>,
  );
}
afterEach(() => {
  cleanup();
  fixtures.history = [];
  fixtures.failed = false;
  fixtures.locked = false;
});

describe("worker learning experience", () => {
  it("filters the library without removing the continue-learning section", () => {
    mount();
    expect(screen.getByText("Continue learning")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search training modules"), {
      target: { value: "unmatched" },
    });
    expect(
      screen.getByText("No modules match your search or status filter."),
    ).toBeTruthy();
    expect(screen.getByText("Continue learning")).toBeTruthy();
  });
  it("opens materials in a new tab and never invents a link for stored files", () => {
    mount();
    fireEvent.click(screen.getAllByText("Safe support")[0]);
    const link = screen.getByRole("link", {
      name: "Open Worker guide in a new tab",
    });
    expect(link.getAttribute("href")).toBe("https://example.org/guide.pdf");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(
      screen.getByText("Link unavailable. Contact your coordinator."),
    ).toBeTruthy();
    expect(
      (
        screen.getByRole("button", {
          name: "training.markComplete",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(
      (
        screen.getByRole("button", {
          name: "training.markComplete",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
  });
  it("does not show an overdue warning or resubmission for a confirmed module", () => {
    fixtures.history = [
      { module_id: "module", status: "confirmed" },
      { module_id: "module", status: "rejected" },
    ];
    mount();
    fireEvent.click(screen.getByText("Safe support"));
    expect(screen.getByText("training.completedConfirmed")).toBeTruthy();
    expect(screen.queryByText("training.overdueBanner")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("offers recovery instead of presenting a failed load as an empty catalogue", () => {
    fixtures.failed = true;
    mount();
    expect(screen.getByRole("alert").textContent).toContain(
      "Unable to load your training.",
    );
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
  it("keeps locked modules visible but hides their materials and completion controls", () => {
    fixtures.locked = true;
    mount();
    fireEvent.click(screen.getByText("Safe support"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Safe support" })).toBeTruthy();
    expect(screen.queryByLabelText("Search training modules")).toBeNull();
    expect(screen.getByText("This module is being updated")).toBeTruthy();
    expect(screen.getByText("Updating our guidelines")).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Open Worker guide in a new tab" }),
    ).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
  });
  it("keeps shared guidelines available while course materials are locked", () => {
    fixtures.locked = true;
    mount();
    fireEvent.click(screen.getByText("Resource library"));
    expect(screen.getByText("Workplace guidelines")).toBeTruthy();
    expect(screen.queryByText("Worker guide")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Open Workplace guidelines" }),
    ).toBeTruthy();
  });
});
