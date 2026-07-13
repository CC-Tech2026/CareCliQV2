import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsPanelCard } from "@/components/worker/settings/settings-ui";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { usePreferences } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { LANGUAGES } from "@/lib/i18n/translations";
import * as Haptics from "@/lib/haptics";

export default function LanguageSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { language, setLanguage, t } = usePreferences();

  return (
    <SettingsSubScreen showBottomNav={false} title={t("accessibility.languageHeading")}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <SettingsPanelCard label={t("accessibility.language")}>
          <View style={styles.list}>
            {LANGUAGES.map((lang) => {
              const active = language === lang.code;
              return (
                <Pressable
                  key={lang.code}
                  onPress={() => {
                    setLanguage(lang.code);
                    void Haptics.selectionAsync();
                  }}
                  style={[
                    styles.option,
                    {
                      borderColor: active ? colors.primary : colors.border,
                      backgroundColor: active ? colors.activeBg : colors.background,
                    },
                  ]}
                >
                  <View style={styles.copy}>
                    <Text
                      style={{
                        color: active ? colors.primary : colors.foreground,
                        fontFamily: "Inter_700Bold",
                        fontSize: 15,
                      }}
                    >
                      {lang.nativeLabel}
                    </Text>
                    <Text
                      style={{
                        color: active ? colors.primary : colors.mutedForeground,
                        fontFamily: "Inter_400Regular",
                        fontSize: 12,
                        marginTop: 2,
                      }}
                    >
                      {lang.label}
                    </Text>
                  </View>
                  {active ? (
                    <Text style={[styles.active, { color: colors.primary, fontFamily: "Inter_700Bold" }]}>
                      {t("accessibility.active")}
                    </Text>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.hint, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
            {t("accessibility.languageHint")}
          </Text>
        </SettingsPanelCard>
      </ScrollView>
    </SettingsSubScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  list: { gap: 10, marginBottom: 12 },
  option: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 14,
    flexDirection: "row",
    alignItems: "center",
  },
  copy: { flex: 1 },
  active: { fontSize: 11 },
  hint: { fontSize: 12, lineHeight: 18 },
});
