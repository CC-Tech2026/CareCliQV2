import type { Router } from "expo-router";

type NavRouter = Pick<Router, "canGoBack" | "back" | "replace">;

/** Go back when possible; otherwise land on Home (e.g. opened from a push notification). */
export function goBackOrHome(router: NavRouter): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace("/(tabs)" as never);
}

/** Shift detail root: always return to My Shifts list. */
export function goBackToShifts(router: NavRouter): void {
  router.replace("/(tabs)/shifts" as never);
}

/** Notifications (and similar): always return to Home. */
export function goBackToHome(router: NavRouter): void {
  router.replace("/(tabs)" as never);
}
