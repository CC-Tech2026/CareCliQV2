import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({ role: "managing_director", level: "reason", toast: vi.fn() }));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: () => ({ data: { level: state.level }, isLoading: false }),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { organizationId: "org-1", role: state.role } }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ setQueryData: vi.fn() }) }));
vi.mock("@/lib/api-fetch", () => ({
  apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({ level: "warn" }) })),
}));

import { apiFetch } from "@/lib/api-fetch";
import { AgreementCheckCard } from "./AgreementCheckCard";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.role = "managing_director";
});

it("lets the managing director switch to warn only", async () => {
  render(<AgreementCheckCard />);
  expect((screen.getByRole("radio", { name: /Reason needed/ }) as HTMLInputElement).checked).toBe(true);
  fireEvent.click(screen.getByRole("radio", { name: /Warn only/ }));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(vi.mocked(apiFetch)).toHaveBeenCalledWith(
      "/api/settings/agreement-checks",
      expect.objectContaining({ method: "PUT", body: JSON.stringify({ level: "warn" }) }),
    ),
  );
});

it("is read-only for coordinators", () => {
  state.role = "support_coordinator";
  render(<AgreementCheckCard />);
  expect((screen.getByRole("radio", { name: /Strict/ }) as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText("Only the managing director can change this.")).toBeTruthy();
});
