import { Feather } from "@expo/vector-icons";
import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { WorkerCardSection } from "@/components/worker/WorkerCardSection";
import { WorkerStackScreen } from "@/components/worker/WorkerStackScreen";
import { usePreferences, type TextScale, type ThemeMode } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { LANGUAGES } from "@/lib/i18n/translations";

const THEME_OPTIONS: { id: ThemeMode; labelKey: "accessibility.theme.system" | "accessibility.theme.light" | "accessibility.theme.dark"; icon: keyof typeof Feather.glyphMap }[] = [
  { id: "system", labelKey: "accessibility.theme.system", icon: "monitor" },
  { id: "light", labelKey: "accessibility.theme.light", icon: "sun" },
  { id: "dark", labelKey: "accessibility.theme.dark", icon: "moon" },
];

const TEXT_SIZE_OPTIONS: { id: TextScale; labelKey: "accessibility.textSize.small" | "accessibility.textSize.default" | "accessibility.textSize.large"; preview: number }[] = [
  { id: "small", labelKey: "accessibility.textSize.small", preview: 13 },
  { id: "default", labelKey: "accessibility.textSize.default", preview: 16 },
  { id: "large", labelKey: "accessibility.textSize.large", preview: 20 },
];

export default function AccessibilityScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { themeMode, setThemeMode, language, setLanguage, textScale, setTextScale, t } = usePreferences();

  return (
    <WorkerStackScreen
      headerTitle={t("nav.accessibility")}
      pageTitle={t("accessibility.title")}
      subtitle={t("accessibility.subtitle")}
      cardsOnBackground
    >
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}>
        <Text style={[styles.eyebrow, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
          {t("accessibility.inclusive")}
        </Text>

        <WorkerCardSection icon="type" title={t("accessibility.fontSize")}>
          <View style={styles.grid}>
            {TEXT_SIZE_OPTIONS.map((option) => {
              const active = textScale === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => setTextScale(option.id)}
                  style={[
                    styles.gridBtn,
                    { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.background },
                  ]}
                >
                  <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontFamily: "Inter_700Bold", fontSize: option.preview }}>
                    Aa
                  </Text>
                  <Text
                    style={[
                      styles.gridLabel,
                      { color: active ? colors.primaryForeground : colors.mutedForeground, fontFamily: active ? "Inter_700Bold" : "Inter_500Medium" },
                    ]}
                  >
                    {t(option.labelKey)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </WorkerCardSection>

        <WorkerCardSection icon="moon" title={t("accessibility.themeHeading")}>
          <View style={styles.stack}>
            {THEME_OPTIONS.map((option) => {
              const active = themeMode === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => setThemeMode(option.id)}
                  style={[
                    styles.themeRow,
                    { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.activeBg : colors.background },
                  ]}
                >
                  <View style={styles.themeRowLeft}>
                    <Feather name={option.icon} size={17} color={active ? colors.primary : colors.mutedForeground} />
                    <Text
                      style={[
                        styles.themeRowLabel,
                        { color: active ? colors.primary : colors.foreground, fontFamily: active ? "Inter_700Bold" : "Inter_600SemiBold" },
                      ]}
                    >
                      {t(option.labelKey)}
                    </Text>
                  </View>
                  {active ? (
                    <Text style={[styles.activeLabel, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                      {t("accessibility.active")}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </WorkerCardSection>

        <WorkerCardSection icon="globe" title={t("accessibility.languageHeading")}>
          <View style={styles.grid}>
            {LANGUAGES.map((lang) => {
              const active = language === lang.code;
              return (
                <Pressable
                  key={lang.code}
                  onPress={() => setLanguage(lang.code)}
                  style={[
                    styles.langBtn,
                    { borderColor: active ? colors.primary : colors.border, backgroundColor: active ? colors.primary : colors.background },
                  ]}
                >
                  <Text style={{ color: active ? colors.primaryForeground : colors.foreground, fontFamily: "Inter_700Bold", fontSize: 14 }}>
                    {lang.nativeLabel}
                  </Text>
                  <Text
                    style={{ color: active ? colors.primaryForeground : colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 }}
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
        </WorkerCardSection>
      </ScrollView>
    </WorkerStackScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: 16, gap: 14 },
  eyebrow: { fontSize: 10, letterSpacing: 1.4 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  gridBtn: {
    flexGrow: 1,
    flexBasis: "28%",
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: "center",
    gap: 6,
  },
  gridLabel: { fontSize: 12 },
  langBtn: {
    flexGrow: 1,
    flexBasis: "45%",
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 12,
    alignItems: "center",
  },
  stack: { gap: 10 },
  themeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
    minHeight: 52,
  },
  themeRowLeft: { flexDirection: "row", alignItems: "center", gap: 10 },
  themeRowLabel: { fontSize: 14 },
  activeLabel: { fontSize: 11 },
  hint: { fontSize: 12, lineHeight: 18 },
});
