import { driver, type Driver } from "driver.js";
import {
  getTutorialGate,
  tutorialCanProceed,
  tutorialGateWaitingMessage,
} from "@/lib/worker-tutorial-gates";
import { confirmTutorialDismiss } from "@/lib/worker-tutorial-dismiss";
import {
  WORKER_TUTORIAL_STEPS,
  findTutorialTarget,
  tutorialStepHelperText,
  waitForTutorialTarget,
  type TutorialStep,
} from "@/lib/worker-tutorial-steps";

export type TutorialDriverCallbacks = {
  onNext: () => void;
  onSkip: () => void;
  onClose: () => void;
};

export async function waitForTutorialStepReady(
  step: TutorialStep,
  shiftId: string | null,
  getLocation: () => string,
  maxMs = 8000,
): Promise<Element | null> {
  const gate = getTutorialGate(step.key);
  if (gate?.isApplicable && !gate.isApplicable()) {
    return null;
  }
  return waitForTutorialTarget(step, shiftId, getLocation, maxMs);
}

function buildDescription(step: TutorialStep, shiftId: string | null, target: Element | null): string {
  const parts: string[] = [step.body];
  const waiting = tutorialGateWaitingMessage(step);
  if (waiting) parts.push(waiting);
  const helper = tutorialStepHelperText(step, shiftId, !target);
  if (helper) parts.push(helper);
  return parts.join("\n\n");
}

function setNextEnabled(nextButton: HTMLButtonElement | null | undefined, enabled: boolean) {
  if (!nextButton) return;
  nextButton.disabled = !enabled;
  nextButton.classList.toggle("ccq-driver-next-disabled", !enabled);
  nextButton.style.opacity = enabled ? "" : "0.45";
  nextButton.style.pointerEvents = enabled ? "" : "none";
}

export function launchTutorialStep(options: {
  step: TutorialStep;
  stepIndex: number;
  shiftId: string | null;
  target: Element | null;
  callbacks: TutorialDriverCallbacks;
}): Driver {
  const { step, stepIndex, shiftId, callbacks } = options;
  const isTourComplete = stepIndex === WORKER_TUTORIAL_STEPS.length - 1;
  const gate = getTutorialGate(step.key);
  const allowInteraction = gate?.allowTargetInteraction ?? false;
  let pollTimer: number | null = null;
  let autoAdvanced = false;
  let intentionalDestroy = false;

  const destroyDriver = (activeDriver: Driver) => {
    intentionalDestroy = true;
    if (pollTimer !== null) window.clearInterval(pollTimer);
    activeDriver.destroy();
  };

  const requestTutorialClose = (activeDriver: Driver) => {
    if (!confirmTutorialDismiss()) return;
    destroyDriver(activeDriver);
    callbacks.onClose();
  };

  const resolveTarget = () => findTutorialTarget(step);

  const driverObj = driver({
    animate: true,
    allowClose: true,
    allowKeyboardControl: false,
    overlayClickBehavior: () => {
      /* Block backdrop dismiss — close only via the X button with confirmation. */
    },
    smoothScroll: true,
    stagePadding: 8,
    stageRadius: 10,
    overlayOpacity: 0.55,
    disableActiveInteraction: !allowInteraction,
    popoverClass: "ccq-driver-popover",
    showProgress: true,
    progressText: `${stepIndex + 1} of ${WORKER_TUTORIAL_STEPS.length}`,
    showButtons: ["next", "close"],
    nextBtnText: "Next",
    doneBtnText: isTourComplete ? "Done" : "Next",
    closeBtnText: "Close",
    steps: [
      {
        element: () => resolveTarget() ?? undefined,
        popover: {
          title: step.title,
          description: buildDescription(step, shiftId, options.target),
          side: (() => {
            const el = resolveTarget();
            return el ? (step.popoverSide ?? "bottom") : "over";
          })(),
          align: step.popoverAlign ?? "start",
          onPopoverRender: (popover, { driver: activeDriver }) => {
            if (popover.progress) {
              popover.progress.textContent = `Step ${stepIndex + 1} of ${WORKER_TUTORIAL_STEPS.length}`;
            }

            if (popover.closeButton) {
              popover.closeButton.onclick = (event) => {
                event.preventDefault();
                event.stopPropagation();
                requestTutorialClose(activeDriver);
              };
            }

            const skip = document.createElement("button");
            skip.type = "button";
            skip.textContent = "Skip";
            skip.className = "driver-popover-skip-btn";
            skip.addEventListener("click", (event) => {
              event.preventDefault();
              event.stopPropagation();
              destroyDriver(activeDriver);
              callbacks.onSkip();
            });
            popover.footerButtons.insertBefore(skip, popover.footerButtons.firstChild);

            const refresh = () => {
              if (autoAdvanced) return;

              const nextTarget = resolveTarget();
              if (nextTarget) {
                try {
                  activeDriver.refresh();
                } catch {
                  /* noop */
                }
              }

              const canProceed = tutorialCanProceed(step);
              setNextEnabled(popover.nextButton, canProceed);

              if (popover.description) {
                popover.description.textContent = buildDescription(step, shiftId, nextTarget);
              }

              if (gate?.autoAdvanceWhen?.() && canProceed) {
                autoAdvanced = true;
                destroyDriver(activeDriver);
                callbacks.onNext();
              }
            };

            setNextEnabled(popover.nextButton, tutorialCanProceed(step));
            refresh();
            pollTimer = window.setInterval(refresh, 400);
          },
        },
      },
    ],
    onNextClick: (_element, _step, { driver: activeDriver }) => {
      if (!tutorialCanProceed(step)) return;
      destroyDriver(activeDriver);
      callbacks.onNext();
    },
    onCloseClick: (_element, _step, { driver: activeDriver }) => {
      requestTutorialClose(activeDriver);
    },
    onDestroyStarted: (_element, _step, { driver: activeDriver }) => {
      if (intentionalDestroy) return;
      if (!confirmTutorialDismiss()) {
        activeDriver.drive();
        return;
      }
      intentionalDestroy = true;
      if (pollTimer !== null) window.clearInterval(pollTimer);
      callbacks.onClose();
    },
    onDestroyed: () => {
      if (pollTimer !== null) window.clearInterval(pollTimer);
      document.body.classList.remove("ccq-tutorial-active");
    },
  });

  document.body.classList.add("ccq-tutorial-active");
  driverObj.drive();
  return driverObj;
}

export function destroyTutorialDriver(driverRef: Driver | null) {
  try {
    driverRef?.destroy();
  } catch {
    /* noop */
  }
  document.body.classList.remove("ccq-tutorial-active");
}
