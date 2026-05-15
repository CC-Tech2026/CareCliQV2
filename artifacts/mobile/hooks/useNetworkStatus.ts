import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useRef, useState } from "react";

const PING_INTERVAL_OFFLINE = 5000;
const PING_TIMEOUT = 4000;

async function pingServer(): Promise<boolean> {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  const url = domain
    ? `https://${domain}/api/participants`
    : "/api/participants";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.status < 500;
  } catch {
    clearTimeout(timer);
    return false;
  }
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
