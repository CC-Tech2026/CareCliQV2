import { MaterialCommunityIcons } from "@expo/vector-icons";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";

export const PARTY = {
  gold: "#F2B84B",
  pink: "#E8457A",
  lilac: "#B8AEF0",
  mint: "#6FD3A8",
  white: "#FFFFFF",
};

const FLAG_COLOURS = [
  PARTY.pink,
  PARTY.gold,
  PARTY.lilac,
  PARTY.white,
  PARTY.mint,
];

/** Run a looping animation unless Reduce Motion is on (then hold `still`). */
function useLoop(
  make: (value: Animated.Value) => Animated.CompositeAnimation,
  reduce: boolean,
  still = 0.5,
) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) {
      value.setValue(still);
      return;
    }
    const anim = Animated.loop(make(value));
    anim.start();
    return () => anim.stop();
  }, [reduce]); // eslint-disable-line react-hooks/exhaustive-deps
  return value;
}

/** Party bunting: a string of little flags sagging across the top. */
export function Bunting({ top }: { top: number }) {
  const { width } = useWindowDimensions();
  const flags = Math.max(9, Math.round(width / 34));
  const gap = width / flags;
  const sag = 26;
  return (
    <View
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { top }]}
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: flags }, (_, i) => {
        const x = gap * i + gap / 2;
        const t = x / width;
        const y = sag * 4 * t * (1 - t); // a gentle curve, lowest in the middle
        const tilt = (0.5 - t) * 18;
        return (
          <View
            key={i}
            style={{
              position: "absolute",
              left: x - 11,
              top: y,
              width: 0,
              height: 0,
              borderLeftWidth: 11,
              borderRightWidth: 11,
              borderTopWidth: 22,
              borderLeftColor: "transparent",
              borderRightColor: "transparent",
              borderTopColor: FLAG_COLOURS[i % FLAG_COLOURS.length],
              transform: [{ rotate: `${tilt}deg` }],
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * A one-off pop of confetti flying out from behind the cake as the screen
 * opens, then fading. Skipped with Reduce Motion.
 */
export function Burst({
  size,
  colours,
  reduce,
}: {
  size: number;
  colours: string[];
  reduce: boolean;
}) {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduce) return;
    Animated.timing(progress, {
      toValue: 1,
      duration: 1300,
      delay: 250,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress, reduce]);
  if (reduce) return null;
  const pieces = 28;
  return (
    <View
      pointerEvents="none"
      style={{ position: "absolute", width: size, height: size }}
      importantForAccessibility="no-hide-descendants"
    >
      {Array.from({ length: pieces }, (_, i) => {
        const angle = (i / pieces) * Math.PI * 2;
        const reach = size * (0.75 + ((i * 7) % 5) * 0.12);
        const piece = 6 + (i % 3) * 3;
        return (
          <Animated.View
            key={i}
            style={{
              position: "absolute",
              left: size / 2 - piece / 2,
              top: size / 2 - piece / 2,
              width: i % 2 ? piece : piece * 0.6,
              height: i % 2 ? piece : piece * 1.6,
              borderRadius: i % 2 ? piece / 2 : 2,
              backgroundColor: colours[i % colours.length],
              opacity: progress.interpolate({
                inputRange: [0, 0.1, 0.7, 1],
                outputRange: [0, 1, 1, 0],
              }),
              transform: [
                {
                  translateX: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, Math.cos(angle) * reach],
                  }),
                },
                {
                  translateY: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, Math.sin(angle) * reach + 30],
                  }),
                },
                {
                  rotate: progress.interpolate({
                    inputRange: [0, 1],
                    outputRange: ["0deg", `${(i % 2 ? 1 : -1) * 320}deg`],
                  }),
                },
              ],
            }}
          />
        );
      })}
    </View>
  );
}

/** A small four-point star that twinkles. */
export function Sparkle({
  left,
  top,
  size = 18,
  delay = 0,
  colour = PARTY.gold,
  reduce,
}: {
  left: number | `${number}%`;
  top: number | `${number}%`;
  size?: number;
  delay?: number;
  colour?: string;
  reduce: boolean;
}) {
  const twinkle = useLoop(
    (v) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(v, {
          toValue: 1,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(v, {
          toValue: 0,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.delay(600),
      ]),
    reduce,
    1,
  );
  return (
    <Animated.View
      pointerEvents="none"
      importantForAccessibility="no-hide-descendants"
      style={{
        position: "absolute",
        left,
        top,
        opacity: twinkle.interpolate({
          inputRange: [0, 1],
          outputRange: [0.25, 1],
        }),
        transform: [
          {
            scale: twinkle.interpolate({
              inputRange: [0, 1],
              outputRange: [0.6, 1.15],
            }),
          },
        ],
      }}
    >
      <MaterialCommunityIcons
        name="star-four-points"
        size={size}
        color={colour}
      />
    </Animated.View>
  );
}

/** A soft ring that slowly pulses outward behind the cake. */
export function GlowRing({ size, reduce }: { size: number; reduce: boolean }) {
  const pulse = useLoop(
    (v) =>
      Animated.sequence([
        Animated.timing(v, {
          toValue: 1,
          duration: 1600,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    reduce,
    0.3,
  );
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 3,
        borderColor: PARTY.gold,
        opacity: pulse.interpolate({
          inputRange: [0, 1],
          outputRange: [0.7, 0],
        }),
        transform: [
          {
            scale: pulse.interpolate({
              inputRange: [0, 1],
              outputRange: [1, 1.45],
            }),
          },
        ],
      }}
    />
  );
}
