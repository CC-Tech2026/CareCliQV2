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

const BY_PERSON = { name: "Roster by person" };
const BY_HOUR = { name: "Roster calendar" };

it("lays a big team's week out by person, on who's rostered, with a switch to everyone", async () => {
  renderPage();
  const roster = await screen.findByRole("region", BY_PERSON);
  expect(screen.getByRole("button", { name: "By person" }).getAttribute("aria-pressed")).toBe("true");
  await waitFor(() => expect(roster.textContent).toContain("Sam Nash"));
  expect(roster.textContent).not.toContain("Zoe Unrostered");
  fireEvent.click(screen.getByRole("button", { name: "Everyone (20)" }));
  await waitFor(() => expect(screen.getByRole("region", BY_PERSON).textContent).toContain("Zoe Unrostered"));
  // Remembered on this device.
  expect(localStorage.getItem("carecliq.roster.showEveryone")).toBe("1");
  // A whole board of 20 people renders twice: more than the default 5s when the full suite runs at once.
}, 15_000);

it("never shows two people under one name, by person or by hour", async () => {
  renderPage();
  fireEvent.click(await screen.findByRole("button", { name: "Everyone (20)" }));
  const rows = screen.getByRole("region", BY_PERSON);
  // The two Sam Nguyens carry their staff ID and suburb; Sam Nash needs neither.
  await waitFor(() => expect(rows.textContent).toContain("ID 2210 · Elizabeth"));
  expect(rows.textContent).toContain("ID 1042 · Glenelg");
  expect(rows.textContent).not.toContain("ID 3001");

  fireEvent.click(screen.getByRole("button", { name: "By hour" }));
  const columns = await screen.findByRole("region", BY_HOUR);
  await waitFor(() => expect(columns.textContent).toContain("ID 2210 · Elizabeth"));
  // Full names over the columns: "Sam N" would be three people.
  expect(columns.textContent).not.toMatch(/Sam N(?![a-z])/);
  expect(localStorage.getItem("carecliq.roster.layout")).toBe("calendar");
}, 15_000);

it("finds a worker on the board by staff ID", async () => {
  renderPage();
  await screen.findByRole("region", BY_PERSON);
  fireEvent.change(screen.getByRole("searchbox", { name: /Find a worker/ }), { target: { value: "2210" } });
  const roster = screen.getByRole("region", BY_PERSON);
  await waitFor(() => expect(roster.textContent).toContain("ID 2210 · Elizabeth"));
  expect(roster.textContent).not.toContain("ID 1042");
  expect(roster.textContent).not.toContain("Sam Nash");
});

it("keeps the layout someone chose, whatever the team's size", async () => {
  localStorage.setItem("carecliq.roster.layout", "calendar");
  renderPage();
  expect(await screen.findByRole("region", BY_HOUR)).toBeTruthy();
  expect(screen.queryByRole("region", BY_PERSON)).toBeNull();
});

it("loads the whole team's availability in one request", async () => {
  renderPage();
  await screen.findByRole("region", BY_PERSON);
  await waitFor(() => expect(calls.urls.some((u) => u.includes("/coordinator/workers/availability"))).toBe(true));
  expect(calls.urls.filter((u) => /\/coordinator\/workers\/[^/]+\/availability/.test(u))).toHaveLength(0);
});
