/** Shared helpers for keeping tutorial chrome from blocking modal confirm buttons. */

export function setTutorialModalBlocking(blocking: boolean) {
  document.body.classList.toggle("ccq-tutorial-modal-open", blocking);

  for (const el of document.querySelectorAll(".driver-overlay, .driver-popover")) {
    const node = el as HTMLElement;
    if (blocking) {
      node.style.setProperty("pointer-events", "none", "important");
      node.style.setProperty("z-index", "40", "important");
      if (node.classList.contains("driver-popover")) {
        node.style.setProperty("display", "none", "important");
      }
      continue;
    }
    node.style.removeProperty("pointer-events");
    node.style.removeProperty("z-index");
    if (node.classList.contains("driver-popover")) {
      node.style.removeProperty("display");
    }
  }
}

export function clearTutorialModalBlocking() {
  setTutorialModalBlocking(false);
}
