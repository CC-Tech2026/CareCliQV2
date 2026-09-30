import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import AgreementSignPage from "./agreement-sign";

const api = vi.hoisted(() => ({
  getAgreementForSigning: vi.fn(),
  sendAgreementSigningCode: vi.fn(),
  verifyAgreementSigningCode: vi.fn(),
  signAgreementByLink: vi.fn(),
  openSigningDocument: vi.fn(),
}));
vi.mock("@/services/serviceAgreementService", () => api);
vi.mock("@/components/CareCliQLogoSVG", () => ({ CareCliQLogo: () => null }));
vi.mock("@/components/shifts/SignatureCanvas", () => ({
  SignatureCanvas: ({ onChange }: { onChange: (p: { svg: string; pngDataUrl: string; hasStroke: boolean }) => void }) => (
    <button type="button" onClick={() => onChange({ svg: "", pngDataUrl: "data:image/png;base64,x", hasStroke: true })}>
      draw signature
    </button>
  ),
  useSignatureCanvasState: () => {
    // Minimal stand-in that tracks whether a stroke was drawn.
    const [state, setState] = useState({ signaturePng: "", hasStroke: false });
    return {
      ...state,
      signatureSvg: "",
      onCanvasChange: (p: { pngDataUrl: string; hasStroke: boolean }) => setState({ signaturePng: p.pngDataUrl, hasStroke: p.hasStroke }),
    };
  },
}));

const base = {
  organization_name: "Sunrise Support",
  logo_url: null,
  participant_first_name: "Liam",
  signer_name: "Priya Carter",
  relationship: "nominee",
  email_hint: "pr•••@example.com",
  status: "awaiting_signature",
  email_verified: false,
  provider_signed_name: "Maria Director",
  provider_signed_at: "2026-09-28T02:00:00Z",
  participant_signed_name: null,
  participant_signed_at: null,
  agreement: null,
};

const summary = {
  agreement_number: "SA-2026-0150",
  period: "1 Oct 2026 to 30 Sep 2027",
  plan_management: "Plan-managed",
  plan_manager: "Clearview",
  supports: [{ name: "Assistance with self-care", detail: "Weekly · at home", quantity: "312 hrs", rate: "$70.23", total: "$21,911.76" }],
  total: "$21,911.76",
  price_changes: "Rates follow NDIS Pricing Arrangements updates after written notice.",
  cancellations: "At least 48 hours' notice.",
  gst: null,
};

function renderPage(token = "tok-1") {
  window.history.pushState({}, "", `/agreement-sign?token=${token}`);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AgreementSignPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  api.sendAgreementSigningCode.mockResolvedValue({ ok: true, message: "We've sent a 6-digit code to pr•••@example.com." });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("asks for the emailed code before showing anything from the agreement", async () => {
  api.getAgreementForSigning.mockResolvedValue(base);
  renderPage();
  expect(await screen.findByText(/Hi Priya, confirm it's you/)).toBeTruthy();
  expect(screen.getByText("pr•••@example.com")).toBeTruthy();
  await waitFor(() => expect(api.sendAgreementSigningCode).toHaveBeenCalledTimes(1));
  expect(screen.queryByText(/Supports and prices/)).toBeNull();
  // Liam's agreement, being signed by his nominee.
  expect(screen.getByText(/Liam's NDIS service agreement/)).toBeTruthy();
});

it("shows the summary and signs once name, signature and consent are given", async () => {
  api.getAgreementForSigning.mockResolvedValue({ ...base, email_verified: true, agreement: summary });
  api.signAgreementByLink.mockResolvedValue({ ok: true, document_sha256: "f" });
  renderPage();
  expect(await screen.findByText("Supports and prices")).toBeTruthy();
  expect(screen.getAllByText("$21,911.76")).toHaveLength(2);
  expect(screen.getByText(/Signed by Maria Director for Sunrise Support/)).toBeTruthy();
  expect(api.sendAgreementSigningCode).not.toHaveBeenCalled();

  const sign = screen.getByRole("button", { name: "Sign agreement" }) as HTMLButtonElement;
  expect((screen.getByLabelText("Your full name") as HTMLInputElement).value).toBe("Priya Carter");
  expect(sign.disabled).toBe(true);
  fireEvent.click(screen.getByText("draw signature"));
  expect(sign.disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  expect(screen.getByText(/on Liam's behalf/)).toBeTruthy();
  expect(sign.disabled).toBe(false);
  fireEvent.click(sign);
  await waitFor(() =>
    expect(api.signAgreementByLink).toHaveBeenCalledWith("tok-1", {
      full_name: "Priya Carter",
      signature_png: "data:image/png;base64,x",
      understood: true,
    }),
  );
});

it("explains an expired or replaced link", async () => {
  api.getAgreementForSigning.mockRejectedValue(Object.assign(new Error("gone"), { status: 410 }));
  renderPage();
  expect(await screen.findByText("This link has expired")).toBeTruthy();
  cleanup();

  api.getAgreementForSigning.mockRejectedValue(Object.assign(new Error("nope"), { status: 404 }));
  renderPage();
  expect(await screen.findByText("This link doesn't work any more")).toBeTruthy();
  cleanup();

  api.getAgreementForSigning.mockRejectedValue(Object.assign(new Error("boom"), { status: 500 }));
  renderPage();
  expect(await screen.findByText("Something went wrong on our side")).toBeTruthy();
});

it("shows the receipt once signed", async () => {
  api.getAgreementForSigning.mockResolvedValue({
    ...base,
    status: "signed",
    participant_signed_name: "Priya Carter",
    participant_signed_at: "2026-09-29T02:00:00Z",
    agreement: summary,
  });
  renderPage();
  expect(await screen.findByText("Signed — thank you")).toBeTruthy();
  expect(screen.getByText(/Priya Carter signed on 29 September 2026/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Download signed agreement/ })).toBeTruthy();
});
