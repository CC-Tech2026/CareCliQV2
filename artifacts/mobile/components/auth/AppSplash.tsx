import { Image } from "expo-image";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

/**
 * Branded start/splash screen matching the CareCliQ redesign:
 * white canvas, rounded app-icon tile with wordmark, black CareCliq label.
 */
export function AppSplash() {
  return (
    <View style={styles.root} accessibilityLabel="CareCliQ">
      <View style={styles.center}>
        <View style={styles.iconOuter}>
          <View style={styles.iconInner}>
            <Image
              source={require("@/assets/images/carecliq-wordmark.png")}
              style={styles.wordmark}
              contentFit="contain"
              accessibilityLabel="CareCliQ"
            />
          </View>
        </View>
        <Text style={styles.label}>CareCliq</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  center: {
    alignItems: "center",
    gap: 18,
  },
  iconOuter: {
    width: 168,
    height: 168,
    borderRadius: 38,
    backgroundColor: "#E8E8EC",
    padding: 10,
    ...Platform.select({
      ios: {
        shadowColor: "#000000",
        shadowOpacity: 0.08,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: 6 },
      },
      android: { elevation: 4 },
      default: {},
    }),
  },
  iconInner: {
    flex: 1,
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    paddingHorizontal: 10,
  },
  wordmark: {
    width: "100%",
    height: 56,
  },
  label: {
    fontSize: 17,
    fontWeight: "600",
    color: "#111111",
    letterSpacing: -0.2,
  },
});
