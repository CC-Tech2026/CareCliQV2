import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DelegatedAccessSection } from "./DelegatedAccessSection";

// jsdom doesn't implement scrollIntoView, which Radix Select calls when
// opening its popover — polyfill it for this file only.
Element.prototype.scrollIntoView = vi.fn();

const fixtures = vi.hoisted(() => ({
  grants: [] as Record<string, unknown>[],
  coordinators: [] as Record<string, unknown>[],
}));

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { organizationId: "org-1" } }) }));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: (key: string[]) => {
    if (key[1] === "org") return { isLoading: false, data: fixtures.grants };
    if (key[1] === "coordinators") return { isLoading: false, data: fixtures.coordinators };
    return { isLoading: false, data: undefined };
  },
}));

const createAccessGrantMock = vi.hoisted(() => vi.fn());
const revokeAccessGrantMock = vi.hoisted(() => vi.fn());
vi.mock("@/services/accessGrantService", () => ({
  getGrantableCapabilities: vi.fn().mockResolvedValue([
    { capability: "governance_vault", label: "Governance & policy document vault (md_vault.py)" },
    { capability: "executive_dashboard", label: "Executive dashboard" },
    { capability: "staff_invitations", label: "Send a staff invitation" },
    { capability: "financial_overview", label: "Finances, wages and revenue reports" },
  ]),
  listAccessGrants: vi.fn(),
  createAccessGrant: createAccessGrantMock,
  revokeAccessGrant: revokeAccessGrantMock,
}));
vi.mock("@/services/coordinatorService", () => ({ getCoordinatorWorkerStats: vi.fn() }));

const CASEY = { id: "coord-1", full_name: "Casey Coordinator", role: "support_coordinator" };
const inAWeek = () => new Date(Date.now() + 7 * 24 * 3_600_000).toISOString();

function activeGrant(overrides: Record<string, unknown> = {}) {
  return {
    id: "grant-1",
    granted_to_user_id: "coord-1",
    granted_by_user_id: "md-1",
    capability: "governance_vault",
    granted_at: "2026-09-01T00:00:00Z",
    expires_at: inAWeek(),
    revoked_at: null,
    reason: "Covering onboarding while I'm on leave",
    status: "active",
    ...overrides,
  };
}

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <DelegatedAccessSection />
    </QueryClientProvider>,
  );
  return { ...result, queryClient, invalidateSpy: vi.spyOn(queryClient, "invalidateQueries") };
}

function next() {
  fireEvent.click(screen.getByRole("button", { name: /^Next:/ }));
}

