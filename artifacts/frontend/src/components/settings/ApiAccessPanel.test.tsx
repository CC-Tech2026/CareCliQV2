import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiAccessPage } from "./ApiAccessPanel";
import * as integrations from "@/services/integrationsService";
import type { ApiOverview } from "@/services/integrationsService";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "md-1", organizationId: "org-1", role: "managing_director" } }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/services/integrationsService");

const OVERVIEW: ApiOverview = {
  keys: [
    { id: "k-1", name: "CORA Workforce", prefix: "cc_live_ab12cd34", scopes: ["workers:read", "credentials:read"], created_at: "2026-11-16T01:00:00Z", last_used_at: null },
  ],
  webhooks: [],
  scopes: [
    { id: "credentials:read", description: "Workers' credentials." },
    { id: "training:read", description: "Training." },
    { id: "workers:read", description: "Workers." },
  ],
  events: [
    { id: "credential.updated", description: "A credential changes." },
    { id: "worker.created", description: "A worker joins." },
  ],
};

function renderPanel(overview = OVERVIEW) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ApiAccessPage onBack={() => {}} overview={overview} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("API and webhooks page", () => {
  it("lists keys without their secret, and shows a new key once", async () => {
    vi.mocked(integrations.createApiKey).mockResolvedValue({
      ...OVERVIEW.keys[0], id: "k-2", name: "Payroll", key: "cc_live_fullsecretvalue123",
    });
    renderPanel();
    expect(screen.getByText("CORA Workforce")).toBeTruthy();
    expect(screen.getByText(/Reads Workers, Credentials/)).toBeTruthy();
    expect(screen.getByText(/Not used yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /New key/ }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Payroll" } });
    fireEvent.click(screen.getByRole("button", { name: "Create key" }));
    await waitFor(() =>
      expect(integrations.createApiKey).toHaveBeenCalledWith("Payroll", ["credentials:read", "training:read", "workers:read"]),
    );
    expect(await screen.findByText("cc_live_fullsecretvalue123")).toBeTruthy();
    expect(screen.getByText(/won't be able to see it again/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "I've saved it" }));
    expect(screen.queryByText("cc_live_fullsecretvalue123")).toBeNull();
  }, 15_000);

  it("adds a webhook for the chosen changes and shows its signing secret once", async () => {
    vi.mocked(integrations.createWebhook).mockResolvedValue({
      id: "h-1", url: "https://cora.example.com/hooks", events: ["credential.updated"], active: true,
      created_at: "2026-11-16T01:00:00Z", failure_count: 0, secret: "whsec_signingsecret",
    });
    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: /Add webhook/ }));
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "https://cora.example.com/hooks" } });
    const changes = screen.getByRole("group", { name: "Send these changes" });
    fireEvent.click(within(changes).getAllByRole("checkbox")[1]); // untick "Worker added"
    fireEvent.click(screen.getAllByRole("button", { name: "Add webhook" }).at(-1)!);
    await waitFor(() =>
      expect(integrations.createWebhook).toHaveBeenCalledWith("https://cora.example.com/hooks", ["credential.updated"], undefined),
    );
    expect(await screen.findByText("whsec_signingsecret")).toBeTruthy();
  }, 15_000);

  it("gives the other system's developers the address and how to sign in", () => {
    renderPanel();
    expect(screen.getByText(/\/api\/v1\/workers/)).toBeTruthy();
    expect(screen.getByText("GET /credentials")).toBeTruthy();
    expect(screen.getAllByText(/CareCliQ-Signature/).length).toBeGreaterThan(0);
  });
});
