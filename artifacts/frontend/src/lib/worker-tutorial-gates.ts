import type { TutorialStep, TutorialStepKey } from "@/lib/worker-tutorial-steps";
import type { TutorialProgress } from "@/services/helpService";
import { WORKER_TUTORIAL_STEPS } from "@/lib/worker-tutorial-steps";
import { SHIFT_LIVE_PROGRESS_NOTE_ENABLED } from "@/lib/shift-feature-flags";

/**
 * Per-step tutorial controls (gate overrides step defaults in worker-tutorial-steps.ts):
 *
 * - showNext: false  → hide Next; use autoAdvanceWhen or page code (tutorial.nextStep()) to advance
 * - showNext: true + canProceed → show Next disabled until canProceed() is true
 * - showSkip: false  → hide Skip on required-action steps
 * - autoAdvanceWhen  → poll until true, then auto-advance (e.g. after user clicks a real button)
 * - allowTargetInteraction → let clicks through the overlay to the highlighted control
 */
export type TutorialGate = {
  /** Skip this step when false (e.g. no risk alerts on shift). */
  isApplicable?: () => boolean;
  /**
   * Override step.showNext. When false, Next is hidden and autoAdvanceWhen (or page code)
   * should advance after the worker clicks the real UI control.
   */
  showNext?: boolean | (() => boolean);
  /** Override step.showSkip — hide Skip on steps where the action must be completed. */
  showSkip?: boolean | (() => boolean);
  /** Disable Next until the worker completes the required action (only when showNext is true). */
  canProceed?: () => boolean;
  /** Auto-advance when this returns true — use after the worker clicks the highlighted control. */
  autoAdvanceWhen?: () => boolean;
  /** Let clicks reach the highlighted control under the overlay. */
  allowTargetInteraction?: boolean;
  /** Hide the tutorial overlay while this modal is open so confirm buttons stay clickable. */
  blockingModalSelector?: string;
  waitingMessage?: string;
};

function isVisible(selector: string): boolean {
  const nodes = document.querySelectorAll(selector);
  for (const node of nodes) {
    const rect = node.getBoundingClientRect();
    if (rect.width < 2 && rect.height < 2) continue;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (Number(style.opacity) <= 0.05) continue;
    return true;
  }
  return false;
}

/** Invisible DOM markers (opacity-0) used only for tutorial state — presence is enough. */
function hasTutorialMarker(selector: string): boolean {
  return document.querySelector(selector) !== null;
}

function clockInComplete(): boolean {
  return hasTutorialMarker("[data-tutorial='clock-in-complete']");
}

function clockInModalOpen(): boolean {
  return isVisible("[data-tutorial='clock-in-modal']");
}

