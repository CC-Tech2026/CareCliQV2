import { expect, it } from "vitest";
import { safeRichText } from "./safe-html";

it("keeps simple formatting and drops everything that could run or load", () => {
  expect(safeRichText("Build <b>confidence</b> on the <i>bus</i>")).toBe("Build <b>confidence</b> on the <i>bus</i>");
  expect(safeRichText('<img src=x onerror="alert(1)">Hi')).toBe("Hi");
  expect(safeRichText('<b onclick="steal()">Bold</b>')).toBe("<b>Bold</b>");
  expect(safeRichText("<script>alert(1)</script>Text")).toBe("Text");
  expect(safeRichText('<a href="javascript:alert(1)">link</a> after')).toBe("link after");
  expect(safeRichText("<ul><li>One</li></ul>")).toBe("<ul><li>One</li></ul>");
  expect(safeRichText(null)).toBe("");
});
