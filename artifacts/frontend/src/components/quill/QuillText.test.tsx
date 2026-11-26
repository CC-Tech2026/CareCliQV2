import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { QuillText } from "./QuillText";

afterEach(cleanup);

it("renders answer headings, lists, code and record links semantically", () => {
  render(<QuillText text={'## Next steps\n\n1. Review **credentials**\n2. Open [staff records](/md/staff)\n\n> Review the source records.\n\n```text\nA < B\n```'} />);
  expect(screen.getByRole("heading", { name: "Next steps" })).toBeTruthy();
  expect(screen.getByRole("list").tagName).toBe("OL");
  expect(screen.getByRole("link", { name: "staff records" }).getAttribute("href")).toBe("/md/staff");
  expect(screen.getByText("A < B").tagName).toBe("CODE");
});

it("keeps unsafe model links inert and treats HTML as plain text", () => {
  const { container } = render(<QuillText text={'[unsafe](javascript:alert) [external](//example.com)\n\n<img src=x onerror=alert(1)>'} />);
  expect(screen.queryByRole("link")).toBeNull();
  expect(container.querySelector("img")).toBeNull();
  expect(screen.getByText(/<img src=x/)).toBeTruthy();
});
