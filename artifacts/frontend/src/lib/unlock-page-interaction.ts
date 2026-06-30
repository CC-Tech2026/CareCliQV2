/** Clear stale modal / Radix scroll-lock state that can blank the worker shift page. */
export function unlockPageInteraction() {
  document.body.style.overflow = "";
  document.body.removeAttribute("data-scroll-locked");
  document.body.classList.remove(
    "ccq-tutorial-active",
    "ccq-tutorial-allow-interaction",
    "ccq-tutorial-modal-open",
    "driver-active",
  );

  const root = document.getElementById("root");
  root?.removeAttribute("aria-hidden");
  root?.removeAttribute("data-aria-hidden");

  document.querySelectorAll("main[aria-hidden='true']").forEach((el) => {
    el.removeAttribute("aria-hidden");
    el.removeAttribute("data-aria-hidden");
  });
}
