import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { StyleSheet } from "react-native";

/** A right-edge fade hinting a horizontally-scrollable tab bar has more tabs
 * off-screen. Render it as a sibling right after the tab ScrollView, inside
 * a `position: "relative"` wrapper. */
export function TabScrollFade({ visible, background }: { visible: boolean; background: string }) {
  if (!visible) return null;
  return (
    <LinearGradient
      pointerEvents="none"
      colors={["transparent", background]}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.fade}
    />
  );
}

const styles = StyleSheet.create({
  fade: { position: "absolute", right: 0, top: 0, bottom: 0, width: 28 },
});
