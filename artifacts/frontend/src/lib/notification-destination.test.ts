import { describe, expect, it } from "vitest";
import { notificationDestination } from "@/lib/notification-destination";

const n = (event_type: string, extra: Partial<{ action_url: string | null; shift_id: string | null; conversation_id: string | null }> = {}) => ({
  event_type,
  action_url: null,
  shift_id: null,
  conversation_id: null,
  ...extra,
});

describe("where a notification opens", () => {
  it("opens a shift on the page each role can use", () => {
    const reassign = n("worker_cannot_attend", { shift_id: "s1", action_url: "https://app.example/coordinator/rostering?openShift=s1" });
    expect(notificationDestination(reassign, "office")).toEqual({ path: "/coordinator/rostering?openShift=s1", labelKey: "inbox.go.shift" });
    // Directors can't open the coordinator roster.
    expect(notificationDestination(reassign, "director")?.path).toBe("/md/schedule?shiftId=s1");
    expect(notificationDestination(n("shift_change", { shift_id: "s1" }), "worker")?.path).toBe("/my-shifts/s1");
  });

  it("uses the shift even when the sender gave no link", () => {
    // Medication alerts, overdue notes and auto-ended shifts carry only a shift.
    expect(notificationDestination(n("medication_alert", { shift_id: "s9" }), "office")?.path).toBe("/coordinator/rostering?openShift=s9");
    expect(notificationDestination(n("shift_auto_ended_overdue", { shift_id: "s9" }), "worker")?.path).toBe("/my-shifts/s9");
  });

  it("prefers the incident over the shift", () => {
    const report = n("coordinator_message", { shift_id: "s1", action_url: "https://app.example/incidents/i1" });
    expect(notificationDestination(report, "office")).toEqual({ path: "/incidents/i1", labelKey: "inbox.go.incident" });
  });

  it("ignores links that go nowhere useful and falls back to the type", () => {
    // Old default link: a worker-only page that 403'd office staff.
    expect(notificationDestination(n("training_request", { action_url: "https://app.example/worker/profile" }), "office")?.path).toBe("/team");
    expect(notificationDestination(n("training_request"), "director")?.path).toBe("/md/onboarding/training");
    expect(notificationDestination(n("applicant_stage_stuck", { action_url: "/notifications" }), "office")?.path).toBe("/md/staff-onboarding");
    expect(notificationDestination(n("certification_expiry"), "worker")?.path).toBe("/my-compliance");
    expect(notificationDestination(n("buddy_assigned"), "worker")?.path).toBe("/worker-onboarding");
  });

  it("sends a director's Team link to their staff page", () => {
    expect(notificationDestination(n("invite_request", { action_url: "/team" }), "director")?.path).toBe("/md/staff");
  });

  it("returns nothing when there's genuinely nowhere to go", () => {
    expect(notificationDestination(n("coordinator_message", { action_url: "/notifications" }), "office")).toBeNull();
  });
});
