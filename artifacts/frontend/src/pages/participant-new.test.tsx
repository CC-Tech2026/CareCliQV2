import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  toast: vi.fn(),
  create: vi.fn(),
  role: "support_coordinator",
}));
vi.mock("wouter", () => ({ useLocation: () => ["/participants/new", state.navigate] }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: state.toast }) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", full_name: "Sarah Coordinator", role: state.role } }),
}));
vi.mock("@/services/participantIntakeService", () => ({ createParticipantIntake: state.create }));
vi.mock("@/contexts/AccessibilityContext", async () => {
  const { t } = await import("@/lib/i18n/translations");
  return { useAccessibility: () => ({ translate: (key: string) => t("en", key) }) };
});

import ParticipantNew from "./participant-new";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  state.role = "support_coordinator";
});

function fill() {
  fireEvent.change(screen.getByTestId("input-full-name"), { target: { value: "Ava Lee" } });
  fireEvent.change(screen.getByTestId("input-ndis-number"), { target: { value: "430123456" } });
  const dob = document.querySelector<HTMLInputElement>('input[name="date_of_birth"]')!;
  fireEvent.change(dob, { target: { value: "1998-04-02" } });
}

it("adds a new participant to onboarding, not straight in as active", async () => {
  state.create.mockResolvedValue({ id: "i-9", full_name: "Ava Lee" });
  render(<ParticipantNew />);
  expect(screen.getByText(/They become active once their service agreement/)).toBeTruthy();
  fill();
  fireEvent.click(screen.getByTestId("button-add-participant"));
  await waitFor(() => expect(state.create).toHaveBeenCalled());
  const body = state.create.mock.calls[0][0];
  expect(body).toMatchObject({ full_name: "Ava Lee", ndis_number: "430123456", source: "coordinator_referral" });
  expect(body.web_intake.date_of_birth).toBe("1998-04-02");
  // A coordinator hands it to the managing director, who runs onboarding.
  await waitFor(() =>
    expect(state.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Added to onboarding", description: expect.stringContaining("managing director"),
    })),
  );
  expect(state.navigate).toHaveBeenCalledWith("/patients");
});

it("takes the managing director straight to the new enquiry", async () => {
  state.role = "managing_director";
  state.create.mockResolvedValue({ id: "i-9", full_name: "Ava Lee" });
  render(<ParticipantNew />);
  fill();
  fireEvent.click(screen.getByTestId("button-add-participant"));
  await waitFor(() => expect(state.navigate).toHaveBeenCalledWith("/onboard-participant?intake=i-9"));
});
