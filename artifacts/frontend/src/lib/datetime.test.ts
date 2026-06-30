import { describe, expect, it } from "vitest";
import {
  appLocalDateKey,
  datetimeLocalValueToUtcIso,
  formatAppTime,
  utcIsoToDatetimeLocalValue,
} from "@/lib/datetime";

describe("datetime timezone helpers", () => {
  it("round-trips 9:00 AM Adelaide through datetime-local", () => {
    const local = "2026-06-30T09:00";
    const utc = datetimeLocalValueToUtcIso(local);
    expect(utcIsoToDatetimeLocalValue(utc)).toBe(local);
  });

  it("formats stored UTC as 9:00 am Adelaide", () => {
    const utc = datetimeLocalValueToUtcIso("2026-06-30T09:00");
    expect(formatAppTime(utc)).toMatch(/9:00\s*am/i);
    expect(appLocalDateKey(utc)).toBe("2026-06-30");
  });

  it("maps Adelaide calendar day for shift grouping", () => {
    const adelaideDay = "2026-06-30";
    const wrongUtc = "2026-06-30T19:30:00.000Z";
    const correctUtc = "2026-06-30T10:00:00.000Z";
    expect(appLocalDateKey(wrongUtc)).toBe("2026-07-01");
    expect(appLocalDateKey(correctUtc)).toBe(adelaideDay);
  });
});
