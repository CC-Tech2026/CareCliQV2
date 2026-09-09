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
          style={[styles.backBtn, { borderColor: colors.border }]}
        >
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </Pressable>
        <View style={styles.headerText}>
          <Text
            style={[
              styles.headerTitle,
              { color: colors.foreground, fontFamily: "Inter_700Bold" },
            ]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {subtitle ? (
            <Text
              style={[
                styles.headerSubtitle,
                {
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                },
              ]}
              numberOfLines={1}
            >
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.backBtn} />
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
    gap: 8,
    paddingHorizontal: 12,
    paddingBottom: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 44,
    height: 44,
    borderRadius: 18,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  headerText: { flex: 1, alignItems: "center" },
  headerTitle: { fontSize: 17, textAlign: "center" },
  headerSubtitle: { fontSize: 12, textAlign: "center", marginTop: 2 },
  body: { flex: 1, paddingTop: 16 },
  bottomNav: { position: "absolute", left: 0, right: 0, bottom: 0 },
});
