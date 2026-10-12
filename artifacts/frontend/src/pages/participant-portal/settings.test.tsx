import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Settings from "./settings";
const save = vi.hoisted(() => vi.fn());
vi.mock("@/services/userService", () => ({ changePassword: save }));
vi.mock("@/components/participant-portal/ParticipantPortalShell", () => ({ ParticipantPortalShell: ({ children }: any) => <div>{children}</div> }));
vi.mock("@/components/AccessibilityPanel", () => ({ AccessibilityPanel: () => <div>Display preferences</div> }));
vi.mock("@/contexts/AccessibilityContext", () => ({ useAccessibility: () => ({ translate: (key: string) => key }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
it("preserves password entries when moving between settings sections", () => {
  render(<Settings />);
  fireEvent.click(screen.getByRole("button", { name: "Password" }));
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "ExistingPass123" } });
  fireEvent.click(screen.getByRole("button", { name: "Display & accessibility" }));
  expect(screen.queryByRole("button", { name: "Change password" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Password" }));
  expect((screen.getByLabelText("Current password") as HTMLInputElement).value).toBe("ExistingPass123");
});
it("keeps a failed password request visible and permits retry", async () => {
  save.mockRejectedValueOnce(new Error("Could not save. Try again."));
  render(<Settings />);
  fireEvent.click(screen.getByRole("button", { name: "Password" }));
  for (const [label, value] of [["Current password", "ExistingPass123"], ["New password", "NewPassword123"], ["Confirm new password", "NewPassword123"]]) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  }
  fireEvent.click(screen.getByRole("button", { name: "Change password" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Could not save");
  expect((screen.getByLabelText("New password") as HTMLInputElement).value).toBe("NewPassword123");
});