const GATES: Partial<Record<TutorialStepKey, TutorialGate>> = {
  open_shift: {
    isApplicable: () =>
      isVisible("[data-tutorial='start-session']") || isVisible("[data-tutorial='shift-list']"),
    showNext: false,
    showSkip: false,
    autoAdvanceWhen: () => window.location.pathname.endsWith("/briefing"),
    allowTargetInteraction: true,
    waitingMessage: "Tap Start Session to open the pre-shift briefing.",
  },
  pre_shift_briefing: {
    isApplicable: () =>
      isVisible("[data-tutorial='briefing-page']") || window.location.pathname.endsWith("/briefing"),
    showNext: true,
    showSkip: true,
  },
  pre_shift_briefing_complete: {
    isApplicable: () =>
      isVisible("[data-tutorial='briefing-page']") || window.location.pathname.endsWith("/briefing"),
    showNext: false,
    showSkip: true,
    autoAdvanceWhen: () => hasTutorialMarker("[data-tutorial='briefing-complete-marker']"),
    allowTargetInteraction: true,
    waitingMessage: "Acknowledge alerts, scroll through all sections, then tap Ready to start.",
  },
  shift_overview: {
    waitingMessage: "Loading your shift details…",
  },
  risk_acknowledgement: {
    isApplicable: () => isVisible("[data-tutorial='risk-ack-checkbox']"),
    showNext: false,
    showSkip: false,
    autoAdvanceWhen: () => isVisible("[data-tutorial='risk-ack-dialog']"),
    allowTargetInteraction: true,
    waitingMessage: "Tick the checkbox, then confirm in the dialog.",
  },
  risk_acknowledgement_modal: {
    isApplicable: () => isVisible("[data-tutorial='risk-ack-dialog']"),
    showNext: false,
    showSkip: false,
    autoAdvanceWhen: () => isVisible("[data-tutorial='risk-ack-complete']"),
    allowTargetInteraction: true,
    blockingModalSelector: "[data-tutorial='risk-ack-dialog']",
    waitingMessage: "Tap Acknowledge Risks to continue.",
  },
  travel_mileage: {
    isApplicable: () => isVisible("[data-tutorial='shift-travel-mileage']"),
    showNext: true,
    showSkip: true,
    allowTargetInteraction: true,
  },
  travel_transit: {
    isApplicable: () => isVisible("[data-tutorial='shift-travel-transit']"),
    showNext: true,
    showSkip: true,
    allowTargetInteraction: true,
  },
  clock_in: {
    isApplicable: () => {
      if (clockInComplete()) return false;
      if (!isVisible("[data-tutorial='clock-in']")) return false;
      if (isVisible("[data-tutorial='risk-ack-checkbox']")) return false;
      return true;
    },
    showNext: false,
    showSkip: true,
    autoAdvanceWhen: () => clockInModalOpen(),
    allowTargetInteraction: true,
    waitingMessage: "Tap Clock In to open the check-in dialog.",
  },
  clock_in_modal: {
    isApplicable: () => clockInModalOpen() && !clockInComplete(),
    showNext: true,
    showSkip: true,
    autoAdvanceWhen: () =>
      clockInComplete() && !clockInModalOpen() && !isVisible("[data-tutorial='clock-in-error']"),
    allowTargetInteraction: true,
    blockingModalSelector: "[data-tutorial='clock-in-modal']",
    waitingMessage: "Choose GPS or QR, then tap Confirm check-in.",
  },
  start_session: {
    isApplicable: () =>
      !isVisible("[data-tutorial='live-progress-note']") && isVisible("[data-tutorial='start-session']"),
    showNext: false,
    showSkip: true,
    autoAdvanceWhen: () =>
      SHIFT_LIVE_PROGRESS_NOTE_ENABLED
        ? isVisible("[data-tutorial='live-progress-note']")
        : isVisible("[data-tutorial='end-shift']") || isVisible("[data-tutorial='shift-task-checklist']"),
    allowTargetInteraction: true,
    waitingMessage: "Tap Start Session when you are clocked in.",
  },
  session_notes: {
    isApplicable: () =>
      SHIFT_LIVE_PROGRESS_NOTE_ENABLED
      && isVisible("[data-tutorial='session-notes']")
      && !isVisible("[data-tutorial='live-progress-note']"),
    showNext: false,
    showSkip: true,
    autoAdvanceWhen: () => isVisible("[data-tutorial='live-progress-note']"),
    allowTargetInteraction: true,
    waitingMessage: "Tap Notes to open the live progress panel.",
  },
  task_evidence: {
    isApplicable: () =>
      isVisible("[data-tutorial='shift-task-checklist']") || isVisible("[data-tutorial='task-evidence']"),
    showNext: true,
    showSkip: true,
    allowTargetInteraction: true,
    canProceed: () =>
      isVisible("[data-tutorial='task-evidence-panel-open']")
      && document.body.getAttribute("data-tutorial-task-evidence-ready") === "1",
    waitingMessage:
      "Review the goal-linked checklist — a task row will open automatically. Tap Next when you are ready.",
  },
  evidence_attach: {
    isApplicable: () =>
      isVisible("[data-tutorial='task-evidence-panel']")
      || isVisible("[data-tutorial='task-evidence-panel-open']")
      || isVisible("[data-tutorial='task-evidence-actions']"),
    showNext: true,
    showSkip: true,
    allowTargetInteraction: true,
    waitingMessage:
      "Type a note (20+ characters) and press Enter, or attach photo/voice. Tap Next when saved, or Skip to continue.",
  },
  end_shift: {
    isApplicable: () => isVisible("[data-tutorial='end-shift']"),
    showNext: true,
    showSkip: true,
    allowTargetInteraction: true,
    waitingMessage: "Tap End Shift to open the validation summary.",
  },
  end_shift_review: {
    isApplicable: () => isVisible("[data-tutorial='end-shift-review']"),
    showNext: true,
    showSkip: true,
    allowTargetInteraction: true,
    blockingModalSelector: "[data-tutorial='end-shift-review']",
    waitingMessage: "Review the summary, then tap End Shift to continue to sign-off.",
  },
  shift_signature: {
    isApplicable: () => isVisible("[data-tutorial='shift-signature']"),
    showNext: true,
    showSkip: true,
    autoAdvanceWhen: () => hasTutorialMarker("[data-tutorial='shift-signature-complete']"),
    allowTargetInteraction: true,
    blockingModalSelector: "[data-tutorial='shift-signature']",
    waitingMessage: "Tick all three statements, sign, then tap Confirm signature.",
  },
};

