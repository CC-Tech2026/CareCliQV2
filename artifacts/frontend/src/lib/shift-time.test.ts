import { describe, expect, it } from "vitest";

import { addDaysToKey, buildShiftRange, lengthLabel, splitShiftTimes, timeOf } from "./shift-time";

const ADL = "Australia/Adelaide";

describe("shift time editing", () => {
  it("builds a same-day shift on the participant's clock", () => {
    const r = buildShiftRange("2026-11-21", "09:00", "13:00", ADL)!;
    expect(r.minutes).toBe(240);
    expect(r.overnight).toBe(false);
    // Adelaide is UTC+10:30 in November (daylight saving).
    expect(r.startIso).toBe("2026-11-20T22:30:00.000Z");
  });

  it("treats an end before the start as finishing the next day", () => {
    const r = buildShiftRange("2026-11-21", "22:00", "06:00", ADL)!;
    expect(r.overnight).toBe(true);
    expect(r.minutes).toBe(480);
  });

  it("round-trips a shift's stored times", () => {
    const r = buildShiftRange("2026-11-21", "09:15", "11:45", ADL)!;
    expect(splitShiftTimes(r.startIso, r.endIso, ADL)).toEqual({ day: "2026-11-21", start: "09:15", end: "11:45" });
  });

  it("moves days across month ends and wraps times", () => {
    expect(addDaysToKey("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDaysToKey("2026-11-21", 7)).toBe("2026-11-28");
    expect(timeOf(25 * 60 + 30)).toBe("01:30");
  });

  it("rejects incomplete input and labels lengths", () => {
    expect(buildShiftRange("2026-11-21", "", "13:00", ADL)).toBeNull();
    expect(lengthLabel(240)).toBe("4 h");
    expect(lengthLabel(150)).toBe("2 h 30 min");
    expect(lengthLabel(45)).toBe("45 min");
  });
});
