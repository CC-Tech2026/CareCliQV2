import { afterEach, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { TrainingMaterialsEditor } from "./TrainingMaterialsEditor";
import { saveTrainingResource } from "@/services/coordinatorService";
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { organizationId: "org" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/services/coordinatorService", () => ({
  saveTrainingResource: vi.fn(),
  deleteTrainingResource: vi.fn(),
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
const resources = [
  {
    id: "one",
    title: "Worker guide",
    resource_type: "pdf" as const,
    external_url: "https://example.org/guide.pdf",
  },
];
it("protects a draft when another material is selected", () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(
    <TrainingMaterialsEditor
      moduleId="module"
      initialResources={resources}
      onChange={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Material title"), {
    target: { value: "Unsaved draft" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Edit Worker guide" }));
  expect(window.confirm).toHaveBeenCalled();
  expect(
    (screen.getByLabelText("Material title") as HTMLInputElement).value,
  ).toBe("Unsaved draft");
});
it("focuses the edit field without treating unchanged material as unsaved", () => {
  const dirty = vi.fn();
  render(
    <TrainingMaterialsEditor
      moduleId="module"
      initialResources={resources}
      onChange={vi.fn()}
      onDirtyChange={dirty}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Edit Worker guide" }));
  expect(document.activeElement).toBe(screen.getByLabelText("Material title"));
  expect(dirty).toHaveBeenLastCalledWith(false);
});
it("keeps a failed save visible beside the retained draft", async () => {
  vi.mocked(saveTrainingResource).mockRejectedValueOnce(
    new Error("Connection lost"),
  );
  render(
    <TrainingMaterialsEditor
      moduleId="module"
      initialResources={[]}
      onChange={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("Material title"), {
    target: { value: "Guide" },
  });
  fireEvent.change(screen.getByLabelText("Material URL"), {
    target: { value: " https://example.org/guide " },
  });
  fireEvent.click(screen.getByRole("button", { name: "Add material" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toContain("Connection lost"),
  );
  expect(
    (screen.getByLabelText("Material title") as HTMLInputElement).value,
  ).toBe("Guide");
  expect(saveTrainingResource).toHaveBeenCalledWith(
    "module",
    expect.objectContaining({ external_url: "https://example.org/guide" }),
    undefined,
  );
});
