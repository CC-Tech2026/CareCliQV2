import { Image } from "expo-image";
import React, { useEffect, useRef } from "react";
import { Animated, Easing, Pressable, StyleSheet, useWindowDimensions } from "react-native";

import { Brand } from "@/constants/brand";

/** Size of the logo artwork (both the animation and its final frame). */
const ART_WIDTH = 640;
const ART_HEIGHT = 596;

/** How long the intro animation runs before its final frame (ms). */
export const SPLASH_INTRO_MS = 4200;

/**
 * The CareCliQ splash on the logo's own warm canvas.
 *
 * "intro" plays the logo being drawn and filled (first launch), as an
 * animated WebP so it needs no video player in the app. "brief" shows the
 * finished logo with a short fade: for every later launch and whenever
 * Reduce Motion is on, so nobody waits on an animation to start a shift.
 * Tapping anywhere skips ahead.
 */
export function AppSplash({
  mode = "brief",
  fadeIn = true,
  onSkip,
}: {
  mode?: "intro" | "brief";
  /** Fade the finished logo in ("brief" only). Off while the app loads. */
  fadeIn?: boolean;
  onSkip?: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const opacity = useRef(new Animated.Value(mode === "brief" && fadeIn ? 0 : 1)).current;
  const logoWidth = Math.min(width * 0.72, height * 0.42, 320);

  useEffect(() => {
    if (mode !== "brief" || !fadeIn) return;
    Animated.timing(opacity, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
  }, [mode, fadeIn, opacity]);

  return (
    <Pressable
      style={styles.root}
      onPress={onSkip}
      accessibilityRole="image"
      accessibilityLabel="CareCliQ"
      accessibilityHint={onSkip ? "Tap to continue" : undefined}
    >
      <Animated.View style={{ opacity }}>
        <Image
          source={
            mode === "intro"
              ? require("@/assets/animate/carecliq-logo-intro.webp")
              : require("@/assets/animate/carecliq-logo-final.png")
          }
          style={{ width: logoWidth, height: (logoWidth * ART_HEIGHT) / ART_WIDTH }}
          contentFit="contain"
          autoplay
          accessible={false}
        />
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: Brand.canvas,
    alignItems: "center",
    justifyContent: "center",
  },
});
