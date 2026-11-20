import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  StyleSheet,
  View,
  useWindowDimensions,
} from "react-native";

import { Brand } from "@/constants/brand";

/** CareCliQ's own colours, plus a warm gold, so it reads as ours. */
const COLOURS = [Brand.pink, Brand.purple, "#F2B84B", Brand.success, "#6E79C2"];

/** Three fall speeds, so the pieces don't move in lockstep. */
const CLOCK_MS = [3400, 4300, 5200];

type Piece = {
  x: number;
  /** Where in its fall the piece starts (0 to 1), so they're spread out. */
  phase: number;
  clock: number;
  size: number;
  colour: string;
  round: boolean;
  drift: number;
  spin: number;
};

function makePieces(count: number, width: number, colours: string[]): Piece[] {
  // Fixed-seed pseudo-random so the layout is stable between renders.
  let seed = 7;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return Array.from({ length: count }, (_, i) => ({
    x: rand() * width,
    phase: rand(),
    clock: i % CLOCK_MS.length,
    size: 6 + rand() * 7,
    colour: colours[i % colours.length],
    round: rand() > 0.6,
    drift: (rand() - 0.5) * 90,
    spin: (rand() > 0.5 ? 1 : -1) * (180 + rand() * 540),
  }));
}

/**
 * Confetti falling over the whole screen for as long as it's shown. Each piece
 * rides one of three looping clocks, offset by its own phase, which wraps it
 * back to the top when it reaches the bottom. With Reduce Motion on, the
 * pieces sit still, scattered.
 */
export function Confetti({
  count = 46,
  colours = COLOURS,
}: {
  count?: number;
  colours?: string[];
}) {
  const { width, height } = useWindowDimensions();
  const pieces = useMemo(
    () => makePieces(count, width, colours),
    [count, width, colours],
  );
  const clocks = useRef(CLOCK_MS.map(() => new Animated.Value(0))).current;
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let loops: Animated.CompositeAnimation[] = [];
    void AccessibilityInfo.isReduceMotionEnabled().then((isReduced) => {
      if (cancelled) return;
      setReduce(isReduced);
      if (isReduced) return;
      loops = clocks.map((clock, i) =>
        Animated.loop(
          Animated.sequence([
            Animated.timing(clock, {
              toValue: 1,
              duration: CLOCK_MS[i],
              easing: Easing.linear,
              useNativeDriver: true,
            }),
            Animated.timing(clock, {
              toValue: 0,
              duration: 0,
              useNativeDriver: true,
            }),
          ]),
        ),
      );
      loops.forEach((loop) => loop.start());
    });
    return () => {
      cancelled = true;
      loops.forEach((loop) => loop.stop());
    };
  }, [clocks]);

  const top = -30;
  const bottom = height + 30;

  return (
    <View
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      importantForAccessibility="no-hide-descendants"
    >
      {pieces.map((piece, i) => {
        const shape = {
          position: "absolute" as const,
          left: piece.x,
          top: 0,
          width: piece.round ? piece.size : piece.size * 0.6,
          height: piece.size * (piece.round ? 1 : 1.6),
          borderRadius: piece.round ? piece.size / 2 : 2,
          backgroundColor: piece.colour,
        };
        if (reduce) {
          return (
            <View
              key={i}
              style={[
                shape,
                {
                  transform: [
                    { translateY: top + piece.phase * (bottom - top) },
                  ],
                },
              ]}
            />
          );
        }
        // Progress through the fall = (clock + phase) wrapped to 0..1.
        const cut = 1 - piece.phase;
        const startY = top + piece.phase * (bottom - top);
        const clock = clocks[piece.clock];
        const translateY = clock.interpolate({
          inputRange: [0, cut, Math.min(1, cut + 0.0001), 1],
          outputRange: [startY, bottom, top, startY],
        });
        const translateX = clock.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: [0, piece.drift, 0],
        });
        const rotate = clock.interpolate({
          inputRange: [0, 1],
          outputRange: ["0deg", `${piece.spin}deg`],
        });
        return (
          <Animated.View
            key={i}
            style={[
              shape,
              { transform: [{ translateY }, { translateX }, { rotate }] },
            ]}
          />
        );
      })}
    </View>
  );
}
