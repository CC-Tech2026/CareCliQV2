import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ParticipantServiceAgreementSection } from "./ParticipantServiceAgreementSection";

const state = vi.hoisted(() => ({
  data: [] as unknown[],
  isError: false,
}));
vi.mock("@/hooks/useOrgQuery", () => ({
  useOrgQuery: () => ({
    data: state.data,
    isLoading: false,
    isError: state.isError,
    refetch: vi.fn(),
  }),
}));
vi.mock("@/services/http", () => ({ jsonFetch: vi.fn() }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", organizationId: "org-1", full_name: "Maria Director" } }),
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
afterEach(() => {
  cleanup();
  state.data = [];
  state.isError = false;
});

const agreement = {
  id: "sa-1",
  status: "active",
  plan_management_type: "plan-managed",
  plan_manager_name: "Adelaide Plan Partners",
  plan_manager_email: "invoices@plan.example",
  start_date: "2026-07-01",
  end_date: "2027-06-30",
  includes_price_adjustment_clause: true,
  gst_treatment_basis: "GST-free under s38-38.",
  cancellation_notice_hours: 48,
  cancellation_fee_percentage: 100,
  signed_by: "Mia Thompson",
  signed_date: "2026-06-24",
  service_agreement_supports: [
    {
      id: "l1",
      support_item_code: "04_104_0125_6_1",
      item_name:
        "Access Community Social and Rec Activ - Standard - Weekday Daytime",
      unit: "H",
      standard_rate: 73.58,
      negotiated_rate: null,
      frequency: "weekly",
      total_hours_allocated: 260,
      total_funding: 19130.8,
      location: "other",
    },
  ],
  signed_document: {
    name: "service-agreement-Mia_Thompson.pdf",
    url: "https://files.example/mia.pdf",
    provider_signed_name: "Patience MD",
    provider_signed_at: "2026-06-24T01:00:00Z",
    family_signed_name: "Mia Thompson",
    family_signed_at: "2026-06-24T01:12:00Z",
  },
};

it("shows the signed agreement, its supports and terms", () => {
  state.data = [agreement];
  render(<ParticipantServiceAgreementSection participantId="p-1" />);
  expect(
    screen
      .getByRole("link", { name: /View signed agreement/ })
      .getAttribute("href"),
  ).toBe("https://files.example/mia.pdf");
  expect(screen.getByText(/Access Community Social/)).toBeTruthy();
  expect(screen.getByText(/5 hours a week/)).toBeTruthy();
  expect(screen.getAllByText("$19,130.80")).toHaveLength(2);
  expect(screen.getByText(/48 hours' notice/)).toBeTruthy();
  expect(screen.getByText("Adelaide Plan Partners")).toBeTruthy();
});

it("says so when no agreement exists instead of showing an empty table", () => {
  render(<ParticipantServiceAgreementSection participantId="p-1" />);
  expect(screen.getByText(/No service agreement recorded yet/)).toBeTruthy();
});

it("offers a retry when the agreement can't be loaded", () => {
  state.isError = true;
  render(<ParticipantServiceAgreementSection participantId="p-1" />);
  expect(screen.getByRole("alert").textContent).toContain(
    "could not be loaded",
  );
});

it("offers edit, email and in-person signing on a draft, and labels it plainly", () => {
  state.data = [
    {
      ...agreement,
      id: "sa-2",
      agreement_number: "SA-2026-0148",
      status: "draft",
      signed_by: null,
      signed_date: null,
      signed_document: null,
      service_agreement_supports: [
        { ...agreement.service_agreement_supports[0], unit: "E", quantity: 156, rate: 9.9, total_funding: 1544.4 },
      ],
    },
  ];
  render(<ParticipantServiceAgreementSection participantId="p-1" participantName="Liam Carter" />);
  expect(screen.getByText("Draft")).toBeTruthy();
  expect(screen.getByText(/SA-2026-0148 · Draft — not yet sent/)).toBeTruthy();
  for (const name of [/Preview/, /Edit/, /Email for signature/, /Sign in person/]) {
    expect(screen.getByRole("button", { name })).toBeTruthy();
  }
  // A per-trip item isn't described in hours.
  expect(screen.getByText("156 units")).toBeTruthy();
  expect(screen.getByText(/\$9\.90 each/)).toBeTruthy();
});

it("offers to build an agreement when there isn't one", () => {
  render(<ParticipantServiceAgreementSection participantId="p-1" />);
  expect(screen.getByRole("button", { name: /New agreement/ })).toBeTruthy();
});

it("shows who an emailed agreement is waiting on, with resend and cancel", () => {
  state.data = [
    {
      ...agreement,
      id: "sa-3",
      agreement_number: "SA-2026-0150",
      status: "pending_signature",
      sent_at: "2026-09-28T02:00:00Z",
      signed_by: null,
      signed_date: null,
      signed_document: null,
      esign: {
        signer_name: "Priya Carter",
        signer_email: "pr•••@example.com",
        relationship: "nominee",
        expires_at: "2026-10-12T02:00:00Z",
        expired: false,
        email_verified: false,
      },
    },
  ];
  render(<ParticipantServiceAgreementSection participantId="p-1" participantName="Liam Carter" />);
  expect(screen.getByText("Waiting for Priya Carter to sign")).toBeTruthy();
  expect(screen.getByText(/pr•••@example\.com · nominee · link works until 12 Oct 2026/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Resend/ })).toBeTruthy();
  expect(screen.getByRole("button", { name: /Cancel link/ })).toBeTruthy();
  // Already emailed: no second "Email for signature" button.
  expect(screen.queryByRole("button", { name: /Email for signature/ })).toBeNull();
  expect(screen.getByRole("button", { name: /Sign in person/ })).toBeTruthy();
});

it("flags an expired signing link", () => {
  state.data = [
    {
      ...agreement,
      status: "pending_signature",
      signed_document: null,
      esign: {
        signer_name: "Priya Carter",
        signer_email: "pr•••@example.com",
        relationship: "participant",
        expires_at: "2026-09-01T02:00:00Z",
        expired: true,
        email_verified: true,
      },
    },
  ];
  render(<ParticipantServiceAgreementSection participantId="p-1" />);
  expect(screen.getByText("Signing link expired")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Send new link/ })).toBeTruthy();
});
