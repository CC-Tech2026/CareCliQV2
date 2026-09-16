import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TrainingModuleEditor } from "./TrainingModuleEditor";
import {
  setTrainingModuleLock,
  updateTrainingModule,
  type TrainingModule,
} from "@/services/coordinatorService";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { role: "managing_director" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
// TrainingModuleEditor also accepts lock_training_module via a delegated-
// access grant — these tests are all managing_director, so useMyAccessGrants
// never fetches, but useOrgQuery still needs mocking since it's called
// unconditionally (React Query's `enabled: false` skips fetching, not the
// hook call itself).
vi.mock("@/hooks/useOrgQuery", () => ({ useOrgQuery: () => ({ data: [], isLoading: false }) }));
vi.mock("./TrainingMaterialsEditor", () => ({
  TrainingMaterialsEditor: () => <p>Materials editor</p>,
}));
vi.mock("@/services/coordinatorService", () => ({
  createTrainingModule: vi.fn(),
  updateTrainingModule: vi
    .fn()
    .mockResolvedValue({ id: "module", title: "Updated course" }),
  setTrainingModuleLock: vi.fn(),
}));
const base: TrainingModule = {
  id: "module",
  organization_id: "org",
  title: "Safe support",
  is_active: true,
  requires_certification: false,
  auto_assign_on_hire: false,
};
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function Editor({
  initial = base,
  onClose = vi.fn(),
  onSaved = vi.fn(),
}: {
  initial?: TrainingModule;
  onClose?: () => void;
  onSaved?: (module: TrainingModule) => void;
}) {
  const [module, setModule] = useState(initial);
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  return (
    <QueryClientProvider client={client}>
      <TrainingModuleEditor
        module={module}
        credentials={[{ value: "", label: "None" }]}
        onClose={onClose}
        onSaved={onSaved}
        onChanged={setModule}
      />
    </QueryClientProvider>
  );
}

describe("director module workspace", () => {
  it("locks immediately with an update notice and can unlock without editing details", async () => {
    vi.mocked(setTrainingModuleLock)
      .mockResolvedValueOnce({
        ...base,
        is_locked: true,
        lock_reason: "Updating guidelines",
      })
      .mockResolvedValueOnce({ ...base, is_locked: false });
    render(<Editor />);
    fireEvent.change(screen.getByLabelText("Update notice (optional)"), {
      target: { value: "Updating guidelines" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lock for updates" }));
    expect(await screen.findByText("Locked for maintenance")).toBeTruthy();
    expect(setTrainingModuleLock).toHaveBeenCalledWith(
      "module",
      true,
      "Updating guidelines",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Unlock & make available" }),
    );
    await waitFor(() =>
      expect(setTrainingModuleLock).toHaveBeenLastCalledWith(
        "module",
        false,
        "Updating guidelines",
      ),
    );
    expect(await screen.findByText("Available to workers")).toBeTruthy();
  });
  it("does not unlock a module when saving its details", async () => {
    const saved = vi.fn();
    render(<Editor initial={{ ...base, is_locked: true }} onSaved={saved} />);
    fireEvent.change(screen.getByLabelText("Module title"), {
      target: { value: "Updated course" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(updateTrainingModule).toHaveBeenCalled());
    expect(saved).not.toHaveBeenCalled();
    expect(updateTrainingModule).toHaveBeenCalledWith(
      "module",
      expect.objectContaining({ title: "Updated course" }),
    );
    expect(setTrainingModuleLock).not.toHaveBeenCalled();
  });
  it("protects unsaved edits when leaving the workspace", () => {
    const close = vi.fn();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<Editor onClose={close} />);
    fireEvent.change(screen.getByLabelText("Module title"), {
      target: { value: "Unsaved course" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Close" })[0]);
    expect(window.confirm).toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });
  it("uses an inline full-page workspace and persists the selected cover colour", async () => {
    render(<Editor />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Manage training module" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use #FED7AA cover colour" }));
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await waitFor(() => expect(updateTrainingModule).toHaveBeenCalledWith("module", expect.objectContaining({ cover_color: "#FED7AA", cover_path: null })));
  });
});
