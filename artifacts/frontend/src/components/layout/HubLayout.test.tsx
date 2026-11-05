import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { HubLayout } from "./HubLayout";

const layout = vi.hoisted(() => ({ nav_layout: "sidebar" }));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "md-1", role: "managing_director", full_name: "Morgan Lee" }, logout: vi.fn() }),
}));
vi.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({ translate: (s: string) => s, setThemeMode: vi.fn(), prefs: layout }),
}));
vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: () => Promise.resolve({ ok: false, json: async () => ({}) }) }));
vi.mock("@/services/organizationBrandingService", () => ({ getOrganizationBranding: () => Promise.resolve(null) }));
vi.mock("@/hooks/useOrgQuery", () => ({ useOrgQuery: () => ({ data: [{ status: "open" }, { status: "closed" }] }) }));
vi.mock("@/components/notifications/NotificationInbox", () => ({ NotificationBell: () => null, NotificationInbox: () => null }));
vi.mock("@/components/worker/NotificationRealtimeBridge", () => ({ NotificationRealtimeBridge: () => null }));

beforeEach(() => {
  vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => {
  cleanup();
  layout.nav_layout = "sidebar";
  vi.unstubAllGlobals();
});

function renderAt(path: string) {
  const { hook, searchHook } = memoryLocation({ path });
  return render(
    <Router hook={hook} searchHook={searchHook}>
      <HubLayout><p>Page body</p></HubLayout>
    </Router>,
  );
}

const sidebar = () => screen.getByRole("navigation", { name: "Managing Director workspaces" });

it("lists each job once, with the coordinator pages folded under it", () => {
  renderAt("/hub");
  const nav = sidebar();
  for (const gone of ["Workers", "Audit pack", "Shift note review", "Long-shift monitor", "Participant Complaints", "Feedback & Reports", "NDIS invoices"]) {
    expect(within(nav).queryByRole("link", { name: gone })).toBeNull();
  }
  for (const kept of ["Schedule & rostering", "Staff", "Shift notes", "Incidents & complaints", "Billing & claims"]) {
    expect(within(nav).getByRole("link", { name: new RegExp(kept) })).toBeTruthy();
  }
});

it("shows the sibling pages as tabs and keeps the parent entry highlighted", () => {
  renderAt("/team");
  const tabs = screen.getByRole("navigation", { name: "Staff pages" });
  expect(within(tabs).getByRole("link", { name: "Team & invites" }).getAttribute("aria-current")).toBe("page");
  expect(within(tabs).getByRole("link", { name: "Overview" }).getAttribute("href")).toBe("/md/staff");
  expect(within(sidebar()).getByRole("link", { name: "Staff" }).getAttribute("aria-current")).toBe("page");
});

it("highlights the parent entry on detail pages without showing the tabs", () => {
  renderAt("/sessions/abc");
  expect(screen.queryByRole("navigation", { name: "Shift notes pages" })).toBeNull();
  expect(within(sidebar()).getByRole("link", { name: "Shift notes" }).getAttribute("aria-current")).toBe("page");
});

it("carries the open complaints count onto the merged entry", () => {
  renderAt("/hub");
  expect(within(sidebar()).getByRole("link", { name: /Incidents & complaints/ }).textContent).toContain("1");
});

it("does not show workspace tabs on pages without siblings", () => {
  renderAt("/md/financial");
  expect(screen.queryByRole("navigation", { name: /pages$/ })).toBeNull();
});

it("keeps main navigation visible on the roster without a floating overlap", () => {
  layout.nav_layout = "topbar";
  renderAt("/coordinator/rostering");
  const mainMenu = screen.getByRole("button", { name: /^Operations & Care$/ });
  expect(mainMenu).toBeTruthy();
  const tabs = screen.getByRole("navigation", { name: "Schedule & rostering pages" });
  expect(within(tabs).getByRole("link", { name: /^Roster$/ }).getAttribute("aria-current")).toBe("page");
  expect(within(tabs).queryByRole("link", { name: "Long shifts" })).toBeNull();
  expect(mainMenu.closest(".sticky")).toBeNull();
});

it("uses the existing shift verification page as the only review destination", () => {
  renderAt("/coordinator/verification");
  const tabs = screen.getByRole("navigation", { name: "Shift notes pages" });
  expect(within(tabs).getByRole("link", { name: "Shift verification" }).getAttribute("aria-current")).toBe("page");
  expect(screen.queryByRole("link", { name: "Awaiting review" })).toBeNull();
  expect(within(sidebar()).queryByRole("link", { name: "Shift approvals" })).toBeNull();
});
