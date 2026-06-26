import { driver, type Driver } from "driver.js";
import {
  getTutorialGate,
  isTutorialBlockingModalOpen,
  tutorialCanProceed,
  tutorialGateWaitingMessage,
  tutorialShowNext,
  tutorialShowSkip,
} from "@/lib/worker-tutorial-gates";
import { confirmTutorialDismiss } from "@/lib/worker-tutorial-dismiss";
import { clearTutorialModalBlocking, setTutorialModalBlocking } from "@/lib/worker-tutorial-modal";
import {
  WORKER_TUTORIAL_STEPS,
  findTutorialTarget,
  scrollTutorialTargetIntoView,
  tutorialStepHelperText,
  waitForTutorialTarget,
  type TutorialStep,
} from "@/lib/worker-tutorial-steps";

export type TutorialDriverCallbacks = {
  onNext: () => void;
  onSkip: () => void;
  onClose: () => void;
};

const SKIP_BUTTON_SELECTOR = ".ccq-driver-popover .driver-popover-skip-btn";

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

function getNavigationFooter(): HTMLElement | null {
  return document.querySelector(".ccq-driver-popover .driver-popover-navigation-btns");
}

function targetRectKey(el: Element | null): string {
  if (!el) return "";
  const rect = el.getBoundingClientRect();
  return `${Math.round(rect.top)}|${Math.round(rect.left)}|${Math.round(rect.width)}|${Math.round(rect.height)}`;
}

function setNextEnabled(nextButton: HTMLButtonElement | null | undefined, enabled: boolean) {
  if (!nextButton) return;
  nextButton.disabled = !enabled;
  nextButton.classList.toggle("ccq-driver-next-disabled", !enabled);
  nextButton.style.opacity = enabled ? "" : "0.45";
  nextButton.style.pointerEvents = enabled ? "" : "none";
}

function setNextVisible(nextButton: HTMLButtonElement | null | undefined, visible: boolean) {
  if (!nextButton) return;
  nextButton.style.display = visible ? "" : "none";
}

function setTutorialBodyClasses(options: {
  active: boolean;
  allowInteraction: boolean;
  modalOpen: boolean;
}) {
  document.body.classList.toggle("ccq-tutorial-active", options.active);
  document.body.classList.toggle("ccq-tutorial-allow-interaction", options.active && options.allowInteraction);
  document.body.classList.toggle("ccq-tutorial-modal-open", options.active && options.modalOpen);
}

