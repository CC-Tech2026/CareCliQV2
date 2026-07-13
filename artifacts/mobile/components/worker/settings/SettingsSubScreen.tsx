import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { WorkerBottomNav, workerBottomNavHeight } from "@/components/worker/WorkerBottomNav";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { useColors } from "@/hooks/useColors";

type Props = {
  title: string;
  children: React.ReactNode;
  showBack?: boolean;
  showBottomNav?: boolean;
};

export function SettingsSubScreen({
  title,
  children,
  showBack = true,
  showBottomNav = true,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const bottomInset = showBottomNav
    ? workerBottomNavHeight(insets.bottom, Platform.OS === "web")
    : insets.bottom + 24;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={title} showBack={showBack} />
      <View style={[styles.body, { paddingBottom: bottomInset }]}>{children}</View>
      {showBottomNav ? (
        <View style={styles.bottomNav}>
          <WorkerBottomNav />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1, paddingTop: 8 },
  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
});
