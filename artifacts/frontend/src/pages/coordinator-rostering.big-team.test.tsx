import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Page from "./coordinator-rostering";

// A roster for a big team: 20 staff, two of them called Sam Nguyen and one
// Sam Nash, and only two rostered this week (Monday 28 Sep 2026).
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(new Date("2026-09-30T02:00:00Z"));

const calls = vi.hoisted(() => ({ urls: [] as string[] }));
const WORKERS = [
  { id: "w-sam1", full_name: "Sam Nguyen", employee_id: "1042", suburb: "Glenelg", onboarding_completed: true },
  { id: "w-sam2", full_name: "Sam Nguyen", employee_id: "2210", suburb: "Elizabeth", onboarding_completed: true },
  { id: "w-nash", full_name: "Sam Nash", employee_id: "3001", onboarding_completed: true },
  { id: "w-zoe", full_name: "Zoe Unrostered", employee_id: "4001", onboarding_completed: true },
  ...Array.from({ length: 16 }, (_, i) => ({ id: `w-${i}`, full_name: `Extra Person${i}`, onboarding_completed: true })),
];
const shift = (id: string, workerId: string, name: string) => ({
  id, worker_id: workerId, worker_name: name, participant_name: "Liam Carter", status: "scheduled",
  scheduled_start: "2026-09-28T00:30:00Z", scheduled_end: "2026-09-28T02:30:00Z", timezone: "Australia/Adelaide",
});

vi.mock("@/lib/api-fetch", () => ({
  apiFetch: vi.fn(async (url: string) => {
    const u = String(url);
    calls.urls.push(u);
    const body = u.includes("worker-stats")
      ? WORKERS
      : u.includes("/coordinator/workers/availability")
        ? { workers: {} }
        : u.includes("/coordinator/shifts?")
          ? [shift("s1", "w-sam1", "Sam Nguyen"), shift("s2", "w-nash", "Sam Nash")]
          : [];
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() };
  }),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "c1", organizationId: "org-1", role: "support_coordinator", full_name: "Coord" } }),
}));
vi.mock("@/contexts/AccessibilityContext", async () => {
  const { t, tParams } = await import("@/lib/i18n/translations");
  return {
    useAccessibility: () => ({
      translate: (key: string) => t("en", key),
      translateParams: (key: string, p: Record<string, string>) => tParams("en", key, p),
    }),
  };
});

afterEach(() => { cleanup(); calls.urls = []; localStorage.clear(); });

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><Page /></QueryClientProvider>);
}

it("starts a big team's board on who's rostered, with a switch to everyone", async () => {
  renderPage();
  const roster = await screen.findByRole("region", { name: "Roster calendar" });
  await waitFor(() => expect(roster.textContent).toContain("Sam Nash"));
  expect(roster.textContent).not.toContain("Zoe U");
  fireEvent.click(screen.getByRole("button", { name: "Everyone (20)" }));
  await waitFor(() => expect(screen.getByRole("region", { name: "Roster calendar" }).textContent).toContain("Zoe U"));
  // Remembered on this device.
  expect(localStorage.getItem("carecliq.roster.showEveryone")).toBe("1");
});

it("never shows two people under one name", async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Everyone (20)" }));
  const roster = screen.getByRole("region", { name: "Roster calendar" });
  await waitFor(() => expect(roster.textContent).toContain("ID 2210 · Elizabeth"));
  // "Sam N" would be three people, so the columns use full names...
  expect(roster.textContent).not.toMatch(/Sam N(?![a-z])/);
  // ...and the two Sam Nguyens carry their staff ID and suburb.
  expect(roster.textContent).toContain("ID 1042 · Glenelg");
});

it("finds a worker on the board by staff ID", async () => {
  renderPage();
  await screen.findByRole("region", { name: "Roster calendar" });
  fireEvent.change(screen.getByRole("searchbox", { name: /Find a worker/ }), { target: { value: "2210" } });
  const roster = screen.getByRole("region", { name: "Roster calendar" });
  await waitFor(() => expect(roster.textContent).toContain("ID 2210 · Elizabeth"));
  expect(roster.textContent).not.toContain("ID 1042");
  expect(roster.textContent).not.toContain("Sam Nash");
});

it("loads the whole team's availability in one request", async () => {
  renderPage();
  await screen.findByRole("region", { name: "Roster calendar" });
  await waitFor(() => expect(calls.urls.some((u) => u.includes("/coordinator/workers/availability"))).toBe(true));
  expect(calls.urls.filter((u) => /\/coordinator\/workers\/[^/]+\/availability/.test(u))).toHaveLength(0);
});
