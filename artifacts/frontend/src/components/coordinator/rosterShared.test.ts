import { describe, expect, it } from "vitest";
import { dayAvailability, workerFit } from "./rosterShared";
import type { CoordinatorShiftRecord } from "@/services/coordinatorService";

const TZ = "Australia/Adelaide";
// Monday 16 November 2026 (daylight saving, UTC+10:30): 9am to 1pm.
const shift = {
  id: "open-1",
  worker_id: "00000000-0000-0000-0000-000000000000",
  scheduled_start: "2026-11-15T22:30:00Z",
  scheduled_end: "2026-11-16T02:30:00Z",
  status: "unassigned",
  timezone: TZ,
} as CoordinatorShiftRecord;

const avail = {
  user_id: "w-1",
  available_days: [1, 2, 3, 4, 5],
  day_start_time: "08:00",
  day_end_time: "18:00",
  max_hours_per_week: 38,
  blackout_dates: [] as Array<{ start_date: string; end_date: string }>,
};

const other = (over: Partial<CoordinatorShiftRecord>) =>
  ({ id: "s-2", worker_id: "w-1", status: "scheduled", timezone: TZ, ...over }) as CoordinatorShiftRecord;

describe("workerFit", () => {
  it("is free when nothing gets in the way", () => {
    expect(workerFit({ shift, avail, workerShifts: [] })).toEqual({ tone: "good", label: "Free" });
  });

  it("is busy when it overlaps another of their shifts, and says when", () => {
    const busy = other({ scheduled_start: "2026-11-15T23:30:00Z", scheduled_end: "2026-11-16T01:30:00Z" });
    expect(workerFit({ shift, avail, workerShifts: [busy] })).toEqual({ tone: "bad", label: "Busy 10am–12pm" });
    // A shift that ends as this one starts is fine.
    const before = other({ scheduled_start: "2026-11-15T20:30:00Z", scheduled_end: "2026-11-15T22:30:00Z" });
    expect(workerFit({ shift, avail, workerShifts: [before] }).tone).toBe("good");
  });

  it("is a clash on leave, and a caution outside their usual days, hours or weekly cap", () => {
    expect(workerFit({ shift, avail: { ...avail, blackout_dates: [{ start_date: "2026-11-16", end_date: "2026-11-20" }] }, workerShifts: [] }))
      .toEqual({ tone: "bad", label: "On leave" });
    expect(workerFit({ shift, avail: { ...avail, available_days: [2, 3] }, workerShifts: [] }))
      .toEqual({ tone: "warn", label: "Not their day" });
    expect(workerFit({ shift, avail: { ...avail, day_start_time: "10:00" }, workerShifts: [] }))
      .toEqual({ tone: "warn", label: "Outside 10am–6pm" });
    // 36h already this week (Tue to Fri, 9h each) plus 4h is over 38h.
    const week = [17, 18, 19, 20].map((d) =>
      other({ id: `w${d}`, scheduled_start: `2026-11-${d - 1}T21:30:00Z`, scheduled_end: `2026-11-${d}T06:30:00Z` }),
    );
    expect(workerFit({ shift, avail, workerShifts: week })).toEqual({ tone: "warn", label: "Over 38h" });
  });
});

describe("dayAvailability", () => {
  it("says when a worker is free, off or on leave", () => {
    expect(dayAvailability(avail, "2026-11-16")).toEqual({ state: "free", start: 480, end: 1080, text: "8am–6pm" });
    expect(dayAvailability(avail, "2026-11-21").state).toBe("off");
    expect(dayAvailability({ ...avail, blackout_dates: [{ start_date: "2026-11-16", end_date: "2026-11-16" }] }, "2026-11-16").text).toBe("On leave");
    expect(dayAvailability(undefined, "2026-11-16").state).toBe("unknown");
  });
});
