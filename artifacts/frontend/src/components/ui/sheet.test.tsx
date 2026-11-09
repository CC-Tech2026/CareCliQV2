import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "./sheet";

afterEach(cleanup);

function TwoPanels() {
  const [first, setFirst] = useState(true);
  const [second, setSecond] = useState(false);
  return (
    <>
      <Sheet open={first} onOpenChange={setFirst}>
        <SheetContent data-testid="worker-panel">
          <SheetTitle>Worker</SheetTitle>
          <SheetDescription>Worker details</SheetDescription>
          <button type="button" onClick={() => setSecond(true)}>Deactivate</button>
        </SheetContent>
      </Sheet>
      <Sheet open={second} onOpenChange={setSecond}>
        <SheetContent data-testid="deactivate-panel">
          <SheetTitle>Deactivate worker</SheetTitle>
          <SheetDescription>Confirm</SheetDescription>
          <button type="button" onClick={() => setSecond(false)}>Back</button>
        </SheetContent>
      </Sheet>
    </>
  );
}

it("shows only the panel on top, then brings the one underneath back when it closes", () => {
  render(<TwoPanels />);
  const worker = screen.getByTestId("worker-panel");
  expect(worker.style.visibility).not.toBe("hidden");

  fireEvent.click(screen.getByRole("button", { name: "Deactivate" }));
  expect(screen.getByTestId("deactivate-panel").style.visibility).not.toBe("hidden");
  expect(screen.getByTestId("worker-panel").style.visibility).toBe("hidden");
  // One backdrop, not one per panel.
  expect(document.querySelectorAll('[class*="bg-black/80"]')).toHaveLength(1);

  act(() => {
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
  });
  expect(screen.queryByTestId("deactivate-panel")).toBeNull();
  expect(screen.getByTestId("worker-panel").style.visibility).not.toBe("hidden");
});
