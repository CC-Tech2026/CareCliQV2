import { Feather } from "@expo/vector-icons";
import type { ComponentProps } from "react";
import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text } from "react-native";

import { useOffline } from "@/context/OfflineContext";

type FeatherIconName = ComponentProps<typeof Feather>["name"];

export function OfflineBanner() {
  const { isOnline, pendingCount } = useOffline();
  const translateY = useRef(new Animated.Value(-60)).current;

  useEffect(() => {
    if (!isOnline || pendingCount > 0) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        tension: 80,
        friction: 10,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: -60,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [isOnline, pendingCount, translateY]);

  if (isOnline && pendingCount === 0) return null;

  const bannerColor = isOnline ? "#F59E0B" : "#EF4444";
  const iconName: FeatherIconName = isOnline ? "upload-cloud" : "wifi-off";
  const message = isOnline
    ? `Syncing ${pendingCount} saved note${pendingCount !== 1 ? "s" : ""}…`
    : pendingCount > 0
    ? `Offline — ${pendingCount} note${pendingCount !== 1 ? "s" : ""} queued`
    : "Offline — data loaded from cache";

  return (
    <Animated.View
      style={[
        styles.banner,
        { backgroundColor: bannerColor, transform: [{ translateY }] },
      ]}
      pointerEvents="none"
    >
      <Feather name={iconName} size={14} color="#FFFFFF" />
      <Text style={[styles.text, { fontFamily: "Inter_600SemiBold" }]}>
        {message}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 9999,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  text: {
    color: "#FFFFFF",
    fontSize: 13,
  },
});
