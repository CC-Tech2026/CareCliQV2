import { describe, expect, it } from "vitest";
import { checkDraftNoteHints, type DraftNoteHint } from "@workspace/worker-compliance";
import fixture from "../../../../lib/worker-compliance/fixtures/rule-parity.json";

// The worker app's offline note rules give the same results as the server's
// (backend/tests/test_note_rule_parity.py runs the same fixture there).
function statusFor(hints: DraftNoteHint[], rule: string): "pass" | "warning" | "fail" {
  const forRule = hints.filter((h) => h.rule === rule);
  if (forRule.some((h) => h.severity === "fail")) return "fail";
  if (forRule.length > 0) return "warning";
  return "pass";
}

describe("offline note rules match the server", () => {
  for (const testCase of fixture.cases) {
    it(testCase.text.slice(0, 48), () => {
      const hints = checkDraftNoteHints(testCase.text, "Sam");
      for (const [rule, expected] of Object.entries(testCase.expect)) {
        expect({ rule, status: statusFor(hints, rule) }).toEqual({ rule, status: expected });
      }
    });
  }
});
