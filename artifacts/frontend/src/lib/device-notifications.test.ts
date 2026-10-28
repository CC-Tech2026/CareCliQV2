import { afterEach, describe, expect, it, vi } from "vitest";
import { isDesktopNotificationsEnabled, setDesktopNotificationsEnabled } from "@/lib/desktop-notifications";
import { resolveNotificationPath } from "@/lib/worker-notification-presenter";
import type { UserNotification } from "@/services/notificationService";

vi.mock("@/hooks/use-toast", () => ({ toast: vi.fn() }));
vi.mock("@/components/worker/WorkerBannerToastContent", () => ({ WorkerBannerToastContent: () => null }));

const reassign: UserNotification = {
  id: "n1",
  event_type: "worker_cannot_attend",
  title: "Shift needs reassigning",
  body: "",
  severity: "high",
  shift_id: "s1",
  action_url: "https://carecliq.example/coordinator/rostering?openShift=s1",
  created_at: "2026-10-28T00:00:00Z",
};

describe("notification routing", () => {
  it("sends office staff to the action_url, workers to their shift", () => {
    expect(resolveNotificationPath(reassign, "office")).toBe("/coordinator/rostering?openShift=s1");
    expect(resolveNotificationPath(reassign, "worker")).toBe("/my-shifts/s1");
  });
});

describe("desktop notification setting", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("stays off after Turn off even though the browser permission is still granted", () => {
    vi.stubGlobal("Notification", { permission: "granted" });
    expect(isDesktopNotificationsEnabled()).toBe(true);
    setDesktopNotificationsEnabled(false);
    expect(isDesktopNotificationsEnabled()).toBe(false);
  });

  it("is off whenever the browser hasn't granted permission", () => {
    vi.stubGlobal("Notification", { permission: "default" });
    setDesktopNotificationsEnabled(true);
    expect(isDesktopNotificationsEnabled()).toBe(false);
  });
});
