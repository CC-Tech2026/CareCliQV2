import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OrgMembersPanel } from "./OrgMembersPanel";
import { jsonFetch } from "@/services/http";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "me", role: "managing_director", organizationId: "org-1" } }),
}));
vi.mock("@/services/http", () => ({ jsonFetch: vi.fn() }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: vi.fn() }));
vi.mock("@/hooks/useBranches", () => ({
  useBranches: () => ({ branches: [], byId: new Map(), multiBranch: false }),
  useInvalidateBranches: () => vi.fn(),
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
let reauthCancelled = false;
vi.mock("@/hooks/useReAuth", () => ({
  useReAuth: () => ({
    requireReAuth: async (action: () => Promise<unknown>) => (reauthCancelled ? undefined : action()),
    modal: null,
  }),
}));

const fetchMock = vi.mocked(jsonFetch);
const MEMBERS = [
  { id: "m-me", user_id: "me", role: "managing_director", joined_at: "2026-01-01", full_name: "Morgan Hayes", email: "morgan@example.com" },
  { id: "m-1", user_id: "u-1", role: "support_coordinator", joined_at: "2026-02-01", full_name: "Casey Lee", email: "casey@example.com" },
];

function renderPanel() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <OrgMembersPanel open onOpenChange={() => {}} />
    </QueryClientProvider>,
  );
}

describe("OrgMembersPanel", () => {
  afterEach(cleanup);
  beforeEach(() => {
    vi.clearAllMocks();
    reauthCancelled = false;
    fetchMock.mockImplementation(async (url) => (String(url) === "/api/invitations/members" ? MEMBERS : {}) as never);
  });

  it("lists everyone, with your own role fixed", async () => {
    renderPanel();
    expect(await screen.findByText("Casey Lee")).toBeTruthy();
    expect(screen.getByText("(you)")).toBeTruthy();
    expect(screen.queryByLabelText("Role for Morgan Hayes")).toBeNull();
    expect(screen.queryByLabelText("Remove Morgan Hayes")).toBeNull();
    expect((screen.getByLabelText("Role for Casey Lee") as HTMLSelectElement).value).toBe("support_coordinator");
  });

  it("changes someone's role", async () => {
    renderPanel();
    fireEvent.change(await screen.findByLabelText("Role for Casey Lee"), { target: { value: "support_worker" } });
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/invitations/members/m-1/role", {
        method: "PATCH",
        body: JSON.stringify({ role: "support_worker" }),
      }),
    );
    await waitFor(() => expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Role updated" })));
  });

  it("doesn't claim a change when the password check is cancelled", async () => {
    reauthCancelled = true;
    renderPanel();
    fireEvent.change(await screen.findByLabelText("Role for Casey Lee"), { target: { value: "support_worker" } });
    await waitFor(() => expect(toast).toHaveBeenCalledWith({ title: "The role wasn't changed" }));
    expect(fetchMock).not.toHaveBeenCalledWith("/api/invitations/members/m-1/role", expect.anything());
  });

  it("asks before removing someone", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValueOnce(false).mockReturnValueOnce(true);
    renderPanel();
    const remove = await screen.findByLabelText("Remove Casey Lee");
    fireEvent.click(remove);
    expect(fetchMock).not.toHaveBeenCalledWith("/api/invitations/members/m-1", expect.anything());

    fireEvent.click(remove);
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/invitations/members/m-1", { method: "DELETE" }),
    );
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mockRestore();
  });
});
