export type TutorialStepKey =
  | "shift_list"
  | "open_shift"
  | "shift_overview"
  | "risk_acknowledgement"
  | "risk_acknowledgement_modal"
  | "clock_in"
  | "clock_in_modal"
  | "start_session"
  | "task_evidence"
  | "evidence_attach"
  | "session_notes"
  | "end_shift"
  | "end_shift_review"
  | "shift_signature"
  | "notifications";

export type TutorialStep = {
  key: TutorialStepKey;
  title: string;
  body: string;
  target: string;
  fallbackTarget?: string;
  requiresShift?: boolean;
  popoverSide?: "top" | "bottom" | "left" | "right" | "over";
  popoverAlign?: "start" | "center" | "end";
  /** Show the popover Next button (default true). Set false when the UI action should advance. */
  showNext?: boolean;
  /** Show the popover Skip button (default true). */
  showSkip?: boolean;
};

export const WORKER_TUTORIAL_STEPS: TutorialStep[] = [
  {
    key: "shift_list",
    title: "Your shift list",
    body: "Today's shifts appear here. Use the tabs to switch between Today, Upcoming, and Completed.",
    target: "[data-tutorial='shift-list']",
    popoverSide: "bottom",
    popoverAlign: "start",
    showSkip: false,
  },
  {
    key: "open_shift",
    title: "Open a shift",
    body: "Tap a shift card to expand details, then use Start Session or open the shift workspace from the actions inside.",
    target: "[data-tutorial='shift-card-open']",
    fallbackTarget: "[data-tutorial='shift-list']",
    popoverSide: "bottom",
    popoverAlign: "start",
    showSkip: false,
  },
  {
    key: "shift_overview",
    title: "Shift progress",
    body: "Track where you are: Review → Arrive → Active → End → Submit. The stepper updates as you clock in and run the session.",
    target: "[data-tutorial='shift-progress']",
    fallbackTarget: "[data-tutorial='shift-header']",
    requiresShift: true,
    popoverSide: "bottom",
  },
  {
    key: "risk_acknowledgement",
    title: "Acknowledge safety alerts",
    body: "Before clock-in, read the alerts above, then tick this checkbox and confirm in the dialog.",
    target: "[data-tutorial='risk-ack-checkbox']",
    requiresShift: true,
    popoverSide: "top",
    popoverAlign: "center",
    showNext: true,
    showSkip: false,
  },
  {
    key: "risk_acknowledgement_modal",
    title: "Acknowledge safety alerts",
    body: "Before clock-in, confirm you have read and understand all safety alerts for this participant.",
    target: "[data-tutorial='risk-ack-dialog']",
    requiresShift: true,
    popoverSide: "top",
    popoverAlign: "center",
    showNext: false,
    showSkip: false,
  },
  {
    key: "clock_in",
    title: "Clock in on arrival",
    body: "When you reach the participant, tap Clock In. This opens a check-in dialog to confirm your location.",
    target: "[data-tutorial='clock-in']",
    fallbackTarget: "[data-tutorial='shift-header']",
    requiresShift: true,
    popoverSide: "top",
    showNext: false,
    showSkip: false,
  },
  {
    key: "clock_in_modal",
    title: "GPS or QR check-in",
    body: "Choose GPS (uses your phone location) or scan the participant's QR code, then confirm before submitting.",
    target: "[data-tutorial='clock-in-modal']",
    requiresShift: true,
    popoverSide: "right",
    showNext: true,
    showSkip: false,
  },
  {
    key: "start_session",
    title: "Start the session",
    body: "After clock-in, tap Start Session to begin documenting tasks and progress notes for this visit.",
    target: "[data-tutorial='start-session']",
    fallbackTarget: "[data-tutorial='shift-progress']",
    requiresShift: true,
    popoverSide: "top",
    showNext: false,
    showSkip: true,
  },
  {
    key: "task_evidence",
    title: "Goal-linked tasks",
    body: "Complete checklist items for each NDIS goal. Tap a task row to expand it and record what you did.",
    target: "[data-tutorial='task-evidence']",
    fallbackTarget: "[data-tutorial='shift-task-checklist']",
    requiresShift: true,
    popoverSide: "right",
  },
  {
    key: "evidence_attach",
    title: "Attach evidence",
    body: "Use photo, voice, file, or notes to document the task. Strong evidence helps your compliance score.",
    target: "[data-tutorial='task-evidence-actions']",
    fallbackTarget: "[data-tutorial='task-evidence']",
    requiresShift: true,
    popoverSide: "left",
  },
  {
    key: "session_notes",
    title: "Live progress notes",
    body: "Tap Notes to open the live note panel. Type or dictate updates while you support the participant.",
    target: "[data-tutorial='session-notes']",
    fallbackTarget: "[data-tutorial='live-progress-note']",
    requiresShift: true,
    popoverSide: "top",
    showNext: false,
    showSkip: true,
  },
  {
    key: "end_shift",
    title: "End your shift",
    body: "When finished, tap End Shift. The app checks tasks and evidence before you sign off.",
    target: "[data-tutorial='end-shift']",
    requiresShift: true,
    popoverSide: "top",
    popoverAlign: "center",
    showNext: false,
    showSkip: true,
  },
  {
    key: "end_shift_review",
    title: "Shift validation",
    body: "Review completion stats and any tasks missing evidence. Add evidence, mark N/A, or continue to sign.",
    target: "[data-tutorial='end-shift-review']",
    requiresShift: true,
    popoverSide: "over",
    showNext: false,
    showSkip: true,
  },
  {
    key: "shift_signature",
    title: "Sign off",
    body: "Confirm the statements and sign with your finger. This locks the shift for compliance reporting.",
    target: "[data-tutorial='shift-signature']",
    requiresShift: true,
    popoverSide: "left",
    showNext: true,
    showSkip: true,
  },
  {
    key: "notifications",
    title: "Coordinator messages",
    body: "Coordinator updates and alerts appear in Notifications. Check here during your shift for important messages.",
    target: "[data-tutorial='worker-notifications']",
    popoverSide: "bottom",
    popoverAlign: "end",
    showSkip: false,
  },
];

