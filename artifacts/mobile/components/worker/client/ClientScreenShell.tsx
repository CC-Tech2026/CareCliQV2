import { FontFamily } from "@/constants/typography";
import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import {
  WorkerBottomNav,
  workerBottomNavHeight,
} from "@/components/worker/WorkerBottomNav";
import { useColors } from "@/hooks/useColors";
import { goBackOrHome } from "@/lib/go-back";

type Props = {
  title: string;
  subtitle?: string;
  backHref?: string;
  children: React.ReactNode;
};

/**
 * Shared mobile shell: a compact, left-aligned header and the existing worker
 * bottom navigation. Children retain ownership of their own scrolling.
 */
export function ClientScreenShell({
  title,
  subtitle,
  backHref,
  children,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navPad = workerBottomNavHeight(insets.bottom, Platform.OS === "web");

  function handleBack() {
    if (backHref) {
      router.replace(backHref as never);
      return;
    }
    goBackOrHome(router);
  }

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top + 8,
            backgroundColor: colors.card,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable
          onPress={handleBack}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          hitSlop={6}
          style={({ pressed }) => [
            styles.backButton,
            { backgroundColor: pressed ? colors.activeBg : colors.soft },
          ]}
        >
          <Feather name="arrow-left" size={19} color={colors.foreground} />
        </Pressable>
        <View style={styles.heading}>
          <Text
            style={[
              styles.title,
              { color: colors.foreground, fontFamily: FontFamily.interBold },
            ]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[
                styles.subtitle,
                {
                  color: colors.mutedForeground,
                  fontFamily: FontFamily.interRegular,
                },
              ]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <View style={[styles.body, { paddingBottom: navPad }]}>{children}</View>
      <View style={styles.bottomNav}>
        <WorkerBottomNav />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backButton: {
    height: 44,
    width: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  heading: { flex: 1, justifyContent: "center", minHeight: 44 },
  title: { fontSize: 18, lineHeight: 24 },
  subtitle: { fontSize: 12, lineHeight: 17, marginTop: 2 },
  body: { flex: 1, paddingTop: 12 },
  bottomNav: { position: "absolute", left: 0, right: 0, bottom: 0 },
});
