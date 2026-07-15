import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";

import { AppSplash } from "@/components/auth/AppSplash";
import { CCQ_ONBOARDING_DONE_KEY } from "@/lib/storage-keys";

const MARK_MOTION_MS = 350;
const MAX_SPLASH_MS = 1500;

export default function SplashScreen() {
  const router = useRouter();
  const advancedRef = useRef(false);
  const startedAt = useRef(Date.now());
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (mounted) setReduceMotion(enabled);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  const advance = useCallback(async () => {
    if (advancedRef.current) return;
    advancedRef.current = true;
    try {
      const done = await AsyncStorage.getItem(CCQ_ONBOARDING_DONE_KEY);
      router.replace((done === "true" ? "/login" : "/onboarding") as never);
    } catch {
      router.replace("/onboarding" as never);
    }
  }, [router]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const minHold = reduceMotion ? 0 : MARK_MOTION_MS;
      const elapsed = Date.now() - startedAt.current;
      const wait = Math.max(0, minHold - elapsed);
      await new Promise((r) => setTimeout(r, wait));
      if (cancelled || advancedRef.current) return;
      void advance();
    };
    void run();

    const safety = setTimeout(() => {
      void advance();
    }, MAX_SPLASH_MS);

    return () => {
      cancelled = true;
      clearTimeout(safety);
    };
  }, [advance, reduceMotion]);

  return (
    <View style={styles.fill}>
      <AppSplash />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
