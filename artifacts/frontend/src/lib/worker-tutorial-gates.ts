import type { TutorialStep, TutorialStepKey } from "@/lib/worker-tutorial-steps";

export type TutorialGate = {
  /** Skip this step when false (e.g. no risk alerts on shift). */
  isApplicable?: () => boolean;
  /** Disable Next until the worker completes the required action. */
  canProceed?: () => boolean;
  /** Move on automatically once the condition is met (after user clicks the target). */
  autoAdvanceWhen?: () => boolean;
  /** Let clicks reach the highlighted control under the overlay. */
  allowTargetInteraction?: boolean;
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

function signatureModalReady(): boolean {
  const modal = document.querySelector("[data-tutorial='shift-signature']");
  if (!modal) return false;
  const checks = modal.querySelectorAll('button[role="checkbox"]');
  if (checks.length < 3) return false;
  return Array.from(checks).every((node) => node.getAttribute("data-state") === "checked");
}

const GATES: Partial<Record<TutorialStepKey, TutorialGate>> = {
  risk_acknowledgement: {
    isApplicable: () => isVisible("[data-tutorial='risk-ack-checkbox']"),
    canProceed: () => isVisible("[data-tutorial='risk-ack-complete']"),
    autoAdvanceWhen: () => isVisible("[data-tutorial='risk-ack-complete']"),
    allowTargetInteraction: true,
    waitingMessage: "Tick the checkbox, then confirm in the dialog. The tutorial continues when acknowledgement is logged.",
  },
  clock_in: {
    canProceed: () => isVisible("[data-tutorial='clock-in-modal']"),
    autoAdvanceWhen: () => isVisible("[data-tutorial='clock-in-modal']"),
    allowTargetInteraction: true,
    waitingMessage: "Tap Clock In to open the check-in dialog. The tutorial continues when it opens.",
  },
  clock_in_modal: {
    isApplicable: () => isVisible("[data-tutorial='clock-in-modal']"),
    canProceed: () => isVisible("[data-tutorial='clock-in-modal']"),
    allowTargetInteraction: true,
    waitingMessage: "Review GPS and QR options in the dialog, then tap Next.",
  },
  start_session: {
    allowTargetInteraction: true,
    waitingMessage: "When you are clocked in, tap Start Session. Tap Next if this button is not shown yet.",
  },
  session_notes: {
    canProceed: () =>
      isVisible("[data-tutorial='live-progress-note']") || !isVisible("[data-tutorial='session-notes']"),
    autoAdvanceWhen: () => isVisible("[data-tutorial='live-progress-note']"),
    allowTargetInteraction: true,
    waitingMessage: "Tap Notes to open the live progress panel. The tutorial continues when it opens.",
  },
  end_shift: {
    allowTargetInteraction: true,
    waitingMessage: "Tap End Shift when your session is active. Tap Next if you are previewing an earlier stage.",
  },
  end_shift_review: {
    isApplicable: () => isVisible("[data-tutorial='end-shift-review']"),
    canProceed: () => isVisible("[data-tutorial='end-shift-review']"),
    allowTargetInteraction: true,
    waitingMessage: "Review the validation summary, then tap Next.",
  },
  shift_signature: {
    isApplicable: () => isVisible("[data-tutorial='shift-signature']"),
    canProceed: () => signatureModalReady(),
    allowTargetInteraction: true,
    waitingMessage: "Tick all three statements in the modal, then tap Next (signing is optional in the tutorial).",
  },
};

export function getTutorialGate(stepKey: TutorialStepKey): TutorialGate | null {
  return GATES[stepKey] ?? null;
}

export function isTutorialStepApplicable(step: TutorialStep): boolean {
  const gate = getTutorialGate(step.key);
  if (!gate?.isApplicable) return true;
  return gate.isApplicable();
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

export function tutorialGateWaitingMessage(step: TutorialStep): string | null {
  const gate = getTutorialGate(step.key);
  if (!gate?.canProceed || gate.canProceed()) return null;
  return gate.waitingMessage ?? "Complete the highlighted action to continue.";
}

export function tutorialCanProceed(step: TutorialStep): boolean {
  const gate = getTutorialGate(step.key);
  if (!gate?.canProceed) return true;
  return gate.canProceed();
}
