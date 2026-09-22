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

describe("branch zones", () => {
  it("formats the same instant in the record's branch zone when given", async () => {
    const { formatAppTime: fmt, appLocalDateKey: key, isOtherBranchZone, zoneAbbreviation } = await import("@/lib/datetime");
    const utc = "2026-08-24T07:30:00.000Z"; // 17:00 Adelaide, 17:30 Melbourne
    expect(fmt(utc)).toMatch(/5:00\s*pm/i);
    expect(fmt(utc, "Australia/Melbourne")).toMatch(/5:30\s*pm/i);
    // 14:15 UTC on the 24th: already the 25th in Melbourne, still the 24th in Adelaide
    expect(key("2026-08-24T14:15:00.000Z", "Australia/Melbourne")).toBe("2026-08-25");
    expect(key("2026-08-24T14:15:00.000Z")).toBe("2026-08-24");
    expect(isOtherBranchZone("Australia/Melbourne")).toBe(true);
    expect(isOtherBranchZone("Australia/Adelaide")).toBe(false);
    expect(isOtherBranchZone(undefined)).toBe(false);
    expect(zoneAbbreviation(utc, "Australia/Melbourne")).toMatch(/AEST|GMT\+10/);
  });

  it("ignores an invalid zone and falls back to the user's zone", async () => {
    const { formatAppTime: fmt } = await import("@/lib/datetime");
    expect(fmt("2026-08-24T07:30:00.000Z", "Mars/Olympus")).toMatch(/5:00\s*pm/i);
  });
});
