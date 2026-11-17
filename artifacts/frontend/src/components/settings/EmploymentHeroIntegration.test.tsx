import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { EmploymentHeroManageRoute, EmploymentHeroTile } from "./EmploymentHeroIntegration";
import { employmentHeroTileStatus } from "./integrationStatus";
import * as eh from "@/services/employmentHeroService";
import type { EmploymentHeroStatus } from "@/services/employmentHeroService";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "md-1", organizationId: "org-1", role: "managing_director" } }),
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/services/employmentHeroService");

Element.prototype.scrollIntoView = vi.fn();

const SETTINGS = {
  auto_send: true, send_approved: true, send_from: "2026-11-17",
  sleepover_work_type_id: 44, sleepover_work_type_name: "Sleepover (SCHADS)",
};
const NOT_CONNECTED: EmploymentHeroStatus = { available: true, connected: false, redirect_uri: "e", settings: { ...SETTINGS, send_from: null, sleepover_work_type_id: null } };
const CONNECTED: EmploymentHeroStatus = {
  ...NOT_CONNECTED,
  connected: true,
  business_id: 9001,
  business_name: "Sunrise Supports Pty Ltd",
  needs_business: false,
  settings: SETTINGS,
  counts: { sent: 12, failed: 2, paid: 0 },
  attention: [
    { shift_id: "s-1", worker_id: "w-3", worker_name: "Sam Lee", status: "failed", needs_employee: true, message: "isn't matched" },
    { shift_id: "s-2", worker_id: "w-3", worker_name: "Sam Lee", status: "failed", needs_employee: true, message: "isn't matched" },
  ],
};

function renderTile(status: EmploymentHeroStatus) {
  vi.mocked(eh.getEmploymentHeroStatus).mockResolvedValue(status);
  vi.mocked(eh.getEmploymentHeroOptions).mockResolvedValue({
    work_types: [{ id: 40, name: "Ordinary hours" }, { id: 44, name: "Sleepover (SCHADS)" }],
    employees: [{ id: 503, name: "Sam Lee" }, { id: 504, name: "Sam Lee" }],
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [managing, setManaging] = useState(false);
    return managing
      ? <EmploymentHeroManageRoute status={status} onBack={() => setManaging(false)} />
      : <EmploymentHeroTile onManage={() => setManaging(true)} />;
  }
  return render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

describe("Employment Hero tile", () => {
  it("connects with a sign-in and nothing to type", async () => {
    vi.mocked(eh.startEmploymentHeroConnect).mockResolvedValue({ url: "https://api.yourpayroll.com.au/oauth/authorise?x=1" });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    renderTile(NOT_CONNECTED);
    expect(await screen.findByText(/Approved timesheets go to Employment Hero Payroll/)).toBeTruthy();
    expect(screen.queryByRole("textbox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Connect to Employment Hero/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://api.yourpayroll.com.au/oauth/authorise?x=1"));
  });

  it("stays hidden while it isn't switched on for CareCliQ", async () => {
    renderTile({ ...NOT_CONNECTED, available: false });
    await waitFor(() => expect(eh.getEmploymentHeroStatus).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(screen.queryByText("Employment Hero")).toBeNull();
  });

  it("asks which payroll business when the login sees several", async () => {
    renderTile({ ...CONNECTED, business_id: null, business_name: null, needs_business: true, attention: [],
      businesses: [{ id: 1, name: "Sunrise East" }, { id: 2, name: "Sunrise West" }] });
    expect(await screen.findByText("Choose which payroll business is yours.")).toBeTruthy();
    expect(employmentHeroTileStatus({ ...CONNECTED, needs_business: true, counts: { sent: 0, failed: 0, paid: 0 } })).toBe("attention");
    fireEvent.click(screen.getByRole("button", { name: "Manage" }));
    expect(await screen.findByText("Which payroll business is yours?")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Use this business" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("asks once who an unmatched worker is, and saves a settings change", async () => {
    vi.mocked(eh.saveEmploymentHeroSettings).mockResolvedValue(CONNECTED);
    renderTile(CONNECTED);
    fireEvent.click(await screen.findByRole("button", { name: "Manage" }));
    expect(await screen.findByRole("heading", { name: "Employment Hero" })).toBeTruthy();
    expect(screen.getByText(/Connected to/).textContent).toContain("Sunrise Supports Pty Ltd");
    // Two waiting shifts, one question.
    expect(await screen.findByText("2 approved timesheets waiting")).toBeTruthy();
    expect(screen.getAllByText("Who is Sam Lee in Employment Hero?")).toHaveLength(1);

    const save = screen.getByRole("button", { name: "Save settings" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.click(screen.getByRole("switch", { name: "Arrive approved, ready for the pay run" }));
    fireEvent.change(screen.getByLabelText("Send shifts worked from"), { target: { value: "2026-11-03" } });
    fireEvent.click(save);
    await waitFor(() =>
      expect(eh.saveEmploymentHeroSettings).toHaveBeenCalledWith({ ...SETTINGS, send_approved: false, send_from: "2026-11-03" }),
    );
  });
});
