import { Feather } from "@expo/vector-icons";
import { useGetUnreadAlerts } from "@workspace/api-client-react";
import { Image } from "expo-image";
import { useRouter, useSegments } from "expo-router";
import React, { useEffect, useRef } from "react";
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAuth } from "@/context/AuthContext";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { TranslationKey } from "@/lib/i18n/translations";
import { shiftInitials } from "@/lib/shift-utils";

const DRAWER_WIDTH = 256;

type NavIcon = keyof typeof Feather.glyphMap;

type NavItem = {
  id: string;
  labelKey: TranslationKey;
  icon: NavIcon;
  href: string;
  incident?: boolean;
  compliance?: boolean;
};

type NavSection = {
  groupKey?: TranslationKey;
  items: NavItem[];
};

const WORKER_NAV: NavSection[] = [
  {
    items: [{ id: "dashboard", labelKey: "dashboard.title", icon: "grid", href: "/(tabs)" }],
  },
  {
    groupKey: "nav.group.myWork",
    items: [
      { id: "shifts", labelKey: "nav.shifts", icon: "clock", href: "/(tabs)/shifts" },
      { id: "availability", labelKey: "nav.availability", icon: "user-check", href: "/worker/availability" },
      { id: "clients", labelKey: "nav.clients", icon: "user", href: "/(tabs)/participants" },
    ],
  },
  {
    groupKey: "nav.group.resources",
    items: [
      {
        id: "compliance",
        labelKey: "nav.compliance",
        icon: "shield",
        href: "/(tabs)/compliance",
        compliance: true,
      },
      { id: "incidents", labelKey: "nav.incidents", icon: "alert-triangle", href: "/incidents", incident: true },
      { id: "credentials", labelKey: "nav.credentials", icon: "check-circle", href: "/credentials" },
      { id: "toolkit", labelKey: "nav.toolkit", icon: "briefcase", href: "/toolkit" },
      { id: "accessibility", labelKey: "nav.accessibility", icon: "sliders", href: "/accessibility" },
    ],
  },
];

