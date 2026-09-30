import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { OrganisationDetailsCard, abnIsValid, formatAbn } from "./OrganisationDetailsCard";

const state = vi.hoisted(() => ({ role: "managing_director", api: vi.fn() }));
vi.mock("@/lib/api-fetch", () => ({ apiFetch: state.api }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u", organizationId: "org-1", role: state.role } }),
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const details = {
  name: "Sunrise", legal_name: "Sunrise Support Services Pty Ltd", abn: null,
  ndis_registration_number: null, address: null, phone: null, email: null,
};

function renderCard(profileAbn?: string) {
  state.api.mockResolvedValue({ ok: true, json: async () => details });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><OrganisationDetailsCard profileAbn={profileAbn} /></QueryClientProvider>);
}

it("validates and formats ABNs like the ATO does", () => {
  expect(abnIsValid("51 824 753 556")).toBe(true);
  expect(abnIsValid("51 824 753 557")).toBe(false);
  expect(formatAbn("51824753556")).toBe("51 824 753 556");
});

it("shows what's missing for claims and offers the ABN saved on the profile", async () => {
  state.role = "managing_director";
  renderCard("51824753556");
  expect(await screen.findByText(/add your NDIS registration number/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Use it" }));
  expect((screen.getByLabelText("ABN") as HTMLInputElement).value).toBe("51 824 753 556");
  expect(screen.getByRole("button", { name: "Save details" })).toBeTruthy();
});

it("won't save an ABN that fails the checksum", async () => {
  state.role = "managing_director";
  renderCard();
  fireEvent.change(await screen.findByLabelText("ABN"), { target: { value: "51824753557" } });
  expect(screen.getByText(/doesn't pass the ATO check/)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Save details" }) as HTMLButtonElement).disabled).toBe(true);
});

it("is read-only for coordinators", async () => {
  state.role = "support_coordinator";
  renderCard();
  expect(((await screen.findByLabelText("ABN")) as HTMLInputElement).readOnly).toBe(true);
  expect(screen.getByText(/Only the managing director/)).toBeTruthy();
});
