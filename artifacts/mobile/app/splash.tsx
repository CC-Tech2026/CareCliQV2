import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AppSplash } from "@/components/auth/AppSplash";
import { CCQ_ONBOARDING_DONE_KEY } from "@/lib/storage-keys";

const AUTO_ADVANCE_MS = 1500;

export default function SplashScreen() {
  const router = useRouter();
  const advancedRef = useRef(false);

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
    const timer = setTimeout(() => {
      void advance();
    }, AUTO_ADVANCE_MS);
    return () => clearTimeout(timer);
  }, [advance]);

  return (
    <Pressable style={styles.fill} onPress={() => void advance()} accessibilityRole="button">
      <AppSplash />
      <View style={styles.hintWrap} pointerEvents="none">
        <Text style={styles.hint}>Tap to continue</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  hintWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 28,
    alignItems: "center",
  },
  hint: {
    fontSize: 11,
    color: "#9A98A8",
    fontWeight: "500",
  },
});
