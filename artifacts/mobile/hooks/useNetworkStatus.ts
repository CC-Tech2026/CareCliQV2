import { useCallback, useMemo } from "react";
import { Platform } from "react-native";
import { useNetworkState } from "expo-network";

/**
 * Device connectivity for the offline banner / queue gating.
 * Uses OS network state (Wi‑Fi / cellular) — NOT CareCliQ API reachability.
 * Phone online but API unreachable must not show the Offline banner.
 */
export function useNetworkStatus() {
  const state = useNetworkState();

  const isOnline = useMemo(() => {
    if (Platform.OS === "web") {
      return typeof navigator !== "undefined" ? navigator.onLine : true;
    }
    // While probing, isInternetReachable can be null — treat as online if linked.
    if (state.isConnected == null) return true;
    return state.isConnected === true && state.isInternetReachable !== false;
  }, [state.isConnected, state.isInternetReachable]);

  const checkOnline = useCallback(async () => {
    if (Platform.OS === "web") {
      return typeof navigator !== "undefined" ? navigator.onLine : true;
    }
    try {
      const Network = await import("expo-network");
      const next = await Network.getNetworkStateAsync();
      if (next.isConnected == null) return true;
      return next.isConnected === true && next.isInternetReachable !== false;
    } catch {
      return true;
    }
  }, []);

  const markOffline = useCallback(() => {
    /* no-op: device network is source of truth */
  }, []);

  const markOnline = useCallback(() => {
    /* no-op: device network is source of truth */
  }, []);

  return { isOnline, markOffline, markOnline, checkOnline };
}
