import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { DayTimeline, timelineBounds } from "./DayTimeline";
import { shiftLiveStatus } from "./ShiftHoverCard";
import type { CoordinatorShiftRecord, WorkerStats } from "@/services/coordinatorService";

afterEach(cleanup);

const TZ = "Australia/Adelaide";

function shift(overrides: Partial<CoordinatorShiftRecord>): CoordinatorShiftRecord {
  return {
    id: "s1",
    worker_id: "w1",
    worker_name: "Priya Sharma",
    participant_name: "Liam Carter",
    // 9:00–13:00 in Adelaide (UTC+9:30 on 30 Sep 2026)
    scheduled_start: "2026-09-29T23:30:00Z",
    scheduled_end: "2026-09-30T03:30:00Z",
    status: "scheduled",
    timezone: TZ,
    ...overrides,
  };
}

it("labels what's happening on a shift right now", () => {
  const now = new Date("2026-09-30T00:00:00Z");
  expect(shiftLiveStatus(shift({ clocked_in_at: "2026-09-29T23:26:00Z" }), now)).toBe("on_shift");
  expect(shiftLiveStatus(shift({}), now)).toBe("late");
  expect(shiftLiveStatus(shift({}), new Date("2026-09-29T20:00:00Z"))).toBe("scheduled");
  expect(shiftLiveStatus(shift({ clocked_out_at: "2026-09-30T03:31:00Z" }), now)).toBe("completed");
  expect(shiftLiveStatus(shift({ status: "cancelled" }), now)).toBe("cancelled");
  expect(shiftLiveStatus(shift({ worker_id: undefined }), now)).toBe("unassigned");
});

it("widens the hour range to fit early and late shifts", () => {
  expect(timelineBounds([])).toEqual({ from: 360, to: 1200 });
  expect(timelineBounds([{ shift: shift({}), startMin: 330, endMin: 1290 }])).toEqual({ from: 300, to: 1320 });
});

it("shows only the day's shifts, one row per worker, and opens a shift", () => {
  const workers = [
    { id: "w1", full_name: "Priya Sharma" },
    { id: "w2", full_name: "Tom Nguyen" },
  ] as WorkerStats[];
  const tomorrow = shift({ id: "s2", scheduled_start: "2026-09-30T23:30:00Z", scheduled_end: "2026-10-01T03:30:00Z" });
  let opened: string | null = null;
  render(
    <DayTimeline dayKey="2026-09-30" shifts={[shift({}), tomorrow]} workers={workers} onSelect={(s) => (opened = s.id)} />,
  );
  expect(screen.getByText("Priya Sharma")).toBeTruthy();
  expect(screen.getByText("Tom Nguyen")).toBeTruthy();
  const blocks = screen.getAllByRole("button", { name: /Liam Carter/ });
  expect(blocks).toHaveLength(1);
  fireEvent.click(blocks[0]);
  expect(opened).toBe("s1");
});
