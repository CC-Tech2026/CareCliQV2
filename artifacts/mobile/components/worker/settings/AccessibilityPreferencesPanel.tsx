import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsSettingRow } from "@/components/worker/settings/SettingsSettingRow";
import { SettingsPanelCard, SettingsSection } from "@/components/worker/settings/settings-ui";
import { usePreferences, type TextScale, type ThemeMode } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { LANGUAGES } from "@/lib/i18n/translations";

const THEME_OPTIONS: {
  id: ThemeMode;
  labelKey: "accessibility.theme.system" | "accessibility.theme.light" | "accessibility.theme.dark";
  icon: keyof typeof Feather.glyphMap;
}[] = [
  { id: "system", labelKey: "accessibility.theme.system", icon: "monitor" },
  { id: "light", labelKey: "accessibility.theme.light", icon: "sun" },
  { id: "dark", labelKey: "accessibility.theme.dark", icon: "moon" },
];

const TEXT_SIZE_OPTIONS: {
  id: TextScale;
  labelKey: "accessibility.textSize.small" | "accessibility.textSize.default" | "accessibility.textSize.large";
  preview: number;
}[] = [
  { id: "small", labelKey: "accessibility.textSize.small", preview: 13 },
  { id: "default", labelKey: "accessibility.textSize.default", preview: 16 },
  { id: "large", labelKey: "accessibility.textSize.large", preview: 20 },
];

type Props = {
  bottomInset?: number;
};

export function AccessibilityPreferencesPanel({ bottomInset = 24 }: Props) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const {
    themeMode,
    setThemeMode,
    language,
    setLanguage,
    textScale,
    setTextScale,
    highContrast,
    setHighContrast,
    dyslexiaFont,
    setDyslexiaFont,
    t,
  } = usePreferences();

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + bottomInset }]}
      showsVerticalScrollIndicator={false}
    >
      <SettingsSection
        title={t("accessibility.title")}
        description={t("accessibility.subtitle")}
        icon="sliders"
      >
      <SettingsPanelCard label={t("accessibility.textSize")}>
        <View style={styles.optionGrid}>
          {TEXT_SIZE_OPTIONS.map((option) => {
            const active = textScale === option.id;
            return (
              <Pressable
                key={option.id}
                onPress={() => setTextScale(option.id)}
                style={[
                  styles.gridBtn,
                  {
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.activeBg : colors.background,
                  },
                ]}
              >
                <Text
                  style={{
                    color: active ? colors.primary : colors.foreground,
                    fontFamily: "Inter_700Bold",
                    fontSize: option.preview,
                  }}
                >
                  Aa
                </Text>
                <Text
                  style={[
                    styles.gridLabel,
                    {
                      color: active ? colors.primary : colors.mutedForeground,
                      fontFamily: active ? "Inter_700Bold" : "Inter_500Medium",
                    },
                  ]}
                >
                  {t(option.labelKey)}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </SettingsPanelCard>

      <SettingsPanelCard label={t("accessibility.themeHeading")}>
        {THEME_OPTIONS.map((option, index) => {
          const active = themeMode === option.id;
          return (
            <Pressable
              key={option.id}
              onPress={() => setThemeMode(option.id)}
              style={[
                styles.themeRow,
                index < THEME_OPTIONS.length - 1 && {
                  borderBottomColor: colors.border,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
                active && { backgroundColor: colors.soft },
              ]}
            >
              <View style={styles.themeLeft}>
                <Feather name={option.icon} size={17} color={active ? colors.primary : colors.mutedForeground} />
                <Text
                  style={[
                    styles.themeLabel,
                    {
                      color: active ? colors.primary : colors.foreground,
                      fontFamily: active ? "Inter_700Bold" : "Inter_600SemiBold",
                    },
                  ]}
                >
                  {t(option.labelKey)}
                </Text>
              </View>
              {active ? (
                <Text style={[styles.activeTag, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                  {t("accessibility.active")}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
      </SettingsPanelCard>

      <SettingsPanelCard label={t("accessibility.displayOptions")}>
        <SettingsSettingRow
          title={t("accessibility.highContrast")}
          description={t("accessibility.highContrast.hint")}
          checked={highContrast}
          onCheckedChange={setHighContrast}
          showDivider
        />
        <SettingsSettingRow
          title={t("accessibility.dyslexia")}
          description={t("accessibility.dyslexia.hint")}
          checked={dyslexiaFont}
          onCheckedChange={setDyslexiaFont}
        />
      </SettingsPanelCard>

      <SettingsPanelCard label={t("accessibility.languageHeading")}>
        <View style={styles.langGrid}>
          {LANGUAGES.map((lang) => {
            const active = language === lang.code;
            return (
              <Pressable
                key={lang.code}
                onPress={() => setLanguage(lang.code)}
                style={[
                  styles.langBtn,
                  {
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.activeBg : colors.background,
                  },
                ]}
              >
                <Text
                  style={{
                    color: active ? colors.primary : colors.foreground,
                    fontFamily: "Inter_700Bold",
                    fontSize: 14,
                  }}
                >
                  {lang.nativeLabel}
                </Text>
                <Text
                  style={{
                    color: active ? colors.primary : colors.mutedForeground,
                    fontFamily: "Inter_400Regular",
                    fontSize: 11,
                    marginTop: 2,
                  }}
                >
                  {lang.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t("accessibility.languageHint")}
        </Text>
      </SettingsPanelCard>
      </SettingsSection>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 8, gap: 14 },
  optionGrid: { flexDirection: "row", gap: 10 },
  gridBtn: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: "center",
    gap: 6,
  },
  gridLabel: { fontSize: 11, textAlign: "center" },
  themeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingVertical: 13,
    borderRadius: 12,
    marginHorizontal: -4,
  },
  themeLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  themeLabel: { fontSize: 14 },
  activeTag: { fontSize: 11 },
  langGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginBottom: 12 },
  langBtn: {
    flexGrow: 1,
    flexBasis: "45%",
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  hint: { fontSize: 12, lineHeight: 18 },
});
