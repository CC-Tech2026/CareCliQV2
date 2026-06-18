import { describe, expect, it } from "vitest";
import {
  emergencyContactDisplay,
  formatDobWithAge,
  formatParticipantDob,
  isLongPreferenceContent,
  PREFERENCE_COLLAPSE_CHARS,
} from "@/lib/participant-display";

describe("CARECLIQV2-195 participant profile display", () => {
  it("formats DOB and age", () => {
    expect(formatParticipantDob("1990-01-15")).toBe("15 Jan 1990");
    const withAge = formatDobWithAge("1990-01-15");
    expect(withAge).toMatch(/15 Jan 1990/);
    expect(withAge).toMatch(/\(\d+ yrs\)/);
  });

  it("parses structured emergency contact for tel link", () => {
    const display = emergencyContactDisplay({
      name: "Sam Lee",
      relationship: "Brother",
      phone: "0400999888",
    });
    expect(display?.text).toContain("Sam Lee");
    expect(display?.phone).toBe("0400999888");
  });

  it("extracts phone from plain-text emergency contact", () => {
    const display = emergencyContactDisplay("Sam Lee — 0400 999 888");
    expect(display?.phone).toBe("0400 999 888");
  });
});

describe("CARECLIQV2-196 preference display", () => {
  it("treats content over threshold as long", () => {
    const short = "a".repeat(PREFERENCE_COLLAPSE_CHARS);
    const long = "a".repeat(PREFERENCE_COLLAPSE_CHARS + 1);
    expect(isLongPreferenceContent(short)).toBe(false);
    expect(isLongPreferenceContent(long)).toBe(true);
  });
});
