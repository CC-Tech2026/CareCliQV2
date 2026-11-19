import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CopyButton } from "./copy-button";

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("CopyButton", () => {
  it("copies the value and says so", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    render(<CopyButton value="0400 100 201" label="phone number" />);
    const button = screen.getByRole("button", { name: "Copy phone number" });
    await act(async () => { fireEvent.click(button); });
    expect(writeText).toHaveBeenCalledWith("0400 100 201");
    expect(screen.getByRole("button", { name: "Copied phone number" })).toBeTruthy();
  });

  it("says when it couldn't copy", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } });
    document.execCommand = vi.fn().mockReturnValue(false);
    render(<CopyButton value="431990001" label="NDIS number" />);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Copy NDIS number" })); });
    expect(screen.getByRole("button", { name: "Couldn't copy NDIS number" })).toBeTruthy();
  });
});
