import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { XeroPayrollSection } from "./XeroPayrollSection";
import * as xp from "@/services/xeroPayrollService";
import type { XeroPayrollStatus } from "@/services/xeroPayrollService";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "md-1", organizationId: "org-1", role: "managing_director" } }),
}));
const toast = vi.fn();
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
vi.mock("@/services/xeroPayrollService");

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

const NONE = { weekday: null, saturday: null, sunday: null, public_holiday: null, sleepover: null, travel_km: null };
const STATUS: XeroPayrollStatus = {
  connected: true, has_access: true, enabled: false, breaks_unpaid: false, linked: 0, employment_hero_connected: false,
  rates: { ...NONE }, rate_names: { ...NONE },
};

function renderSection() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <XeroPayrollSection />
    </QueryClientProvider>,
  );
}

describe("Xero page > Payroll", () => {
  it("asks for payroll access first, by signing in to Xero again", async () => {
    vi.mocked(xp.getXeroPayroll).mockResolvedValue({ ...STATUS, has_access: false });
    vi.mocked(xp.startXeroPayrollConnect).mockResolvedValue({ url: "https://login.xero.com/identity/connect/authorize?scope=payroll" });
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    renderSection();
    fireEvent.click(await screen.findByRole("button", { name: /Allow payroll access in Xero/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://login.xero.com/identity/connect/authorize?scope=payroll"));
    expect(xp.getXeroPayrollOptions).not.toHaveBeenCalled();
  });

  it("fills in pay items found by name, shows who isn't matched, and turns it on", async () => {
    vi.mocked(xp.getXeroPayroll).mockResolvedValue(STATUS);
    vi.mocked(xp.getXeroPayrollOptions).mockResolvedValue({
      earnings_rates: [
        { id: "r-ord", name: "Ordinary Hours" }, { id: "r-sat", name: "Saturday" }, { id: "r-sun", name: "Sunday" },
        { id: "r-ph", name: "Public Holiday" }, { id: "r-sleep", name: "Sleepover Allowance" },
      ],
      suggested: { weekday: "r-ord", saturday: "r-sat", sunday: "r-sun", public_holiday: "r-ph", sleepover: "r-sleep" },
      employees: [{ id: "e-1", name: "Aisha Rahman" }, { id: "e-2", name: "Sam Lee" }],
      workers: [
        { worker_id: "w-1", name: "Aisha Rahman", email: "a@x.com", employee_id: "e-1", employee_name: "Aisha Rahman", matched_by: "email" },
        { worker_id: "w-3", name: "Sam Lee", email: "s@x.com", employee_id: null, employee_name: null, matched_by: null },
      ],
    });
    vi.mocked(xp.saveXeroPayroll).mockResolvedValue({ ...STATUS, enabled: true });
    vi.mocked(xp.linkXeroEmployee).mockResolvedValue(STATUS);
    renderSection();
    expect(await screen.findByText(/1 of 2 couldn't be matched by email or name/)).toBeTruthy();
    expect(screen.getByText("Aisha Rahman in Xero · matched by email")).toBeTruthy();
    fireEvent.click(screen.getByRole("switch", { name: "Send hours to Xero Payroll" }));
    fireEvent.click(screen.getByRole("button", { name: /Save payroll settings/ }));
    await waitFor(() => expect(xp.saveXeroPayroll).toHaveBeenCalled());
    const saved = vi.mocked(xp.saveXeroPayroll).mock.calls[0][0];
    // Weekend and holiday items come from the names; weekday stays each person's own.
    expect(saved).toMatchObject({
      enabled: true,
      rates: { weekday: null, saturday: "r-sat", sunday: "r-sun", public_holiday: "r-ph", sleepover: "r-sleep" },
      rate_names: { saturday: "Saturday", sleepover: "Sleepover Allowance" },
      breaks_unpaid: false,
    });
  });

  it("says Employment Hero takes the hours when it's connected", async () => {
    vi.mocked(xp.getXeroPayroll).mockResolvedValue({ ...STATUS, employment_hero_connected: true });
    renderSection();
    expect(await screen.findByText(/Employment Hero is connected, so hours go there/)).toBeTruthy();
  });

  it("shows nothing when Xero isn't connected", async () => {
    vi.mocked(xp.getXeroPayroll).mockResolvedValue({ ...STATUS, connected: false, has_access: false });
    const { container } = renderSection();
    await waitFor(() => expect(xp.getXeroPayroll).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });
});
