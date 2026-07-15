import type { Router } from "expo-router";

/** Go back when possible; otherwise land on Home (e.g. opened from a push notification). */
export function goBackOrHome(router: Pick<Router, "canGoBack" | "back" | "replace">): void {
  if (router.canGoBack()) {
    router.back();
    return;
  }
  router.replace("/(tabs)" as never);
}
