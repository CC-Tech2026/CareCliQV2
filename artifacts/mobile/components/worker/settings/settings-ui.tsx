import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { elevatedCardShadow } from "@/components/worker/profile/profile-ui";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { TranslationKey } from "@/lib/i18n/translations";

export type SettingsPillTab<T extends string> = {
  id: T;
  labelKey: TranslationKey;
  icon: keyof typeof Feather.glyphMap;
};

type PillTabsProps<T extends string> = {
  tabs: SettingsPillTab<T>[];
  activeTab: T;
  onChange: (tab: T) => void;
};

export function SettingsPillTabs<T extends string>({ tabs, activeTab, onChange }: PillTabsProps<T>) {
  const colors = useColors();
  const t = useT();

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.pillScroll}
    >
      {tabs.map((tab) => {
        const active = activeTab === tab.id;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onChange(tab.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={[
              styles.pill,
              {
                backgroundColor: active ? colors.primary : colors.activeBg,
                borderColor: active ? colors.primary : "transparent",
              },
            ]}
          >
            <Feather name={tab.icon} size={14} color={active ? "#FFFFFF" : colors.mutedForeground} />
            <Text
              style={[
                styles.pillLabel,
                {
                  color: active ? "#FFFFFF" : colors.foreground,
                  fontFamily: active ? "Inter_700Bold" : "Inter_600SemiBold",
                },
              ]}
            >
              {t(tab.labelKey)}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

export function SettingsPageHeader() {
  const colors = useColors();
  const t = useT();

  return (
    <View
      style={[
        styles.pageHeader,
        {
          backgroundColor: colors.activeBg,
          borderColor: colors.border,
        },
      ]}
    >
      <View style={[styles.pageIcon, { backgroundColor: "rgba(232, 69, 122, 0.12)" }]}>
        <Feather name="settings" size={20} color={colors.primary} />
      </View>
      <View style={styles.pageCopy}>
        <Text style={[styles.pageTitle, { color: colors.navy, fontFamily: "Inter_700Bold" }]}>
          {t("settings.title")}
        </Text>
        <Text style={[styles.pageSubtitle, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("settings.subtitle")}
        </Text>
      </View>
    </View>
  );
}

type SectionProps = {
  title: string;
  description: string;
  icon: keyof typeof Feather.glyphMap;
  children: React.ReactNode;
};

export function SettingsSection({ title, description, icon, children }: SectionProps) {
  const colors = useColors();

  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <View style={[styles.sectionIcon, { backgroundColor: "rgba(232, 69, 122, 0.1)" }]}>
          <Feather name={icon} size={18} color={colors.primary} />
        </View>
        <View style={styles.sectionCopy}>
          <Text style={[styles.sectionTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
            {title}
          </Text>
          <Text style={[styles.sectionDescription, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {description}
          </Text>
        </View>
      </View>
      <View style={styles.sectionBody}>{children}</View>
    </View>
  );
}

type PanelCardProps = {
  label?: string;
  children: React.ReactNode;
};

export function SettingsPanelCard({ label, children }: PanelCardProps) {
  const colors = useColors();
  const isDark = colors.scheme === "dark";

  return (
    <View
      style={[
        styles.panelCard,
        elevatedCardShadow(isDark),
        { backgroundColor: colors.card, borderColor: colors.border },
      ]}
    >
      {label ? (
        <View style={[styles.panelLabelRow, { borderBottomColor: colors.border, backgroundColor: colors.background }]}>
          <Text style={[styles.panelLabel, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>{label}</Text>
        </View>
      ) : null}
      <View style={styles.panelBody}>{children}</View>
    </View>
  );
}

export function SettingsLoadingRow({ label }: { label: string }) {
  const colors = useColors();

  return (
    <View style={styles.loadingRow}>
      <Feather name="loader" size={14} color={colors.mutedForeground} />
      <Text style={[styles.loadingText, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
        {label}
      </Text>
    </View>
  );
}

type SaveButtonProps = {
  label: string;
  saving?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

export function SettingsSaveButton({ label, saving, disabled, onPress }: SaveButtonProps) {
  const colors = useColors();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || saving}
      style={[
        styles.saveBtn,
        {
          backgroundColor: colors.primary,
          opacity: disabled || saving ? 0.55 : 1,
        },
      ]}
    >
      {saving ? (
        <Feather name="loader" size={14} color="#FFFFFF" />
      ) : (
        <Feather name="check" size={14} color="#FFFFFF" />
      )}
      <Text style={[styles.saveBtnText, { fontFamily: "Inter_700Bold" }]}>{label}</Text>
    </Pressable>
  );
}

export function SettingsInfoCallout({ title, children }: { title: string; children: React.ReactNode }) {
  const colors = useColors();

  return (
    <View
      style={[
        styles.callout,
        {
          backgroundColor: colors.activeBg,
          borderColor: colors.border,
          borderLeftColor: colors.primary,
        },
      ]}
    >
      <Text style={[styles.calloutTitle, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  pillScroll: {
    paddingHorizontal: 16,
    paddingBottom: 4,
    gap: 8,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1,
  },
  pillLabel: { fontSize: 12 },
  pageHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginTop: 16,
    marginBottom: 0,
    borderRadius: 18,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  pageIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  pageCopy: { flex: 1, gap: 3 },
  pageTitle: { fontSize: 18, letterSpacing: -0.3, lineHeight: 22 },
  pageSubtitle: { fontSize: 12, lineHeight: 17 },
  section: { gap: 14 },
  sectionHeader: { flexDirection: "row", alignItems: "flex-start", gap: 12 },
  sectionIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  sectionCopy: { flex: 1, gap: 4, paddingTop: 2 },
  sectionTitle: { fontSize: 17, letterSpacing: -0.2, lineHeight: 22 },
  sectionDescription: { fontSize: 12, lineHeight: 18 },
  sectionBody: { gap: 12 },
  panelCard: {
    borderRadius: 18,
    borderWidth: 1,
    overflow: "hidden",
  },
  panelLabelRow: {
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  panelLabel: {
    fontSize: 10,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  panelBody: { padding: 16 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8 },
  loadingText: { fontSize: 13 },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "flex-end",
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 11,
    minWidth: 130,
  },
  saveBtnText: { fontSize: 13, color: "#FFFFFF" },
  callout: {
    borderRadius: 16,
    borderWidth: 1,
    borderLeftWidth: 3,
    padding: 14,
    gap: 8,
  },
  calloutTitle: { fontSize: 13, lineHeight: 18 },
});
