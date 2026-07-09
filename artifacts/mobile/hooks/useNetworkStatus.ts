import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";

import { Platform } from "react-native";

import { getMobileApiBaseUrl } from "@/lib/api-base-url";
import { getLastSuccessfulWorkerFetchAt } from "@/lib/worker-fetch";

const PING_INTERVAL_OFFLINE = 5000;
const PING_TIMEOUT = 4000;
const RECENT_FETCH_GRACE_MS = 60_000;

async function pingServer(): Promise<boolean> {
  const base = getMobileApiBaseUrl();
  const url = base
    ? `${base}/api/health`
    : Platform.OS === "web"
      ? "/api/health"
      : null;

  if (!url) {
    return Date.now() - getLastSuccessfulWorkerFetchAt() < RECENT_FETCH_GRACE_MS;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT);
  try {
    const res = await fetch(url, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok || res.status < 500) return true;
  } catch {
    clearTimeout(timer);
  }

  return Date.now() - getLastSuccessfulWorkerFetchAt() < RECENT_FETCH_GRACE_MS;
}

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkOnline = async () => {
    const online = await pingServer();
    setIsOnline(online);
    return online;
  };

  const startPolling = () => {
    if (intervalRef.current) return;
    intervalRef.current = setInterval(async () => {
      const online = await pingServer();
      setIsOnline(online);
      if (online && intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, PING_INTERVAL_OFFLINE);
  };

  const stopPolling = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  };

  useEffect(() => {
    checkOnline().then((online) => {
      if (!online) startPolling();
    });
    return () => stopPolling();
  }, []);

  useEffect(() => {
    if (!isOnline) {
      startPolling();
    } else {
      stopPolling();
    }
  }, [isOnline]);

  const markOffline = () => {
    setIsOnline(false);
  };

  const markOnline = () => {
    setIsOnline(true);
  };

  return { isOnline, markOffline, markOnline, checkOnline };
}
