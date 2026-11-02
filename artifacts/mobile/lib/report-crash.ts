import Constants from "expo-constants";
import { Platform } from "react-native";

import { getMobileApiBaseUrl } from "@/lib/api-base-url";
import { readMobileAuthToken } from "@/lib/session";

/**
 * Send a crash caught by the root ErrorBoundary to POST /api/client-errors,
 * which logs it on the server (nothing is stored). Without this, the
 * "Something went wrong" screen left no trace anywhere.
 *
 * Plain fetch rather than workerFetch: a report must never trigger the
 * sign-out that workerFetch does on a 401, and a failed report is ignored.
 */
export function reportCrash(error: Error, componentStack?: string): void {
  void (async () => {
    try {
      const base = getMobileApiBaseUrl();
      if (!base) return;
      const token = await readMobileAuthToken().catch(() => null);
      const version = Constants.expoConfig?.version ?? Constants.nativeAppVersion ?? "unknown";
      await fetch(`${base}/api/client-errors`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          kind: "mobile-crash",
          message: String(error?.message || error).slice(0, 2000),
          stack: error?.stack?.slice(0, 8000) ?? null,
          component_stack: componentStack?.slice(0, 8000) ?? null,
          user_agent: `CareCliQ worker app ${version} (${Platform.OS} ${String(Platform.Version)})`.slice(0, 500),
        }),
      });
    } catch {
      /* reporting must never cause a second error */
    }
  })();
}
