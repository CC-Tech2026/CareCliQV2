import { expect, it } from "vitest";
import { checkDraftNoteHints, nextNotePrompt } from "@workspace/worker-compliance";

// The live hints the worker app shows while a note is typed, offline. They
// mirror the server's scored rules (compliance_engine.py); note-rule-parity
// checks the same examples on both sides.
const ids = (text: string, name?: string) => checkDraftNoteHints(text, name).map((h) => h.id);

it("suggests person-first wording", () => {
  const [hint] = checkDraftNoteHints("Supported the autistic boy with lunch today.").filter((h) => h.id === "person-first");
  expect(hint.rule).toBe("R7");
  expect(hint.phrase).toBe("autistic boy");
  expect(hint.suggestion).toBe("person with autism");
});

it("asks for what was seen rather than an opinion", () => {
  const hints = checkDraftNoteHints("I think Sam was tired after the bus trip to the library.", "Sam");
  expect(hints.find((h) => h.id === "subjective-language")?.rule).toBe("R6");
});

it("uses the server's response words for how the participant responded", () => {
  const note = "Went to the shops at 10am for 45 minutes and bought groceries for the week, then cooked lunch at home with Sam";
  expect(ids(note, "Sam")).toContain("participant-response");
  expect(ids(`${note}. Sam engaged with the cooking and reported enjoying it.`, "Sam")).not.toContain("participant-response");
  // "said" and "chose" read naturally but aren't response words for R12.
  expect(ids(`${note}. Sam chose the vegetables and said he enjoyed cooking.`, "Sam")).toContain("participant-response");
});

it("fails a short note with the server's word count", () => {
  const [hint] = checkDraftNoteHints("Lunch with Sam today and a walk.", "Sam");
  expect(hint).toMatchObject({ id: "word-count", rule: "R3", severity: "fail" });
  expect(hint.message).toContain("of 80 words");
});

it("calls out vague filler once a note is long enough", () => {
  const note =
    "Sam engaged with the shopping and chose the items at the supermarket today, then we caught the bus home and unpacked the bags together in the kitchen. Good session, no concerns, went well and the same as usual.";
  expect(checkDraftNoteHints(note, "Sam").find((h) => h.id === "filler")?.rule).toBe("R3");
});

it("flags incidents and work outside a support worker's role", () => {
  expect(checkDraftNoteHints("Sam tripped on the step and grazed a knee.", "Sam").find((h) => h.id === "incident")?.rule).toBe("R9");
  expect(checkDraftNoteHints("I gave the medication to Sam at lunch.", "Sam").find((h) => h.id === "scope")?.rule).toBe("R8");
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
  const note = "Cooked lunch with Sam at 12pm. Sam engaged with chopping.";
  expect(nextNotePrompt(note, { hasGoal: true })).toBe("goal");
  expect(nextNotePrompt(note, { hasGoal: false })).toBe("concern");
});

it("doesn't accept bare 'no concerns' as answering the concern question", () => {
  const note = "Cooked lunch with Sam at 12pm. Sam engaged with chopping. No concerns.";
  expect(nextNotePrompt(note, { hasGoal: false })).toBe("concern");
  expect(
    nextNotePrompt("Cooked lunch with Sam at 12pm. Sam engaged with chopping. Sam appeared calm and reported no pain.", { hasGoal: false }),
  ).toBe("detail");
});

it("moves past skipped questions and finishes when everything is covered", () => {
  const note = "Cooked lunch with Sam at 12pm. Sam engaged with chopping.";
  expect(nextNotePrompt(note, { hasGoal: true, skipped: ["goal"] })).toBe("concern");
  const full =
    "Sam engaged in lunch preparation from 12:00 to 12:40, chopping the carrots and washing the lettuce. Sam reported feeling full afterwards. " +
    "This worked towards Sam's goal to cook more independently, and Sam achieved the chopping without prompts. We walked to the park at 1pm " +
    "and Sam chose the swings, then demonstrated waiting for a turn. Sam appeared calm throughout. On the way home Sam crossed two roads with " +
    "verbal prompts only and paid for a drink at the shop with the right change. We arrived home at 2pm and Sam rested on the couch.";
  expect(nextNotePrompt(full, { hasGoal: true })).toBeNull();
});


it("asks when it happened before asking how the participant responded", () => {
  expect(nextNotePrompt("Cooked lunch with Sam.", { hasGoal: true })).toBe("when");
  expect(nextNotePrompt("Cooked lunch with Sam from 12 to 12:40.", { hasGoal: true })).toBe("response");
  expect(nextNotePrompt("Cooked lunch with Sam.", { hasGoal: true, skipped: ["when"] })).toBe("response");
});
