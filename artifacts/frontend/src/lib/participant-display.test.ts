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
    expect(display?.name).toBe("Sam Lee");
  });

  it("reads name, relationship and phone from 'Name (Relationship) phone'", () => {
    const display = emergencyContactDisplay("Kate Williams (Mother) 0491 570 159");
    expect(display?.name).toBe("Kate Williams");
    expect(display?.relationship).toBe("Mother");
    // No stray bracket from "(Mother)" in front of the number.
    expect(display?.phone).toBe("0491 570 159");
  });

  it("keeps landline area codes and international numbers whole", () => {
    expect(emergencyContactDisplay("Dr Patel (08) 5550 2105")?.phone).toBe("(08) 5550 2105");
    expect(emergencyContactDisplay("Ana, sister, +61 491 570 111")?.phone).toBe("+61 491 570 111");
    expect(emergencyContactDisplay("Ana, sister, +61 491 570 111")?.relationship).toBe("sister");
  });

  it("keeps text with no phone as the name", () => {
    const display = emergencyContactDisplay("Ask the house manager");
    expect(display?.name).toBe("Ask the house manager");
    expect(display?.phone).toBeUndefined();
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
