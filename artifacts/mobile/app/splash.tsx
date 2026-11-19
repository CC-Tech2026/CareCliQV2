import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";

import { AppSplash, SPLASH_INTRO_MS } from "@/components/auth/AppSplash";
import { Brand } from "@/constants/brand";
import { CCQ_ONBOARDING_DONE_KEY } from "@/lib/storage-keys";

/** The finished logo's short hold on later launches. */
const BRIEF_MS = 700;

type Plan = { mode: "intro" | "brief"; next: "/onboarding" | "/login" };

/**
 * First launch: the full logo animation, then onboarding. Later launches
 * (and Reduce Motion): the finished logo briefly, then sign in. Tapping skips.
 */
export default function SplashScreen() {
  const router = useRouter();
  const advancedRef = useRef(false);
  const [plan, setPlan] = useState<Plan | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      let done = false;
      let reduceMotion = false;
      try {
        done = (await AsyncStorage.getItem(CCQ_ONBOARDING_DONE_KEY)) === "true";
      } catch {
        done = false;
      }
      try {
        reduceMotion = await AccessibilityInfo.isReduceMotionEnabled();
      } catch {
        reduceMotion = false;
      }
      if (!mounted) return;
      setPlan({
        mode: !done && !reduceMotion ? "intro" : "brief",
        next: done ? "/login" : "/onboarding",
      });
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const advance = useCallback(() => {
    if (advancedRef.current || !plan) return;
    advancedRef.current = true;
    router.replace(plan.next as never);
  }, [plan, router]);

  useEffect(() => {
    if (!plan) return;
    const timer = setTimeout(advance, plan.mode === "intro" ? SPLASH_INTRO_MS : BRIEF_MS);
    return () => clearTimeout(timer);
  }, [plan, advance]);

  return (
    <View style={styles.fill}>
      <AppSplash mode={plan?.mode ?? "brief"} fadeIn={false} onSkip={advance} />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: Brand.canvas },
});
