import { Feather } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import React from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ProfileThemeToggle } from "@/components/worker/ProfileThemeToggle";
import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { resolveWorkerDisplayName } from "@/lib/display-name";
import type { TranslationKey } from "@/lib/i18n/translations";
import { shiftInitials } from "@/lib/shift-utils";

type MenuItem = {
  labelKey: TranslationKey;
  icon: keyof typeof Feather.glyphMap;
  href: string;
  accent?: boolean;
};

const MENU_ITEMS: MenuItem[] = [
  { labelKey: "nav.profile", icon: "user", href: "/(tabs)/profile" },
  { labelKey: "nav.settings", icon: "settings", href: "/(tabs)/settings" },
  { labelKey: "nav.security", icon: "lock", href: "/worker/security" },
  { labelKey: "nav.privacy", icon: "shield", href: "/worker/privacy" },
  { labelKey: "nav.help", icon: "help-circle", href: "/worker/help" },
];

function formatRole(role?: string): string {
  if (!role) return "Support Worker";
  const labels: Record<string, string> = {
    support_worker: "Support Worker",
    support_coordinator: "Support Coordinator",
  };
  if (labels[role]) return labels[role];
  return role
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function WorkerProfileDropdown({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const { user, logout } = useAuth();

  const displayName = resolveWorkerDisplayName({
    authFullName: user?.full_name,
    fallback: user?.email?.split("@")[0] || "Worker",
  });
  const displayRole = formatRole(user?.role);
  const initials = shiftInitials(displayName);

  const navigate = (href: string) => {
    onClose();
    if (href.startsWith("/(tabs)")) {
      router.replace(href as never);
      return;
    }
    router.push(href as never);
  };

  const handleSignOut = () => {
    onClose();
    void logout().then(() => router.replace("/login" as never));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu" />

        <View
          style={[
            styles.dropdown,
            {
              top: insets.top + 52,
              backgroundColor: colors.card,
              borderColor: colors.border,
              shadowColor: colors.scheme === "dark" ? "#000000" : "#0D0D55",
            },
          ]}
        >
          <View style={[styles.header, { borderBottomColor: colors.border }]}>
            <View style={[styles.avatar, { backgroundColor: colors.activeBg, borderColor: colors.border }]}>
              <Text style={[styles.avatarText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                {initials}
              </Text>
            </View>
            <View style={styles.headerText}>
              <Text style={[styles.name, { color: colors.foreground, fontFamily: "Inter_700Bold" }]} numberOfLines={1}>
                {displayName}
              </Text>
              <Text style={[styles.role, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]} numberOfLines={1}>
                {displayRole}
              </Text>
            </View>
          </View>

          <ProfileThemeToggle />

          <View style={styles.menu}>
            {MENU_ITEMS.map((item) => (
              <Pressable
                key={item.labelKey}
                onPress={() => navigate(item.href)}
                style={({ pressed }) => [styles.menuItem, pressed && { backgroundColor: colors.soft }]}
              >
                <Feather
                  name={item.icon}
                  size={16}
                  color={item.accent ? colors.accent : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.menuLabel,
                    {
                      color: item.accent ? colors.accent : colors.foreground,
                      fontFamily: item.accent ? "Inter_600SemiBold" : "Inter_500Medium",
                    },
                  ]}
                >
                  {t(item.labelKey)}
                </Text>
              </Pressable>
            ))}
          </View>

          <View style={[styles.signOutWrap, { borderTopColor: colors.border }]}>
            <Pressable
              onPress={handleSignOut}
              style={({ pressed }) => [styles.signOutItem, pressed && { backgroundColor: colors.dangerBg }]}
            >
              <Feather name="log-out" size={16} color={colors.destructive} />
              <Text style={[styles.signOutLabel, { color: colors.destructive, fontFamily: "Inter_600SemiBold" }]}>
                {t("common.signOut")}
              </Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1 },
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(17,24,39,0.35)",
  },
  dropdown: {
    position: "absolute",
    right: 12,
    width: 280,
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 20,
    elevation: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontSize: 13 },
  headerText: { flex: 1, gap: 2 },
  name: { fontSize: 14, lineHeight: 18 },
  role: { fontSize: 12, lineHeight: 16 },
  menu: { paddingVertical: 6 },
  menuItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  menuLabel: { fontSize: 14 },
  signOutWrap: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingVertical: 6,
  },
  signOutItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  signOutLabel: { fontSize: 14 },
});
