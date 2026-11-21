import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  addLabel: vi.fn(),
  removeLabel: vi.fn(),
  toast: vi.fn(),
  data: {
    labels: [
      { id: "t-autism", label: "Autism", participants: 2, workers: 0 },
      { id: "t-hills", label: "Lives in the hills", participants: 1, workers: 1 },
    ],
    participants: { "p-1": ["t-hills"], "p-2": ["t-autism"] },
    workers: { "w-1": ["t-hills"] },
  },
}));
vi.mock("@/hooks/useOrgQuery", () => ({ useOrgQuery: () => ({ data: mocks.data, isLoading: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: vi.fn() }) }));
vi.mock("@/services/labelService", () => ({
  getLabels: vi.fn(),
  addLabel: mocks.addLabel,
  removeLabel: mocks.removeLabel,
}));

// cmdk and the popover measure themselves; jsdom has neither.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= () => {};

import { PersonLabels, useLabels } from "./labels";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("shows a person's labels and removes one", async () => {
  mocks.removeLabel.mockResolvedValue(undefined);
  render(<PersonLabels target="participants" personId="p-1" personName="Liam Carter" />);
  expect(screen.getByText("Lives in the hills")).toBeTruthy();
  expect(screen.queryByText("Autism")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Remove label Lives in the hills" }));
  await waitFor(() => expect(mocks.removeLabel).toHaveBeenCalledWith("participants", "p-1", "t-hills"));
});

it("reuses a label that already exists, whatever its case, instead of making another", async () => {
  mocks.addLabel.mockResolvedValue({ label: { id: "t-autism", label: "Autism" } });
  render(<PersonLabels target="participants" personId="p-1" personName="Liam Carter" />);
  fireEvent.click(screen.getByRole("button", { name: /Label/ }));
  fireEvent.change(screen.getByPlaceholderText("Find or make a label"), { target: { value: "autism" } });
  // No "Make" option: the existing label is the one offered.
  expect(screen.queryByText(/Make "autism"/)).toBeNull();
  fireEvent.click(screen.getByText("Autism"));
  await waitFor(() => expect(mocks.addLabel).toHaveBeenCalledWith("participants", "p-1", { tag_id: "t-autism" }));
});

it("makes a new label when none has those words", async () => {
  mocks.addLabel.mockResolvedValue({ label: { id: "t-new", label: "Female worker only" } });
  render(<PersonLabels target="workers" personId="w-1" personName="Aisha Rahman" />);
  fireEvent.click(screen.getByRole("button", { name: /Label/ }));
  expect(screen.getByText(/Staff don't see their labels/)).toBeTruthy();
  fireEvent.change(screen.getByPlaceholderText("Find or make a label"), { target: { value: "  Female   worker only " } });
  fireEvent.click(screen.getByText('Make "Female worker only"'));
  await waitFor(() => expect(mocks.addLabel).toHaveBeenCalledWith("workers", "w-1", { label: "Female worker only" }));
});

it("filters and searches people by label", () => {
  let result: ReturnType<typeof useLabels> | null = null;
  function Probe() {
    result = useLabels();
    return null;
  }
  render(<Probe />);
  expect(result!.has("participants", "p-2", "t-autism")).toBe(true);
  expect(result!.has("participants", "p-1", "t-autism")).toBe(false);
  expect(result!.has("participants", "p-1", null)).toBe(true);
  expect(result!.wordsOf("workers", "w-1")).toEqual(["Lives in the hills"]);
});
