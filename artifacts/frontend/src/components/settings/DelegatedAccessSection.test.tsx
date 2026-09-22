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
    { capability: "governance_vault", label: "Governance & policy document vault" },
    { capability: "executive_dashboard", label: "Executive dashboard" },
  ]),
  listAccessGrants: vi.fn(),
  createAccessGrant: createAccessGrantMock,
  revokeAccessGrant: revokeAccessGrantMock,
}));
vi.mock("@/services/coordinatorService", () => ({
  getCoordinatorWorkerStats: vi.fn().mockResolvedValue([
    { id: "coord-1", full_name: "Casey Coordinator", role: "support_coordinator" },
  ]),
}));

function renderSection() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={queryClient}>
      <DelegatedAccessSection />
    </QueryClientProvider>,
  );
  return { ...result, queryClient };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  fixtures.grants = [];
  fixtures.coordinators = [];
});

it("shows an empty state when there are no grants", () => {
  renderSection();
  expect(screen.getByText("No delegated access yet")).toBeTruthy();
});

it("lists an active grant with its coordinator, capability, and expiry", async () => {
  fixtures.grants = [
    {
      id: "grant-1",
      granted_to_user_id: "coord-1",
      granted_by_user_id: "md-1",
      capability: "governance_vault",
      granted_at: "2026-09-01T00:00:00Z",
      expires_at: "2026-09-08T00:00:00Z",
      revoked_at: null,
      reason: "Covering onboarding while I'm on leave",
      status: "active",
    },
  ];
  fixtures.coordinators = [{ id: "coord-1", full_name: "Casey Coordinator", role: "support_coordinator" }];
  renderSection();

  expect(screen.getByText("Casey Coordinator")).toBeTruthy();
  expect(await screen.findByText("Governance & policy document vault")).toBeTruthy();
  expect(screen.getByText("Active")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Revoke/ })).toBeTruthy();
});

it("does not offer a revoke button for an already-expired grant", () => {
  fixtures.grants = [
    {
      id: "grant-2",
      granted_to_user_id: "coord-1",
      capability: "governance_vault",
      granted_at: "2026-08-01T00:00:00Z",
      expires_at: "2026-08-08T00:00:00Z",
      revoked_at: null,
      reason: null,
      status: "expired",
    },
  ];
  renderSection();
  expect(screen.getByText("Expired")).toBeTruthy();
  expect(screen.queryByRole("button", { name: /Revoke/ })).toBeNull();
});

it("creates a grant with the selected coordinator, capability, and expiry", async () => {
  createAccessGrantMock.mockResolvedValue({
    id: "grant-new",
    granted_to_user_id: "coord-1",
    capability: "governance_vault",
    status: "active",
  });
  fixtures.coordinators = [{ id: "coord-1", full_name: "Casey Coordinator", role: "support_coordinator" }];
  const { queryClient } = renderSection();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  fireEvent.click(screen.getByRole("button", { name: /Grant access/ }));

  fireEvent.click(screen.getByText("Choose a coordinator"));
  fireEvent.click(await screen.findByText("Casey Coordinator"));

  fireEvent.click(screen.getByText("Choose one capability"));
  fireEvent.click(await screen.findByText("Governance & policy document vault"));

  fireEvent.click(screen.getByText("7 days"));

  fireEvent.click(screen.getByRole("button", { name: /^Grant access$/ }));

  await waitFor(() => expect(createAccessGrantMock).toHaveBeenCalledTimes(1));
  const payload = createAccessGrantMock.mock.calls[0][0];
  expect(payload.granted_to_user_id).toBe("coord-1");
  expect(payload.capability).toBe("governance_vault");
  expect(typeof payload.expires_at).toBe("string");

  // useOrgQuery prepends organizationId to the query key — invalidation must
  // target that same prefixed key, or the grant list silently never
  // refetches after a successful create (the exact bug this asserts against).
  await waitFor(() =>
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["org-1", "access-grants", "org"] }),
  );
});

it("revokes an active grant and invalidates the org-scoped grants query", async () => {
  revokeAccessGrantMock.mockResolvedValue({ id: "grant-1", status: "revoked" });
  fixtures.grants = [
    {
      id: "grant-1",
      granted_to_user_id: "coord-1",
      capability: "governance_vault",
      granted_at: "2026-09-01T00:00:00Z",
      expires_at: "2026-09-08T00:00:00Z",
      revoked_at: null,
      reason: null,
      status: "active",
    },
  ];
  fixtures.coordinators = [{ id: "coord-1", full_name: "Casey Coordinator", role: "support_coordinator" }];
  const { queryClient } = renderSection();
  const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

  fireEvent.click(screen.getByRole("button", { name: /Revoke/ }));

  await waitFor(() => expect(revokeAccessGrantMock).toHaveBeenCalledWith("grant-1"));
  await waitFor(() =>
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["org-1", "access-grants", "org"] }),
  );
});
