import { describe, expect, it } from "vitest";
import { shiftNoteDay, shiftNoteSubtitle, shiftNoteTimes, shiftNoteTitle } from "./shift-note-title";

const thisYear = new Date().getFullYear();
const at = (month: number, day: number, h: number, m: number) => new Date(thisYear, month - 1, day, h, m).toISOString();

const note = {
  session_date: `${thisYear}-10-31`,
  started_at: at(10, 31, 10, 14),
  ended_at: at(10, 31, 13, 17),
  duration_minutes: 183,
  participants: { full_name: "Isabella Garcia" },
  worker_name: "Kwame Mensah",
  session_type: "support_work",
};

describe("shift note titles", () => {
  it("names the participant and the day, never the session type", () => {
    const title = shiftNoteTitle(note);
    expect(title).toMatch(/^Isabella Garcia · \w{3},? 31 Oct$/);
    expect(title.toLowerCase()).not.toContain("support work");
  });

  it("leads with the day on a single participant's history", () => {
    expect(shiftNoteTitle(note, { participant: false })).toMatch(/^\w{3},? 31 Oct$/);
  });

  it("gives the actual times and who worked it", () => {
    expect(shiftNoteSubtitle(note)).toBe("10:14 am to 1:17 pm · Kwame Mensah");
    expect(shiftNoteSubtitle(note, { worker: false })).toBe("10:14 am to 1:17 pm");
  });

  it("tells two notes on the same day apart by their times", () => {
    const later = { ...note, started_at: at(10, 31, 15, 0), ended_at: at(10, 31, 17, 30) };
    expect(shiftNoteSubtitle(later)).not.toBe(shiftNoteSubtitle(note));
  });

  it("says when an overnight shift ends the next day", () => {
    const overnight = { started_at: at(10, 30, 21, 56), ended_at: at(10, 31, 9, 27) };
    expect(shiftNoteTimes(overnight)).toBe("9:56 pm to 9:27 am next day");
  });

  it("falls back to the length when times weren't recorded", () => {
    expect(shiftNoteTimes({ duration_minutes: 90 })).toBe("1 hour 30 min");
    expect(shiftNoteTimes({ duration_minutes: 180 })).toBe("3 hours");
    expect(shiftNoteTimes({})).toBeNull();
  });

  it("reads a bare date as that calendar day, not the day before", () => {
    expect(shiftNoteDay({ session_date: `${thisYear}-03-01` })).toMatch(/ 1 Mar$/);
  });

  it("adds the year only for other years", () => {
    expect(shiftNoteDay({ session_date: "2024-03-01" })).toMatch(/2024$/);
  });

  it("still has a title with nothing to go on", () => {
    expect(shiftNoteTitle({})).toBe("Shift note");
  });
});