export function getTutorialGate(stepKey: TutorialStepKey): TutorialGate | null {
  return GATES[stepKey] ?? null;
}

function resolveGateFlag(
  value: boolean | (() => boolean) | undefined,
  fallback: boolean,
): boolean {
  if (value === undefined) return fallback;
  return typeof value === "function" ? value() : value;
}

export function tutorialShowNext(step: TutorialStep): boolean {
  const gate = getTutorialGate(step.key);
  return resolveGateFlag(gate?.showNext, step.showNext ?? true);
}

export function tutorialShowSkip(step: TutorialStep): boolean {
  const gate = getTutorialGate(step.key);
  return resolveGateFlag(gate?.showSkip, step.showSkip ?? true);
}

export function isTutorialStepApplicable(step: TutorialStep): boolean {
  const gate = getTutorialGate(step.key);
  if (!gate?.isApplicable) return true;
  return gate.isApplicable();
}

const TUTORIAL_PROTECTED_STEPS: ReadonlySet<TutorialStepKey> = new Set([
  "risk_acknowledgement",
  "risk_acknowledgement_modal",
  "end_shift",
  "end_shift_review",
  "shift_signature",
]);

/** Steps with a visible Next button should show the guide even if the target is still loading. */
export function shouldAutoSkipMissingTutorialTarget(step: TutorialStep): boolean {
  if (TUTORIAL_PROTECTED_STEPS.has(step.key)) return false;
  return !tutorialShowNext(step);
}

/** Optional middle steps (e.g. session_notes when Notes panel is already open). */
export function shouldAutoSkipStepInAdvance(step: TutorialStep): boolean {
  if (step.key === "session_notes" && !SHIFT_LIVE_PROGRESS_NOTE_ENABLED) return true;
  if (TUTORIAL_PROTECTED_STEPS.has(step.key)) return false;
  const gate = getTutorialGate(step.key);
  if (!gate?.isApplicable) return false;
  return !gate.isApplicable();
}

/** Never chain-skip protected steps when the target is not visible yet. */
export function shouldSkipInapplicableTutorialStep(step: TutorialStep): boolean {
  if (step.key === "session_notes" && !SHIFT_LIVE_PROGRESS_NOTE_ENABLED) return true;
  if (TUTORIAL_PROTECTED_STEPS.has(step.key)) return false;
  const gate = getTutorialGate(step.key);
  if (!gate?.isApplicable) return false;
  return !gate.isApplicable();
}

export function getNextTutorialStepIndex(current: number, steps: TutorialStep[]): number | null {
  for (let index = current + 1; index < steps.length; index += 1) {
    if (isTutorialStepApplicable(steps[index])) return index;
  }
  return null;
}

