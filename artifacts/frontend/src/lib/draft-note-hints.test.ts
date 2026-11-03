import { expect, it } from "vitest";
import { checkDraftNoteHints, nextNotePrompt } from "@workspace/worker-compliance";

// The live hints the worker app shows while a note is typed. They mirror the
// server's scored rules (compliance_engine.py R6, R7, R12).
const ids = (text: string, name?: string) => checkDraftNoteHints(text, name).map((h) => h.id);

it("suggests person-first wording", () => {
  const [hint] = checkDraftNoteHints("Supported the autistic boy with lunch today.").filter((h) => h.id === "person-first");
  expect(hint.phrase).toBe("autistic boy");
  expect(hint.suggestion).toBe("person with autism");
});

it("asks for what was seen rather than an opinion", () => {
  expect(ids("I think Sam was tired after the bus trip to the library.", "Sam")).toContain("subjective-language");
});

it("asks how the participant responded once a note is long enough", () => {
  const note = "Went to the shops at 10am for 45 minutes and bought groceries for the week, then cooked lunch at home with Sam";
  expect(ids(note, "Sam")).toContain("participant-response");
  expect(ids(`${note}. Sam chose the vegetables and said he enjoyed cooking.`, "Sam")).not.toContain("participant-response");
});

it("leaves a short note to the length hint alone", () => {
  expect(ids("Lunch with Sam today.", "Sam")).toEqual(["word-count"]);
});

it("still flags a possible restrictive practice first", () => {
  expect(ids("Locked the door so Sam could not leave the house.", "Sam")[0]).toBe("restrictive-practice");
});

// The note guide in the worker app asks about what a task's notes don't cover yet.
it("asks first what was supported, then how the participant responded", () => {
  expect(nextNotePrompt("", { hasGoal: true })).toBe("did");
  expect(nextNotePrompt("Went to the shops at 10am for groceries.", { hasGoal: true })).toBe("response");
});

it("asks about the goal only when the task has one", () => {
  const note = "Cooked lunch with Sam. He chose the vegetables.";
  expect(nextNotePrompt(note, { hasGoal: true })).toBe("goal");
  expect(nextNotePrompt(note, { hasGoal: false })).toBe("concern");
});

it("moves past skipped questions and finishes when everything is covered", () => {
  const note = "Cooked lunch with Sam. He chose the vegetables.";
  expect(nextNotePrompt(note, { hasGoal: true, skipped: ["goal"] })).toBe("concern");
  expect(nextNotePrompt(`${note} He is more independent with chopping now. No concerns.`, { hasGoal: true })).toBeNull();
});
