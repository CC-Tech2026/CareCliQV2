import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import * as Haptics from "@/lib/haptics";
import { CCQ_ONBOARDING_DONE_KEY } from "@/lib/storage-keys";
import type { TranslationKey } from "@/lib/i18n/translations";

const SLIDES: {
  icon: keyof typeof Feather.glyphMap;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
}[] = [
  {
    icon: "mic",
    titleKey: "onboarding.slide1.title",
    bodyKey: "onboarding.slide1.body",
  },
  {
    icon: "shield",
    titleKey: "onboarding.slide2.title",
    bodyKey: "onboarding.slide2.body",
  },
  {
    icon: "grid",
    titleKey: "onboarding.slide3.title",
    bodyKey: "onboarding.slide3.body",
  },
];

export default function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const t = useT();
  const [index, setIndex] = useState(0);
  const last = index === SLIDES.length - 1;
  const slide = SLIDES[index];

  const finish = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await AsyncStorage.setItem(CCQ_ONBOARDING_DONE_KEY, "true");
    router.replace("/login" as never);
  };

  const next = () => {
    void Haptics.selectionAsync();
    if (last) {
      void finish();
      return;
    }
    setIndex((i) => i + 1);
  };

  return (
    <View
      style={[
        styles.root,
        {
          backgroundColor: colors.background,
          paddingTop: insets.top + 8,
          paddingBottom: Math.max(insets.bottom, 16),
        },
      ]}
    >
      <View style={styles.topRow}>
        {last ? (
          <View style={styles.skipPlaceholder} />
        ) : (
          <Pressable onPress={() => void finish()} hitSlop={12} accessibilityRole="button">
            <Text style={[styles.skip, { color: colors.primary, fontFamily: "Inter_500Medium" }]}>
              {t("onboarding.skip")}
            </Text>
          </Pressable>
        )}
      </View>

      <View style={styles.body}>
        <View style={[styles.iconCircle, { backgroundColor: colors.soft }]}>
          <Feather name={slide.icon} size={56} color={colors.primary} />
        </View>
        <Text style={[styles.title, { color: colors.foreground, fontFamily: "Inter_700Bold" }]}>
          {t(slide.titleKey)}
        </Text>
        <Text style={[styles.copy, { color: colors.mutedForeground, fontFamily: "Inter_400Regular" }]}>
          {t(slide.bodyKey)}
        </Text>
      </View>

      <View style={styles.dots}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[
              styles.dot,
              {
                backgroundColor: i === index ? colors.pink : colors.soft,
              },
            ]}
          />
        ))}
      </View>

      <Pressable
        onPress={next}
        style={[styles.cta, { backgroundColor: colors.primary }]}
        accessibilityRole="button"
      >
        <Text style={[styles.ctaText, { fontFamily: "Inter_600SemiBold" }]}>
          {last ? t("onboarding.getStarted") : t("onboarding.next")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    paddingHorizontal: 18,
  },
  topRow: {
    alignItems: "flex-end",
    minHeight: 28,
  },
  skipPlaceholder: { height: 28 },
  skip: {
    fontSize: 13,
    paddingVertical: 4,
    paddingHorizontal: 4,
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    paddingHorizontal: 8,
  },
  iconCircle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 23,
    lineHeight: 28,
    textAlign: "center",
  },
  copy: {
    fontSize: 13,
    lineHeight: 20,
    textAlign: "center",
    maxWidth: 260,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 7,
    marginBottom: 16,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cta: {
    height: 46,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    color: "#FFFFFF",
    fontSize: 14,
  },
});
