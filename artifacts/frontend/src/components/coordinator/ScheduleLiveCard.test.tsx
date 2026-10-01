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
  render(<ScheduleLiveCard shift={{ ...shift, clock_in_verified: true, clock_in_method: "gps" }} onOpen={() => {}} />);
  expect(screen.getByText("GPS verified")).toBeTruthy();
});
