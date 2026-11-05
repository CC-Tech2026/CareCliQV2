import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import Page from "./onboarding";
import { createProviderAccount, listProviderInvitations, resendProviderInvitation } from "@/services/adminService";
vi.mock("@/components/admin/AdminShell", () => ({ AdminShell: ({ children }: any) => children }));
vi.mock("@/services/adminService", () => ({
  createProviderAccount: vi.fn(), listProviderInvitations: vi.fn(), resendProviderInvitation: vi.fn(),
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });
it("creates a provider and shows email configuration feedback with a shareable link", async () => {
  vi.mocked(listProviderInvitations).mockResolvedValue([]);
  vi.mocked(createProviderAccount).mockResolvedValue({
    invite_url: "https://carecliq.test/accept-invite?token=secret",
    email_delivery: { status: "not_configured", message: "SMTP settings are incomplete." },
  });
  render(<Page />);
  fireEvent.change(screen.getByLabelText("Organisation name"), { target: { value: "Example Care" } });
  fireEvent.change(screen.getByLabelText("Owner's email"), { target: { value: "owner@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Create account & email setup link" }));
  await waitFor(() => expect(createProviderAccount).toHaveBeenCalledWith("Example Care", "owner@example.com"));
  expect(await screen.findByText("SMTP settings are incomplete.")).toBeTruthy();
  expect((screen.getByLabelText("Secure setup link") as HTMLInputElement).value).toContain("accept-invite?token=secret");
});
it("renews expired invitations and does not offer resend for accepted accounts", async () => {
  vi.mocked(listProviderInvitations).mockResolvedValue([
    { id: "pending", organization_id: "org-1", organization_name: "Pending Care", email: "pending@example.com", expires_at: "2020-01-01", accepted_at: null, created_at: "2019-01-01" },
    { id: "done", organization_id: "org-2", organization_name: "Ready Care", email: "ready@example.com", expires_at: "2020-01-01", accepted_at: "2020-01-01", created_at: "2019-01-01" },
  ]);
  vi.mocked(resendProviderInvitation).mockResolvedValue({ invite_url: "https://carecliq.test/setup", email_delivery: { status: "queued", message: "Queued" } });
  render(<Page />);
  fireEvent.click(await screen.findByRole("button", { name: "Renew & email link" }));
  await waitFor(() => expect(resendProviderInvitation).toHaveBeenCalledWith("pending"));
  expect(await screen.findByText("Email queued for delivery.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Resend setup email" })).toBeNull();
});
