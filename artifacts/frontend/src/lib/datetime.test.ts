import { describe, expect, it, vi } from "vitest";
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

  it("gives today in Adelaide early in the morning, when UTC is still yesterday", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-11-11T22:00:00.000Z")); // 8:30 am on the 12th in Adelaide
      const { appTodayKey } = await import("@/lib/datetime");
      expect(new Date().toISOString().slice(0, 10)).toBe("2026-11-11");
      expect(appTodayKey()).toBe("2026-11-12");
    } finally {
      vi.useRealTimers();
    }
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

describe("showing times on the right clock", () => {
  it("reads a timestamp on a given zone's wall clock, whatever the browser's zone", async () => {
    const { zonedDate } = await import("@/lib/datetime");
    // 22:30 UTC is 9:00 am the next day in Adelaide (ACDT) and 9:30 am in Melbourne (AEDT).
    const adelaide = zonedDate("2026-11-19T22:30:00Z", "Australia/Adelaide");
    expect([adelaide.getDate(), adelaide.getHours(), adelaide.getMinutes()]).toEqual([20, 9, 0]);
    const melbourne = zonedDate("2026-11-19T22:30:00Z", "Australia/Melbourne");
    expect([melbourne.getDate(), melbourne.getHours(), melbourne.getMinutes()]).toEqual([20, 9, 30]);
  });

  it("keeps a plain date as that day and leaves app-built dates alone", async () => {
    const { displayDate } = await import("@/lib/datetime");
    const day = displayDate("2026-11-20");
    expect([day.getFullYear(), day.getMonth(), day.getDate()]).toEqual([2026, 10, 20]);
    const cell = new Date(2026, 10, 20);
    expect(displayDate(cell)).toBe(cell);
    const stamp = displayDate("2026-11-19T22:30:00Z", "Australia/Adelaide");
    expect([stamp.getDate(), stamp.getHours()]).toEqual([20, 9]);
  });

  it("switches zone when the API says the location changed, and tells the app", async () => {
    const { getAppTimezone, noteServerTimezone, setAppTimezone, TIMEZONE_CHANGED_EVENT } = await import("@/lib/datetime");
    setAppTimezone("Australia/Adelaide");
    const heard: string[] = [];
    const listener = (e: Event) => heard.push((e as CustomEvent<string>).detail);
    window.addEventListener(TIMEZONE_CHANGED_EVENT, listener);
    noteServerTimezone("Australia/Adelaide");
    noteServerTimezone("not a zone");
    expect(heard).toEqual([]);
    noteServerTimezone("Australia/Melbourne");
    expect(getAppTimezone()).toBe("Australia/Melbourne");
    expect(heard).toEqual(["Australia/Melbourne"]);
    window.removeEventListener(TIMEZONE_CHANGED_EVENT, listener);
    setAppTimezone(null);
  });
});