export function resolveTutorialStartIndex(
  requested: number,
  steps: TutorialStep[],
  topicKey?: TutorialStepKey,
): number {
  if (topicKey) {
    const topicIndex = steps.findIndex((step) => step.key === topicKey);
    if (topicIndex >= 0) {
      if (isTutorialStepApplicable(steps[topicIndex])) return topicIndex;
      const next = getNextTutorialStepIndex(topicIndex - 1, steps);
      if (next !== null) return next;
    }
  }
  for (let index = Math.max(0, requested); index < steps.length; index += 1) {
    if (isTutorialStepApplicable(steps[index])) return index;
  }
  return Math.max(0, requested);
}

/** First incomplete step, skipping steps already done in the real UI (e.g. already clocked in). */
export function resolveTutorialResumeIndex(
  progress: TutorialProgress,
  steps: TutorialStep[] = WORKER_TUTORIAL_STEPS,
): number {
  for (let index = 0; index < steps.length; index += 1) {
    if (progress.steps[steps[index].key]) continue;
    const resolved = resolveTutorialStartIndex(index, steps);
    if (resolved >= steps.length) return steps.length;
    if (isTutorialStepApplicable(steps[resolved])) return resolved;
    // UI already past this step — keep scanning for the next incomplete one.
  }
  return steps.length;
}

export function tutorialGateWaitingMessage(step: TutorialStep): string | null {
  const gate = getTutorialGate(step.key);
  if (!tutorialShowNext(step)) {
    return gate?.waitingMessage ?? "Complete the highlighted action to continue.";
  }
  if (!gate?.canProceed || gate.canProceed()) return null;
  return gate.waitingMessage ?? "Complete the highlighted action to continue.";
}

export function tutorialCanProceed(step: TutorialStep): boolean {
  const gate = getTutorialGate(step.key);
  if (!gate?.canProceed) return true;
  return gate.canProceed();
}

/** After Skip hides the overlay, advance when the worker completes the real UI flow. */
export function shouldAdvanceFromDismissedStep(stepIndex: number): boolean {
  const step = WORKER_TUTORIAL_STEPS[stepIndex];
  if (!step) return false;

  // End-shift steps advance explicitly via End Shift / validation / signature handlers.
  if (step.key === "end_shift" || step.key === "end_shift_review") return false;

  const gate = getTutorialGate(step.key);
  if (gate?.autoAdvanceWhen?.()) return true;

  const nextIndex = getNextTutorialStepIndex(stepIndex, WORKER_TUTORIAL_STEPS);
  if (nextIndex === null) return false;
  const nextGate = getTutorialGate(WORKER_TUTORIAL_STEPS[nextIndex].key);
  // Only when the next step's screen/modal is actually open — not global nav icons.
  if (nextGate?.isApplicable) return nextGate.isApplicable();
  return false;
}

/** Wait until shift detail (or list) DOM is ready so gate checks reflect real UI state. */
export async function waitForShiftTutorialReady(shiftId: string | null, maxMs = 8000): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (document.querySelector("[data-tutorial='shift-workspace']")) return;
    if (!shiftId && document.querySelector("[data-tutorial='shift-list']")) return;
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
}

export function isTutorialBlockingModalOpen(step: TutorialStep): boolean {
  const selector = getTutorialGate(step.key)?.blockingModalSelector;
  if (!selector) return isAnyTutorialModalOpen();
  const nodes = document.querySelectorAll(selector);
  for (const node of nodes) {
    const state = node.getAttribute("data-state");
    if (state === "closed") continue;
    const rect = node.getBoundingClientRect();
    if (rect.width < 2 && rect.height < 2) continue;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (Number(style.opacity) <= 0.05) continue;
    return true;
  }
  return isAnyTutorialModalOpen();
}

function isAnyTutorialModalOpen(): boolean {
  for (const selector of ["[data-tutorial='end-shift-review']", "[data-tutorial='shift-signature']"]) {
    const nodes = document.querySelectorAll(selector);
    for (const node of nodes) {
      const state = node.getAttribute("data-state");
      if (state === "closed") continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 2 && rect.height < 2) continue;
      const style = window.getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") continue;
      if (Number(style.opacity) <= 0.05) continue;
      return true;
    }
  }
  return false;
}

export function isTutorialEndShiftFlowModalOpen(): boolean {
  return isAnyTutorialModalOpen();
}
