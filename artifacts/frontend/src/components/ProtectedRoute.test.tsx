import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ProtectedRoute } from "./ProtectedRoute";

const auth = vi.hoisted(() => ({
  isAuthenticated: true,
  user: { role: "support_coordinator", email_verified: true } as Record<string, unknown>,
}));
const grantsFixture = vi.hoisted(() => ({ grants: [] as Record<string, unknown>[], isLoading: false }));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({ translate: (key: string) => key, translateParams: (key: string) => key }),
}));
vi.mock("@/hooks/useMyAccessGrants", () => ({
  useMyAccessGrants: () => ({
    isLoading: grantsFixture.isLoading,
    grants: grantsFixture.grants,
    hasCapability: (cap: string) => grantsFixture.grants.some((g) => g.capability === cap),
    grantFor: (cap: string) => grantsFixture.grants.find((g) => g.capability === cap),
  }),
}));

afterEach(() => {
  cleanup();
  auth.isAuthenticated = true;
  auth.user = { role: "support_coordinator", email_verified: true };
  grantsFixture.grants = [];
  grantsFixture.isLoading = false;
});

it("renders children for a role that satisfies allowedRoles, ignoring capabilities entirely", () => {
  auth.user = { role: "managing_director", email_verified: true };
  render(
    <ProtectedRoute allowedRoles={["managing_director"]} requiredCapability="governance_vault" capabilityLabel="Vault">
      <p>Vault content</p>
    </ProtectedRoute>,
  );
  expect(screen.getByText("Vault content")).toBeTruthy();
  expect(screen.queryByText(/Temporary access/)).toBeNull();
});

it("shows the restricted-access page for a coordinator with no grant at all", () => {
  render(
    <ProtectedRoute allowedRoles={["managing_director"]} requiredCapability="governance_vault" capabilityLabel="Vault">
      <p>Vault content</p>
    </ProtectedRoute>,
  );
  expect(screen.queryByText("Vault content")).toBeNull();
  expect(screen.getByText("protected.title")).toBeTruthy();
});

it("renders children plus a temporary-access banner for a coordinator holding the exact required grant", () => {
  grantsFixture.grants = [{
    id: "grant-1",
    capability: "governance_vault",
    expires_at: "2026-10-01T00:00:00Z",
    revoked_at: null,
  }];
  render(
    <ProtectedRoute allowedRoles={["managing_director"]} requiredCapability="governance_vault" capabilityLabel="Governance vault">
      <p>Vault content</p>
    </ProtectedRoute>,
  );
  expect(screen.getByText("Vault content")).toBeTruthy();
  expect(screen.getByText(/Temporary access: Governance vault/)).toBeTruthy();
});

it("still shows the restricted-access page when the coordinator's grant is for a different capability", () => {
  grantsFixture.grants = [{
    id: "grant-1",
    capability: "executive_dashboard",
    expires_at: "2026-10-01T00:00:00Z",
    revoked_at: null,
  }];
  render(
    <ProtectedRoute allowedRoles={["managing_director"]} requiredCapability="governance_vault" capabilityLabel="Vault">
      <p>Vault content</p>
    </ProtectedRoute>,
  );
  expect(screen.queryByText("Vault content")).toBeNull();
  expect(screen.getByText("protected.title")).toBeTruthy();
});

it("renders nothing (not the restricted page) while the grants query is still loading", () => {
  grantsFixture.isLoading = true;
  const { container } = render(
    <ProtectedRoute allowedRoles={["managing_director"]} requiredCapability="governance_vault" capabilityLabel="Vault">
      <p>Vault content</p>
    </ProtectedRoute>,
  );
  expect(container.textContent).toBe("");
});

it("shows the restricted-access page as before when no requiredCapability is passed at all", () => {
  render(
    <ProtectedRoute allowedRoles={["managing_director"]}>
      <p>MD-only content</p>
    </ProtectedRoute>,
  );
  expect(screen.queryByText("MD-only content")).toBeNull();
  expect(screen.getByText("protected.title")).toBeTruthy();
});
