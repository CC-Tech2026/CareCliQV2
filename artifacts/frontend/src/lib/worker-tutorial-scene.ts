import type { TutorialStepKey } from "@/lib/worker-tutorial-steps";

export type TutorialScene = {
  openValidationModal?: boolean;
  openSignatureModal?: boolean;
};

/** Modal-only tutorial side effects — opened when the step is reached, not before. */
const SCENES: Partial<Record<TutorialStepKey, TutorialScene>> = {
  end_shift_review: { openValidationModal: true },
  shift_signature: { openSignatureModal: true },
};

export function getTutorialScene(stepKey: TutorialStepKey | null): TutorialScene | null {
  if (!stepKey) return null;
  return SCENES[stepKey] ?? null;
}

export function parseTutorialStepKey(location: string): TutorialStepKey | null {
  const query = location.split("?")[1] ?? "";
  const step = new URLSearchParams(query).get("step");
  if (!step) return null;
  return step as TutorialStepKey;
}

export function isTutorialActive(location: string): boolean {
  return location.includes("tutorial=1");
}
