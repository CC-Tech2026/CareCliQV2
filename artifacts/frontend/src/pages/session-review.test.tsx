import { expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ReviewRedirect from "./session-review";
vi.mock("wouter", () => ({
  useSearch: () => "?shiftId=shift-1&workerId=worker-1",
  Redirect: ({ to }: { to: string }) => <p>{to}</p>,
}));
it("routes legacy awaiting-review links to the existing verification workspace", () => {
  render(<ReviewRedirect />);
  expect(
    screen.getByText(
      "/coordinator/verification?shiftId=shift-1&workerId=worker-1",
    ),
  ).toBeTruthy();
});
