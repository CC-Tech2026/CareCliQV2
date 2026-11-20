import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/context/AuthContext";
import { useWorkerLandingDashboard } from "@/hooks/worker/useWorkerLandingDashboard";
import {
  CCQ_BIRTHDAY_OFF_KEY,
  CCQ_BIRTHDAY_SEEN_KEY,
} from "@/lib/storage-keys";
import { getWorkerProfile } from "@/lib/user-api";

/**
 * True when `dob` (YYYY-MM-DD) falls on `now`'s calendar day. People born on
 * 29 February celebrate on the 28th in years without one.
 */
export function isBirthdayOn(
  dob: string | null | undefined,
  now: Date,
): boolean {
  if (!dob) return false;
  const [, m, d] = dob.slice(0, 10).split("-").map(Number);
  if (!m || !d) return false;
  const month = now.getMonth() + 1;
  const day = now.getDate();
  if (m === month && d === day) return true;
  const year = now.getFullYear();
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return m === 2 && d === 29 && !leap && month === 2 && day === 28;
}

async function readFlag(key: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(key);
  } catch {
    return null;
  }
}

/**
 * The worker's birthday state for today: whether to celebrate, and whether
 * the full-screen celebration has already played this year on this phone.
 */
export function useBirthday() {
  const { isAuthenticated } = useAuth();
  const profile = useQuery({
    queryKey: ["users", "me"],
    queryFn: getWorkerProfile,
    enabled: isAuthenticated,
    staleTime: 5 * 60_000,
  });
  const landing = useWorkerLandingDashboard();
  const [turnedOff, setTurnedOff] = useState<boolean | null>(null);
  const [seenYear, setSeenYear] = useState<string | null | undefined>(
    undefined,
  );

  useEffect(() => {
    void readFlag(CCQ_BIRTHDAY_OFF_KEY).then((v) => setTurnedOff(v === "true"));
    void readFlag(CCQ_BIRTHDAY_SEEN_KEY).then((v) => setSeenYear(v));
  }, []);

  const now = new Date();
  const year = String(now.getFullYear());
  const dob = profile.data?.date_of_birth ?? null;
  const isBirthday = turnedOff === false && isBirthdayOn(dob, now);
  // The same first name the home greeting uses; never guessed from the full
  // name. Without one, the message simply says "Happy birthday!".
  const firstName = landing.data?.worker.first_name?.trim() || "";

  const markSeen = useCallback(async () => {
    setSeenYear(year);
    try {
      await AsyncStorage.setItem(CCQ_BIRTHDAY_SEEN_KEY, year);
    } catch {
      // Not saved: worst case the celebration plays again today.
    }
  }, [year]);

  return {
    dob,
    isBirthday,
    /** Play the full-screen celebration (birthday, not yet seen this year). */
    shouldCelebrate: isBirthday && seenYear !== undefined && seenYear !== year,
    firstName,
    markSeen,
    turnedOff: turnedOff === true,
    setTurnedOff: async (off: boolean) => {
      setTurnedOff(off);
      try {
        await AsyncStorage.setItem(
          CCQ_BIRTHDAY_OFF_KEY,
          off ? "true" : "false",
        );
      } catch {
        // Keeps working for this session even if it can't be saved.
      }
    },
    refetch: profile.refetch,
  };
}