function clearTutorialBodyClasses() {
  document.body.classList.remove(
    "ccq-tutorial-active",
    "ccq-tutorial-allow-interaction",
    "ccq-tutorial-modal-open",
  );
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
  let skipRequested = false;
  let lastPositionKey = "";
  let activeDriverRef: Driver | null = null;

  const teardown = () => {
    if (pollTimer !== null) window.clearInterval(pollTimer);
    pollTimer = null;
    document.removeEventListener("click", onDocumentClick, true);
    window.removeEventListener("resize", onLayoutChange);
    clearTutorialModalBlocking();
    clearTutorialBodyClasses();
  };

  const finishSkip = () => {
    if (skipRequested || autoAdvanced) return;
    skipRequested = true;
    intentionalDestroy = true;
    teardown();
    callbacks.onSkip();
  };

  const destroyDriver = (activeDriver: Driver) => {
    intentionalDestroy = true;
    teardown();
    activeDriver.destroy();
  };

  const requestTutorialClose = (activeDriver: Driver) => {
    if (!confirmTutorialDismiss()) return;
    destroyDriver(activeDriver);
    callbacks.onClose();
  };

  const resolveTarget = () => findTutorialTarget(step) ?? options.target;

  const ensureSkipButton = (): HTMLButtonElement | null => {
    const footer = getNavigationFooter();
    if (!footer) return null;

    let skipButton = footer.querySelector<HTMLButtonElement>(".driver-popover-skip-btn");
    if (!skipButton) {
      skipButton = document.createElement("button");
      skipButton.type = "button";
      skipButton.textContent = "Skip";
      skipButton.className = "driver-popover-skip-btn";
      footer.insertBefore(skipButton, footer.firstChild);
    }
    return skipButton;
  };

  const syncPopoverChrome = (popover: {
    description?: HTMLElement;
    nextButton?: HTMLButtonElement;
  }) => {
    const skipEl = ensureSkipButton();
    const showNext = tutorialShowNext(step);
    const showSkip = tutorialShowSkip(step);
    setNextVisible(popover.nextButton, showNext);
    if (skipEl) skipEl.style.display = showSkip ? "" : "none";
    if (showNext) setNextEnabled(popover.nextButton, tutorialCanProceed(step));

    const nextTarget = resolveTarget();
    if (popover.description) {
      popover.description.textContent = buildDescription(step, shiftId, nextTarget);
    }
    return nextTarget;
  };

  const maybeReposition = (activeDriver: Driver, target: Element | null) => {
    if (!target || isTutorialBlockingModalOpen(step)) return;
    const key = targetRectKey(target);
    if (key === lastPositionKey) return;
    lastPositionKey = key;
    try {
      activeDriver.refresh();
      ensureSkipButton();
    } catch {
      /* noop */
    }
  };

  const onDocumentClick = (event: Event) => {
    const target = event.target as Element | null;
    if (!target?.closest(SKIP_BUTTON_SELECTOR)) return;
    event.preventDefault();
    event.stopPropagation();
    finishSkip();
  };

  const onLayoutChange = () => {
    if (!activeDriverRef || skipRequested || autoAdvanced) return;
    lastPositionKey = "";
    const target = resolveTarget();
    maybeReposition(activeDriverRef, target);
    const popover = document.querySelector(".ccq-driver-popover");
    if (popover) {
      const nextBtn = popover.querySelector<HTMLButtonElement>(".driver-popover-next-btn");
      const description = popover.querySelector<HTMLElement>(".driver-popover-description");
      syncPopoverChrome({ nextButton: nextBtn ?? undefined, description: description ?? undefined });
    }
  };

  const driverObj = driver({
    animate: true,
    allowClose: true,
    allowKeyboardControl: false,
    overlayClickBehavior: () => {
      /* Block backdrop dismiss — close only via the X button with confirmation. */
    },
    smoothScroll: false,
    stagePadding: 8,
    stageRadius: 10,
    popoverOffset: 20,
    overlayOpacity: 0.55,
    disableActiveInteraction: !allowInteraction,
    popoverClass: "ccq-driver-popover",
    showProgress: true,
    progressText: `${stepIndex + 1} of ${WORKER_TUTORIAL_STEPS.length}`,
    showButtons: ["next", "close"],
    nextBtnText: "Next",
    doneBtnText: isTourComplete ? "Done" : "Next",
    steps: [
      {
        element: () => resolveTarget() ?? options.target ?? document.body,
        popover: {
          title: step.title,
          description: buildDescription(step, shiftId, options.target),
          side: step.popoverSide ?? "bottom",
          align: step.popoverAlign ?? "start",
          onPopoverRender: (popover, { driver: activeDriver }) => {
            activeDriverRef = activeDriver;
            scrollTutorialTargetIntoView(resolveTarget());

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

            const poll = () => {
              if (autoAdvanced || skipRequested) return;

              const modalOpen = isTutorialBlockingModalOpen(step);
              setTutorialBodyClasses({ active: true, allowInteraction, modalOpen });
              setTutorialModalBlocking(modalOpen);

              const nextTarget = syncPopoverChrome(popover);
              maybeReposition(activeDriver, nextTarget);

              if (gate?.autoAdvanceWhen?.()) {
                autoAdvanced = true;
                destroyDriver(activeDriver);
                callbacks.onNext();
              }
            };

            ensureSkipButton();
            poll();
            pollTimer = window.setInterval(poll, 500);
          },
        },
      },
    ],
    onNextClick: (_element, _step, { driver: activeDriver }) => {
      if (!tutorialShowNext(step) || !tutorialCanProceed(step)) return;
      destroyDriver(activeDriver);
      callbacks.onNext();
    },
    onCloseClick: (_element, _step, { driver: activeDriver }) => {
      requestTutorialClose(activeDriver);
    },
    onDestroyStarted: (_element, _step, { driver: activeDriver }) => {
      if (intentionalDestroy || skipRequested) return;
      if (!confirmTutorialDismiss()) {
        activeDriver.drive();
        return;
      }
      intentionalDestroy = true;
      teardown();
      callbacks.onClose();
    },
    onDestroyed: () => {
      activeDriverRef = null;
      teardown();
    },
  });

  document.addEventListener("click", onDocumentClick, true);
  window.addEventListener("resize", onLayoutChange);

  const launchTarget = resolveTarget();
  scrollTutorialTargetIntoView(launchTarget);
  setTutorialBodyClasses({ active: true, allowInteraction, modalOpen: false });
  driverObj.drive();
  activeDriverRef = driverObj;
  return driverObj;
}

export function destroyTutorialDriver(driverRef: Driver | null) {
  try {
    driverRef?.destroy();
  } catch {
    /* noop */
  }
  document
    .querySelectorAll(".driver-overlay, .driver-popover, .driver-active-element")
    .forEach((node) => node.remove());
  clearTutorialModalBlocking();
  clearTutorialBodyClasses();
}