function formatRole(role?: string): string {
  if (!role) return "Support Worker";
  return role
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function resolveActiveId(segments: string[]): string {
  const path = segments.join("/");
  if (path === "(tabs)" || path === "(tabs)/index" || path === "") return "dashboard";
  if (path.includes("shifts") && !path.includes("availability")) return "shifts";
  if (path.includes("participants")) return "clients";
  if (path.includes("compliance")) return "compliance";
  if (path.includes("incidents")) return "incidents";
  if (path.includes("availability")) return "availability";
  if (path.includes("credentials")) return "credentials";
  if (path.includes("toolkit")) return "toolkit";
  if (path.includes("accessibility")) return "accessibility";
  if (path.includes("settings")) return "settings";
  if (path.includes("notifications")) return "notifications";
  return "";
}

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function WorkerMobileSidebar({ visible, onClose }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const segments = useSegments();
  const t = useT();
  const { user } = useAuth();
  const { data: alerts = [] } = useGetUnreadAlerts();
  const slideAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;

  const alertCount = alerts.length;
  const activeId = resolveActiveId(segments as string[]);
  const displayName = user?.full_name ?? "Worker";
  const displayRole = formatRole(user?.role);
  const initials = shiftInitials(displayName);

  useEffect(() => {
    Animated.timing(slideAnim, {
      toValue: visible ? 0 : -DRAWER_WIDTH,
      duration: 280,
      useNativeDriver: true,
    }).start();
  }, [visible, slideAnim]);

  const navigate = (href: string) => {
    onClose();
    if (href.startsWith("/(tabs)")) {
      router.replace(href as never);
      return;
    }
    router.push(href as never);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <Animated.View
          style={[
            styles.drawer,
            {
              backgroundColor: colors.background,
              borderRightColor: colors.border,
              paddingTop: insets.top,
              paddingBottom: insets.bottom,
              transform: [{ translateX: slideAnim }],
            },
          ]}
        >
          <View style={[styles.logoRow, { borderBottomColor: colors.border, borderTopColor: colors.primary }]}>
            <Pressable onPress={() => navigate("/(tabs)")} style={styles.logoLink}>
              <Image
                source={require("@/assets/images/logo.png")}
                style={styles.logo}
                contentFit="contain"
                accessibilityLabel="CareCliQ"
              />
              <Text style={[styles.logoText, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                CareCliQ
              </Text>
            </Pressable>
            <Pressable onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close menu">
              <Feather name="x" size={18} color={colors.mutedForeground} />
            </Pressable>
          </View>

          <ScrollView style={styles.navScroll} contentContainerStyle={styles.navContent} showsVerticalScrollIndicator={false}>
            {WORKER_NAV.map((section, sectionIndex) => (
              <View key={section.groupKey ?? `section-${sectionIndex}`} style={sectionIndex > 0 ? styles.sectionGap : undefined}>
                {section.groupKey ? (
                  <View style={styles.groupHeader}>
                    <View style={[styles.groupLine, { backgroundColor: colors.border }]} />
                    <Text style={[styles.groupLabel, { color: colors.mutedForeground, fontFamily: "Inter_700Bold" }]}>
                      {t(section.groupKey).toUpperCase()}
                    </Text>
                  </View>
                ) : null}

                {section.items.map((item) => {
                  const active = activeId === item.id;
                  const isIncident = Boolean(item.incident);
                  const showBadge = Boolean(item.compliance) && alertCount > 0;

                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => navigate(item.href)}
                      style={[
                        styles.navItem,
                        active
                          ? { backgroundColor: colors.primary }
                          : isIncident
                            ? { backgroundColor: "rgba(190,24,93,0.06)" }
                            : undefined,
                      ]}
                    >
                      <Feather
                        name={item.icon}
                        size={18}
                        color={active ? "#FFFFFF" : isIncident ? colors.accent : colors.mutedForeground}
                      />
                      <Text
                        style={[
                          styles.navLabel,
                          {
                            color: active ? "#FFFFFF" : isIncident ? colors.accent : colors.mutedForeground,
                            fontFamily: active ? "Inter_700Bold" : isIncident ? "Inter_600SemiBold" : "Inter_500Medium",
                          },
                        ]}
                      >
                        {t(item.labelKey)}
                      </Text>
                      {showBadge ? (
                        <View
                          style={[
                            styles.navBadge,
                            { backgroundColor: active ? "rgba(255,255,255,0.25)" : colors.accent },
                          ]}
                        >
                          <Text style={[styles.navBadgeText, { fontFamily: "Inter_700Bold" }]}>
                            {alertCount > 9 ? "9+" : alertCount}
                          </Text>
                        </View>
                      ) : null}
                    </Pressable>
                  );
                })}
              </View>
            ))}

            <View style={[styles.settingsSection, { borderTopColor: colors.border }]}>
              <Pressable
                onPress={() => navigate("/settings")}
                style={({ pressed }) => [
                  styles.navItem,
                  activeId === "settings" ? { backgroundColor: colors.primary } : undefined,
                  pressed && activeId !== "settings" ? { backgroundColor: colors.soft } : undefined,
                ]}
              >
                <Feather
                  name="settings"
                  size={18}
                  color={activeId === "settings" ? "#FFFFFF" : colors.mutedForeground}
                />
                <Text
                  style={[
                    styles.navLabel,
                    {
                      color: activeId === "settings" ? "#FFFFFF" : colors.mutedForeground,
                      fontFamily: activeId === "settings" ? "Inter_700Bold" : "Inter_500Medium",
                    },
                  ]}
                >
                  Settings
                </Text>
              </Pressable>
            </View>
          </ScrollView>

          <View style={styles.reportSection}>
            <Pressable
              onPress={() => navigate("/incidents/new")}
              style={[styles.reportBtn, { borderColor: "rgba(190,24,93,0.18)", backgroundColor: "rgba(190,24,93,0.09)" }]}
            >
              <Feather name="alert-triangle" size={14} color={colors.accent} />
              <Text style={[styles.reportBtnText, { color: colors.accent, fontFamily: "Inter_700Bold" }]}>
                Report Incident
              </Text>
            </Pressable>
          </View>

          <View style={[styles.footer, { borderTopColor: colors.border }]}>
            <View style={styles.avatarWrap}>
              <View style={[styles.avatar, { backgroundColor: colors.primary }]}>
                <Text style={[styles.avatarText, { fontFamily: "Inter_700Bold" }]}>{initials}</Text>
              </View>
              <View
                style={[
                  styles.statusDot,
                  {
                    backgroundColor: alertCount > 0 ? "#BE185D" : "#16A34A",
                    borderColor: colors.background,
                  },
                ]}
              />
            </View>
            <View style={styles.footerInfo}>
              <Text
                style={[styles.footerName, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}
                numberOfLines={1}
              >
                {displayName}
              </Text>
              <Text
                style={[styles.footerRole, { color: colors.mutedForeground, fontFamily: "Inter_500Medium" }]}
                numberOfLines={1}
              >
                {displayRole}
              </Text>
            </View>
          </View>
        </Animated.View>

        <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu" />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, flexDirection: "row" },
  drawer: {
    width: DRAWER_WIDTH,
    borderRightWidth: StyleSheet.hairlineWidth,
    zIndex: 2,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(17,24,39,0.35)",
  },
  logoRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 56,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopWidth: 3,
  },
  logoLink: { flexDirection: "row", alignItems: "center", gap: 8, flex: 1 },
  logo: { width: 36, height: 28 },
  logoText: { fontSize: 16 },
  closeBtn: { padding: 6, borderRadius: 10 },
  navScroll: { flex: 1 },
  navContent: { paddingVertical: 16, paddingHorizontal: 8 },
  sectionGap: { marginTop: 20 },
  groupHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
    paddingHorizontal: 12,
  },
  groupLine: { width: 1, height: 12, borderRadius: 1 },
  groupLabel: { fontSize: 10, letterSpacing: 1.4 },
  navItem: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 2,
  },
  navLabel: { flex: 1, fontSize: 13 },
  navBadge: {
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  navBadgeText: { color: "#FFFFFF", fontSize: 10 },
  settingsSection: {
    marginTop: 20,
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  reportSection: { paddingHorizontal: 12, paddingBottom: 8 },
  reportBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  reportBtnText: { fontSize: 13 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  avatarWrap: { position: "relative" },
  avatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#FFFFFF", fontSize: 12 },
  statusDot: {
    position: "absolute",
    bottom: -1,
    right: -1,
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
  },
  footerInfo: { flex: 1, minWidth: 0 },
  footerName: { fontSize: 13 },
  footerRole: { fontSize: 11, marginTop: 1 },
});
