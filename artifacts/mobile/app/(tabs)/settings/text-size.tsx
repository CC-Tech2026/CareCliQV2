import React from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SettingsPanelCard } from "@/components/worker/settings/settings-ui";
import { SettingsSubScreen } from "@/components/worker/settings/SettingsSubScreen";
import { usePreferences, type TextScale } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import * as Haptics from "@/lib/haptics";

const TEXT_SIZE_OPTIONS: {
  id: TextScale;
  labelKey: "accessibility.textSize.small" | "accessibility.textSize.default" | "accessibility.textSize.large";
  preview: number;
}[] = [
  { id: "small", labelKey: "accessibility.textSize.small", preview: 13 },
  { id: "default", labelKey: "accessibility.textSize.default", preview: 16 },
  { id: "large", labelKey: "accessibility.textSize.large", preview: 20 },
];

export default function TextSizeSettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { textScale, setTextScale, t } = usePreferences();

  return (
    <SettingsSubScreen showBottomNav={false} title={t("accessibility.fontSize")}>
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 120 }]}
        showsVerticalScrollIndicator={false}
      >
        <SettingsPanelCard label={t("accessibility.textSize")}>
          <View style={styles.list}>
            {TEXT_SIZE_OPTIONS.map((option) => {
              const active = textScale === option.id;
              return (
                <Pressable
                  key={option.id}
                  onPress={() => {
                    setTextScale(option.id);
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
                      styles.optionLabel,
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
      </ScrollView>
    </SettingsSubScreen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: 16, paddingTop: 8 },
  list: { gap: 10 },
  option: {
    width: "100%",
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 18,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  optionLabel: { fontSize: 14, flex: 1 },
});
