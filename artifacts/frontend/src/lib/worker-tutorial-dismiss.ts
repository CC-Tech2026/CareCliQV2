export function confirmTutorialDismiss(): boolean {
  return window.confirm(
    "Exit the worker tutorial?\n\nYou can replay it anytime from Help → Tutorial.",
  );
}