export function tutorialStepRoute(step: TutorialStep, shiftId: string | null): string {
  const params = new URLSearchParams({ tutorial: "1", step: step.key });
  if (step.key === "notifications") {
    if (shiftId) return `/my-shifts/${shiftId}?${params}`;
    return `/my-shifts?${params}`;
  }
  if (!step.requiresShift) return `/my-shifts?${params}`;
  if (!shiftId) return `/my-shifts?${params}`;
  return `/my-shifts/${shiftId}?${params}`;
}

export function stepByKey(key: TutorialStepKey) {
  return WORKER_TUTORIAL_STEPS.find((step) => step.key === key);
}

function isElementVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 && rect.height < 2) return false;
  const style = window.getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.05;
}

function queryVisible(selector: string): Element | null {
  let best: Element | null = null;
  let bestArea = 0;
  for (const node of document.querySelectorAll(selector)) {
    if (!isElementVisible(node)) continue;
    const rect = node.getBoundingClientRect();
    const area = rect.width * rect.height;
    if (area > bestArea) {
      bestArea = area;
      best = node;
    }
  }
  return best;
}

export function scrollTutorialTargetIntoView(target: Element | null) {
  if (!target) return;
  target.scrollIntoView({ block: "center", inline: "nearest", behavior: "instant" });
}

export function findTutorialTarget(step: TutorialStep): Element | null {
  if (step.target) {
    const primary = queryVisible(step.target);
    if (primary) return primary;
  }
  if (step.fallbackTarget) {
    const fallback = queryVisible(step.fallbackTarget);
    if (fallback) return fallback;
  }
  return null;
}

export function tutorialRouteMatches(
  step: TutorialStep,
  shiftId: string | null,
  location: string,
): boolean {
  const [path, query = ""] = location.split("?");
  const params = new URLSearchParams(query);
  if (params.get("tutorial") !== "1") return false;
  if (params.get("step") !== step.key) return false;

  if (!step.requiresShift) {
    return path === "/my-shifts" || path.endsWith("/my-shifts");
  }
  if (step.key === "notifications") return true;
  if (!shiftId) return path === "/my-shifts" || path.endsWith("/my-shifts");
  return path === `/my-shifts/${shiftId}` || path.endsWith(`/my-shifts/${shiftId}`);
}

export async function waitForTutorialRoute(
  step: TutorialStep,
  shiftId: string | null,
  getLocation: () => string,
  maxMs = 5000,
): Promise<boolean> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (tutorialRouteMatches(step, shiftId, getLocation())) return true;
    await new Promise((resolve) => window.setTimeout(resolve, 80));
  }
  return tutorialRouteMatches(step, shiftId, getLocation());
}

export async function waitForTutorialTarget(
  step: TutorialStep,
  shiftId: string | null,
  getLocation: () => string,
  maxMs = 5000,
): Promise<Element | null> {
  await waitForTutorialRoute(step, shiftId, getLocation, maxMs);
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const el = findTutorialTarget(step);
    if (el) {
      el.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
      return el;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 100));
  }
  const el = findTutorialTarget(step);
  if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
  return el;
}

export function tutorialStepHelperText(
  step: TutorialStep,
  shiftId: string | null,
  targetMissing: boolean,
): string | null {
  if (!targetMissing) return null;
  if (step.requiresShift && !shiftId) {
    return "You don't have a shift scheduled yet. Skip this step or replay the tutorial after a shift is assigned.";
  }
  if (step.key === "open_shift") {
    return "No shifts are listed right now. Skip to preview the remaining steps.";
  }
  return "This control isn't visible for your current shift state. Tap Next to continue — you can replay this topic later from Help.";
}
