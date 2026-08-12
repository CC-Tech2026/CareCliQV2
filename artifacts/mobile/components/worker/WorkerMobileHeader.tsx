import { Feather } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
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
import { FontFamily } from "@/constants/typography";
import { useAuth } from "@/context/AuthContext";
import { useWorkerNotifications } from "@/hooks/worker/useWorkerNotifications";
import { useColors } from "@/hooks/useColors";
import { resolveWorkerDisplayName } from "@/lib/display-name";
import { goBackOrHome } from "@/lib/go-back";
import { shiftInitials } from "@/lib/shift-utils";

type Props = {
  title: string;
  showBack?: boolean;
  /** Override default back (goBackOrHome). */
  onBack?: () => void;
  /** Back button only — hides center title and right-side actions. */
  minimal?: boolean;
};

export function WorkerMobileHeader({ title, showBack, onBack, minimal }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);

  const { data: unreadNotifications = [] } = useWorkerNotifications(true);
  const notificationCount = unreadNotifications.length;
  const displayName = resolveWorkerDisplayName({
    authFullName: user?.full_name,
    fallback: user?.email?.split("@")[0] || "Worker",
  });
  const initials = shiftInitials(displayName);
  const photoUrl = user?.profile_photo_url || null;

  const topPad = Platform.OS === "web" ? 12 : insets.top;
  const headerBg = colors.primary;

  return (
    <>
      <StatusBar style="light" />
      <View
        style={[
          styles.header,
          {
            paddingTop: topPad + 8,
            backgroundColor: headerBg,
          },
        ]}
      >
        {showBack ? (
          <Pressable
            onPress={() => (onBack ? onBack() : goBackOrHome(router))}
            style={[styles.sideBtn, { backgroundColor: "rgba(255,255,255,0.16)" }]}
            accessibilityLabel="Go back"
          >
            <Feather name="arrow-left" size={19} color="#FFFFFF" />
          </Pressable>
        ) : (
          <Pressable
            onPress={() => {
              if (minimal) return;
              router.push("/(tabs)/settings" as never);
            }}
            onLongPress={() => setMenuOpen(true)}
            style={styles.avatarWrap}
            accessibilityLabel="Open profile"
          >
            <View style={[styles.avatar, { backgroundColor: colors.card, borderColor: "rgba(255,255,255,0.55)" }]}>
              {photoUrl ? (
                <Image source={{ uri: photoUrl }} style={styles.avatarImage} contentFit="cover" />
              ) : (
                <Text style={[styles.avatarText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                  {initials}
                </Text>
              )}
            </View>
            {notificationCount > 0 ? (
              <View
                style={[
                  styles.avatarDot,
                  { backgroundColor: colors.pink, borderColor: headerBg },
                ]}
              />
            ) : null}
          </Pressable>
        )}

        {minimal ? null : (
          <>
            <Text
              style={[styles.title, { color: "#FFFFFF", fontFamily: FontFamily.h2 }]}
              numberOfLines={1}
            >
              {title}
            </Text>

            <Pressable
              onPress={() => router.push("/worker/notifications" as never)}
              style={[styles.sideBtn, { backgroundColor: "rgba(255,255,255,0.16)" }]}
              accessibilityLabel={
                notificationCount > 0
                  ? `${notificationCount} unread notifications`
                  : "Notifications"
              }
            >
              <Feather name="bell" size={19} color="#FFFFFF" />
              {notificationCount > 0 ? (
                <View style={[styles.bellDot, { backgroundColor: colors.pink, borderColor: headerBg }]} />
              ) : null}
            </Pressable>
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
    paddingBottom: 16,
    gap: 8,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 4,
  },
  sideBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarWrap: {
    width: 36,
    height: 36,
    position: "relative",
  },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  avatarImage: { width: 36, height: 36 },
  avatarText: { fontSize: 13 },
  avatarDot: {
    position: "absolute",
    top: -1,
    right: -1,
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 2,
  },
  title: { flex: 1, fontSize: 17, textAlign: "center", letterSpacing: -0.2 },
  bellDot: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
  },
});
