import { Feather } from "@expo/vector-icons";
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

import { WorkerProfileDropdown } from "@/components/worker/WorkerProfileDropdown";
import { useWorkerNotifications } from "@/hooks/worker/useWorkerNotifications";
import { useColors } from "@/hooks/useColors";

type Props = {
  title: string;
  showBack?: boolean;
  /** Back button only — hides center title and right-side actions. */
  minimal?: boolean;
};

export function WorkerMobileHeader({ title, showBack, minimal }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: unreadNotifications = [] } = useWorkerNotifications(true);
  const notificationCount = unreadNotifications.length;

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
        {showBack ? (
          <Pressable
            onPress={() => router.back()}
            style={styles.backBtn}
            accessibilityLabel="Go back"
          >
            <Feather name="chevron-left" size={24} color={colors.foreground} />
          </Pressable>
        ) : (
          <Pressable onPress={() => router.replace("/(tabs)/shifts" as never)} style={styles.logoBtn}>
            <Image
              source={require("@/assets/images/logo.png")}
              style={styles.logo}
              contentFit="contain"
              accessibilityLabel="CareCliQ"
            />
          </Pressable>
        )}

        {minimal ? null : (
          <>
            <Text
              style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}
              numberOfLines={1}
            >
              {title}
            </Text>

            <View style={styles.actions}>
              {title !== "Notifications" && title !== "Your data & privacy" ? (
                <Pressable
                  onPress={() => router.push("/worker/notifications" as never)}
                  style={styles.notifBtn}
                  accessibilityLabel={
                    notificationCount > 0
                      ? `${notificationCount} unread notifications`
                      : "Notifications"
                  }
                >
                  <Feather name="bell" size={18} color={colors.foreground} />
                  {notificationCount > 0 ? (
                    <View style={[styles.notifBadge, { backgroundColor: colors.primary }]}>
                      <Text style={[styles.notifBadgeText, { fontFamily: "Inter_700Bold" }]}>
                        {notificationCount > 9 ? "9+" : notificationCount}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              ) : null}

              <Pressable
                onPress={() => setMenuOpen(true)}
                style={styles.menuBtn}
                accessibilityLabel="Open profile menu"
              >
                <Feather name="menu" size={20} color={colors.foreground} />
              </Pressable>
            </View>
          </>
        )}
      </View>

      {!minimal ? <WorkerProfileDropdown visible={menuOpen} onClose={() => setMenuOpen(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  logoBtn: { width: 72, height: 32 },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: -6,
  },
  logo: { width: 72, height: 32 },
  title: { flex: 1, fontSize: 16, textAlign: "center", letterSpacing: -0.2 },
  actions: { flexDirection: "row", alignItems: "center", gap: 4 },
  notifBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  notifBadge: {
    position: "absolute",
    top: 2,
    right: 2,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  notifBadgeText: { color: "#FFFFFF", fontSize: 9, lineHeight: 11 },
  menuBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
});