async function startGivingToCasey() {
  fireEvent.click(screen.getByRole("button", { name: "Give temporary access" }));
  expect(screen.getByRole("heading", { name: "Who needs access?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: /Casey Coordinator/ }));
  next();
  await screen.findByRole("heading", { name: "What can Casey do?" });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fixtures.grants = [];
  fixtures.coordinators = [];
});

it("shows an empty state when no one has access", () => {
  renderSection();
  expect(screen.getByText("No one has temporary access")).toBeTruthy();
});

it("lists active access by person, in plain words, with when it ends", () => {
  fixtures.grants = [activeGrant()];
  fixtures.coordinators = [CASEY];
  renderSection();

  expect(screen.getByText("Casey Coordinator")).toBeTruthy();
  expect(screen.getByText("Documents and audit")).toBeTruthy();
  expect(screen.queryByText(/md_vault\.py/)).toBeNull();
  expect(screen.getByText(/in 7 days/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Extend" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "End now" })).toBeTruthy();
});

it("keeps expired access out of the active list and behind the past toggle", () => {
  fixtures.grants = [activeGrant({ id: "grant-2", status: "expired", expires_at: "2026-08-08T00:00:00Z" })];
  renderSection();

  expect(screen.getByText("No one has temporary access")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "End now" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show past access (1)" }));
  expect(screen.getByText(/Ran out/)).toBeTruthy();
});

it("gives several things at once, one grant each, and refreshes the org-scoped list", async () => {
  createAccessGrantMock.mockResolvedValue({ id: "grant-new", status: "active" });
  fixtures.coordinators = [CASEY];
  const { invalidateSpy } = renderSection();

  await startGivingToCasey();
  fireEvent.click(await screen.findByRole("checkbox", { name: /Finances and wages/ }));
  fireEvent.click(screen.getByRole("checkbox", { name: /Invite new staff/ }));
  next();
  fireEvent.click(screen.getByRole("radio", { name: "3 days" }));
  next();

  // Nothing is saved before the check step is confirmed.
  expect(createAccessGrantMock).not.toHaveBeenCalled();
  expect(screen.getByRole("heading", { name: "Check and confirm" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Give access to 2 things" }));

  await waitFor(() => expect(createAccessGrantMock).toHaveBeenCalledTimes(2));
  const payloads = createAccessGrantMock.mock.calls.map((c) => c[0]);
  expect(payloads.map((p) => p.capability).sort()).toEqual(["financial_overview", "staff_invitations"]);
  for (const p of payloads) {
    expect(p.granted_to_user_id).toBe("coord-1");
    const days = (new Date(p.expires_at).getTime() - Date.now()) / (24 * 3_600_000);
    expect(days).toBeGreaterThan(2.9);
    expect(days).toBeLessThan(3.1);
  }

  // useOrgQuery prepends organizationId to the query key — invalidation must
  // target that same prefixed key, or the list silently never refetches.
  await waitFor(() =>
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["org-1", "access-grants", "org"] }),
  );
});

it("doesn't offer what the coordinator already has", async () => {
  fixtures.grants = [activeGrant()];
  fixtures.coordinators = [CASEY];
  renderSection();

  await startGivingToCasey();
  const vault = (await screen.findByRole("checkbox", { name: /Documents and audit/ })) as HTMLInputElement;
  expect(vault.disabled).toBe(true);
  expect(screen.getByText(/Already has this until/)).toBeTruthy();
});

it("asks before ending access, then ends it", async () => {
  revokeAccessGrantMock.mockResolvedValue({ id: "grant-1", status: "revoked" });
  fixtures.grants = [activeGrant()];
  fixtures.coordinators = [CASEY];
  const { invalidateSpy } = renderSection();

  fireEvent.click(screen.getByRole("button", { name: "End now" }));
  expect(revokeAccessGrantMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "End access" }));

  await waitFor(() => expect(revokeAccessGrantMock).toHaveBeenCalledWith("grant-1"));
  await waitFor(() =>
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["org-1", "access-grants", "org"] }),
  );
});

it("extends by replacing the grant: new one first, then the old one ends", async () => {
  createAccessGrantMock.mockResolvedValue({ id: "grant-new", status: "active" });
  revokeAccessGrantMock.mockResolvedValue({ id: "grant-1", status: "revoked" });
  fixtures.grants = [activeGrant()];
  fixtures.coordinators = [CASEY];
  renderSection();

  fireEvent.click(screen.getByRole("button", { name: "Extend" }));
  fireEvent.click(screen.getByRole("radio", { name: "30 days" }));
  next();
  fireEvent.click(screen.getByRole("button", { name: "Extend access" }));

  await waitFor(() => expect(revokeAccessGrantMock).toHaveBeenCalledWith("grant-1"));
  expect(createAccessGrantMock).toHaveBeenCalledTimes(1);
  expect(createAccessGrantMock.mock.calls[0][0]).toMatchObject({
    granted_to_user_id: "coord-1",
    capability: "governance_vault",
  });
  expect(createAccessGrantMock.mock.invocationCallOrder[0]).toBeLessThan(
    revokeAccessGrantMock.mock.invocationCallOrder[0],
  );
});

it("keeps the old grant when the new one can't be created", async () => {
  createAccessGrantMock.mockRejectedValue(new Error("Grants can't exceed 90 days"));
  fixtures.grants = [activeGrant()];
  fixtures.coordinators = [CASEY];
  renderSection();

  fireEvent.click(screen.getByRole("button", { name: "Extend" }));
  next();
  fireEvent.click(screen.getByRole("button", { name: "Extend access" }));

  await waitFor(() => expect(createAccessGrantMock).toHaveBeenCalledTimes(1));
  expect(revokeAccessGrantMock).not.toHaveBeenCalled();
});

it("can't move on until each step is answered, and Back returns to the list", async () => {
  fixtures.coordinators = [CASEY];
  renderSection();

  fireEvent.click(screen.getByRole("button", { name: "Give temporary access" }));
  const nextButton = screen.getByRole("button", { name: /^Next:/ }) as HTMLButtonElement;
  expect(nextButton.disabled).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: /Casey Coordinator/ }));
  expect(nextButton.disabled).toBe(false);
  next();
  expect((screen.getByRole("button", { name: /^Next:/ }) as HTMLButtonElement).disabled).toBe(true);

  fireEvent.click(screen.getByRole("button", { name: "Back to Delegated Access" }));
  expect(screen.getByText("No one has temporary access")).toBeTruthy();
  expect(createAccessGrantMock).not.toHaveBeenCalled();
});
