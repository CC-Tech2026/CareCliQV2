import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ScheduleLiveCard, shiftStage } from "./ScheduleLiveCard";
import type { LiveShift } from "@/services/coordinatorService";
vi.mock("@/contexts/AccessibilityContext", async () => {
  const { t, tParams } = await import("@/lib/i18n/translations");
  return { useAccessibility: () => ({ translate: (key: string) => t("en", key), translateParams: (key: string, params: Record<string,string>) => tParams("en", key, params) }) };
});
afterEach(cleanup);
const shift = { id: "shift-1", worker_name: "Alex", participant_name: "Sam", status: "completed", clocked_in_at: "2026-10-01T00:00:00Z", clocked_out_at: "2026-10-01T04:00:00Z", task_counts: { completed: 2, total: 4 } } as LiveShift;
it("classifies completed shifts ahead of clock-in and late conditions", () => {
  expect(shiftStage(shift)).toBe("completed");
  expect(shiftStage({ scheduled_start: "2026-10-01T00:00:00Z" }, Date.parse("2026-10-01T01:00:00Z"))).toBe("late");
  expect(shiftStage({ scheduled_start: "2026-10-01T02:00:00Z" }, Date.parse("2026-10-01T01:00:00Z"))).toBe("scheduled");
});
it("opens tools and links the completed shift to its verification page", () => {
  const open = vi.fn();
  render(<ScheduleLiveCard shift={shift} onOpen={open} />);
  fireEvent.click(screen.getByRole("button"));
  expect(open).toHaveBeenCalledOnce();
  expect(screen.getByRole("link", { name: "Review shift" }).getAttribute("href")).toBe("/coordinator/verification?shiftId=shift-1");
  expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("2");
});
it("does not label a QR check-in as GPS verified and respects read-only access", () => {
  render(<ScheduleLiveCard shift={{ ...shift, clock_in_verified: true, clock_in_method: "qr" }} onOpen={() => {}} readOnly />);
  expect(screen.queryByText("GPS verified")).toBeNull();
  expect(screen.queryByRole("link", { name: "Review shift" })).toBeNull();
});
it("shows GPS verification only when the stored method and result confirm it", () => {
  const active = { ...shift, status: "in_progress", clocked_out_at: null, clock_in_verified: true, clock_in_method: "gps" };
  render(<ScheduleLiveCard shift={active} onOpen={() => {}} />);
  expect(screen.getByText(/GPS verified/)).toBeTruthy();
});
it("drops the review prompt once a completed shift is verified", () => {
  render(<ScheduleLiveCard shift={{ ...shift, verified: true }} onOpen={() => {}} />);
  expect(screen.queryByRole("link", { name: "Review shift" })).toBeNull();
  expect(screen.getByText("Verified")).toBeTruthy();
});
it("flags a late shift and says the coordinator was alerted", () => {
  const late = { ...shift, status: "scheduled", clocked_in_at: null, clocked_out_at: null, scheduled_start: "2020-01-01T00:00:00Z", alerts: [{ id: "a", alert_type: "late", message: "Late", severity: "warning" }] } as LiveShift;
  const { container } = render(<ScheduleLiveCard shift={late} onOpen={() => {}} />);
  expect(screen.getByText("Not clocked in")).toBeTruthy();
  expect(screen.getByText("Coordinator alerted")).toBeTruthy();
  expect(container.querySelector("article")?.className).toContain("border-red-400");
});
it("names the participant and the latest task on an active shift", () => {
  const active = { ...shift, status: "in_progress", clocked_out_at: null, checklist: [
    { task_id: "1", label: "Meds", completed: true, completed_at: "2026-10-01T00:30:00Z", documented: true, mandatory: false },
    { task_id: "2", label: "Lunch", completed: true, completed_at: "2026-10-01T01:15:00Z", documented: true, mandatory: false },
  ] } as LiveShift;
  render(<ScheduleLiveCard shift={active} onOpen={() => {}} />);
  expect(screen.getByText(/with Sam/)).toBeTruthy();
  expect(screen.getByText(/Task completed/)).toBeTruthy();
  expect(screen.getByText("Tasks 2 of 4")).toBeTruthy();
});
