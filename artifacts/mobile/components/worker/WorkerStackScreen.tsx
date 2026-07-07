import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { OfflineBanner } from "@/components/OfflineBanner";
import { WorkerBottomNav, workerBottomNavHeight } from "@/components/worker/WorkerBottomNav";
import { WorkerMobileHeader } from "@/components/worker/WorkerMobileHeader";
import { WorkerPageSubheader } from "@/components/worker/WorkerPageSubheader";
import { useColors } from "@/hooks/useColors";

type Props = {
  headerTitle: string;
  pageTitle: string;
  subtitle?: string;
  showSignOut?: boolean;
  /** When true, the content area uses the app background (for white cards on a subtle base). */
  cardsOnBackground?: boolean;
  children: React.ReactNode;
};

export function WorkerStackScreen({
  headerTitle,
  pageTitle,
  subtitle,
  showSignOut,
  cardsOnBackground,
  children,
}: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const navPad = workerBottomNavHeight(insets.bottom, Platform.OS === "web");
  const bodyBackground = cardsOnBackground ? colors.background : colors.card;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <OfflineBanner />
      <WorkerMobileHeader title={headerTitle} />
      <WorkerPageSubheader title={pageTitle} subtitle={subtitle} showSignOut={showSignOut} />
      <View style={[styles.body, { backgroundColor: bodyBackground, paddingBottom: navPad }]}>{children}</View>
      <View style={styles.bottomNav}>
        <WorkerBottomNav />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1 },
  bottomNav: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
  },
});
