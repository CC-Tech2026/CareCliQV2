import { Feather } from "@expo/vector-icons";
import { useGetUnreadAlerts } from "@workspace/api-client-react";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WorkerMobileSidebar } from "@/components/worker/WorkerMobileSidebar";
import { useColors } from "@/hooks/useColors";

type Props = {
  title: string;
};

export function WorkerMobileHeader({ title }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);

  const { data: alerts = [] } = useGetUnreadAlerts();
  const alertCount = alerts.length;

  const topPad = Platform.OS === "web" ? 12 : insets.top;

  return (
    <>
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 8,
            backgroundColor: colors.background,
            borderBottomColor: colors.border,
          },
        ]}
      >
        <Pressable onPress={() => router.push("/(tabs)" as never)} style={styles.logoBtn}>
          <Image
            source={require("@/assets/images/logo.png")}
            style={styles.logo}
            contentFit="contain"
            accessibilityLabel="CareCliQ"
          />
        </Pressable>

        <Text
          style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}
          numberOfLines={1}
        >
          {title}
        </Text>

        <View style={styles.actions}>
          {alertCount > 0 ? (
            <Pressable
              onPress={() => router.push("/(tabs)/compliance" as never)}
              style={[styles.alertBtn, { backgroundColor: colors.alertBg }]}
              accessibilityLabel={`${alertCount} compliance alerts`}
            >
              <Feather name="alert-triangle" size={15} color={colors.accent} />
              <View style={[styles.alertBadge, { backgroundColor: colors.accent }]}>
                <Text style={[styles.alertBadgeText, { fontFamily: "Inter_700Bold" }]}>
                  {alertCount > 9 ? "9+" : alertCount}
                </Text>
              </View>
            </Pressable>
          ) : null}

          <Pressable
            onPress={() => setDrawerOpen(true)}
            style={styles.menuBtn}
            accessibilityLabel="Open navigation menu"
          >
            <Feather name="menu" size={20} color={colors.foreground} />
          </Pressable>
        </View>
      </View>

      <WorkerMobileSidebar visible={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  logoBtn: { width: 72, height: 32 },
  logo: { width: 72, height: 32 },
  title: { flex: 1, fontSize: 13, textAlign: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: 4 },
  alertBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  alertBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    minWidth: 14,
    height: 14,
    borderRadius: 7,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 3,
  },
  alertBadgeText: { color: "#FFFFFF", fontSize: 9 },
  menuBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
