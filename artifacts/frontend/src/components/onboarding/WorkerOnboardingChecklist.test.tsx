import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { WorkerOnboardingChecklist } from "./WorkerOnboardingChecklist";

vi.mock("@/contexts/AccessibilityContext", () => ({
  useAccessibility: () => ({ translate: (key: string) => key }),
}));

afterEach(cleanup);

it("shows completion state and reports checkbox changes", () => {
  const onToggle = vi.fn();
  render(
    <WorkerOnboardingChecklist
      items={[
        { key: "complete_profile", label: "Complete profile details", completed: false },
        { key: "verify_email", label: "Verify email", completed: true },
      ]}
      onToggle={onToggle}
    />,
  );

  expect((screen.getByRole("checkbox", { name: "onboarding.item.verifyEmail" }) as HTMLInputElement).checked).toBe(true);
  expect((screen.getByRole("checkbox", { name: "onboarding.item.completeProfile" }) as HTMLInputElement).checked).toBe(false);
  fireEvent.click(screen.getByRole("checkbox", { name: "onboarding.item.completeProfile" }));
  expect(onToggle).toHaveBeenCalledWith("complete_profile", true);
});
