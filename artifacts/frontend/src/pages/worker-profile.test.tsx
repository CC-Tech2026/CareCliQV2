import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import WorkerProfile from "./worker-profile";

const auth = vi.hoisted(() => ({ role: "support_worker" }));
const updateMeMock = vi.hoisted(() => vi.fn());
const getMeMock = vi.hoisted(() =>
  vi.fn(async () => ({
    id: "worker-1",
    email: "worker@example.test",
    full_name: "Wanda Worker",
    role: "support_worker",
    phone: "0400000000",
    profile_summary: "Experienced in community access support.",
    profile_experience_years: 5,
  })),
);

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: auth, updateUser: vi.fn() }),
}));
vi.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({
    translate: (key: string) => key,
    translateParams: (key: string) => key,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useReAuth", () => ({
  useReAuth: () => ({ requireReAuth: (fn: () => unknown) => fn(), modal: null }),
}));
vi.mock("@/lib/device-id", () => ({ getDeviceId: () => "device-1" }));
vi.mock("@/lib/desktop-notifications", () => ({
  getDesktopNotificationPermission: () => "default",
  getDesktopNotificationSupport: () => false,
  isDesktopNotificationsEnabled: () => false,
  requestDesktopNotificationPermission: vi.fn(),
  setDesktopNotificationsEnabled: vi.fn(),
}));
vi.mock("@/components/ProfilePhotoUpload", () => ({ ProfilePhotoUpload: () => null }));
vi.mock("@/components/onboarding/MyInterestsCard", () => ({ MyInterestsCard: () => null }));
const EVENTS = ["shift_reminder", "shift_change", "coordinator_message", "feedback_received", "certification_expiry"];
const CHANNELS = ["push", "email", "sms"];
const emptyPreferences = Object.fromEntries(
  EVENTS.map((event) => [event, Object.fromEntries(CHANNELS.map((channel) => [channel, false]))]),
);

vi.mock("@/services/userService", () => ({
  getMe: getMeMock,
  updateMe: updateMeMock,
  updateContact: vi.fn(),
  changePassword: vi.fn(),
  requestPasswordReset: vi.fn(),
  getNotificationPreferences: vi.fn(async () => ({ preferences: emptyPreferences })),
  saveNotificationPreferences: vi.fn(),
}));

describe("WorkerProfile professional summary", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("shows the resume-derived summary and experience years", async () => {
    render(<WorkerProfile />);
    await waitFor(() => screen.getByText("Experienced in community access support."));
    screen.getByText("5");
  });

  it("saves an edited summary and experience years via updateMe", async () => {
    updateMeMock.mockResolvedValue({
      id: "worker-1",
      email: "worker@example.test",
      role: "support_worker",
      profile_summary: "Updated summary",
      profile_experience_years: 7,
    });

    render(<WorkerProfile />);
    await waitFor(() => screen.getByText("Experienced in community access support."));

    // Index 0 is the main "Edit profile" contact-section toggle; index 1 is
    // this new Professional Summary section's own edit button.
    fireEvent.click(screen.getAllByText("profile.edit")[1]);
    const textarea = screen.getByLabelText("profile.professionalSummary") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "Updated summary" } });
    const yearsInput = screen.getByLabelText("profile.experienceYears") as HTMLInputElement;
    fireEvent.change(yearsInput, { target: { value: "7" } });
    fireEvent.click(screen.getByText("profile.saveChanges"));

    await waitFor(() =>
      expect(updateMeMock).toHaveBeenCalledWith({
        profile_summary: "Updated summary",
        profile_experience_years: 7,
      }),
    );
  });
});
