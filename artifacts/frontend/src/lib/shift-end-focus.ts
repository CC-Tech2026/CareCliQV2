export function shiftTaskDomId(taskId: string) {
  return `shift-task-${taskId}`;
}

export function mobileShiftTaskDomId(taskId: string) {
  return `wm-shift-task-${taskId}`;
}

function focusFirstInteractive(container: HTMLElement | null) {
  if (!container) return;
  const focusable = container.querySelector<HTMLElement>(
    'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  focusable?.focus({ preventScroll: true });
}

export function scrollToShiftValidationTarget(options: {
  taskId?: string | null;
  sectionId?: string;
  onBeforeScroll?: () => void;
}) {
  const { taskId, sectionId = "shift-task-checklist", onBeforeScroll } = options;
  onBeforeScroll?.();
  requestAnimationFrame(() => {
    const target = taskId
      ? document.getElementById(shiftTaskDomId(taskId))
      : document.getElementById(sectionId);
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => focusFirstInteractive(target), 350);
  });
}

export function scrollToMobileShiftTask(taskId: string, onBeforeScroll?: () => void) {
  onBeforeScroll?.();
  requestAnimationFrame(() => {
    const target = document.getElementById(mobileShiftTaskDomId(taskId));
    target?.scrollIntoView({ behavior: "smooth", block: "center" });
    window.setTimeout(() => focusFirstInteractive(target), 350);
  });
}
