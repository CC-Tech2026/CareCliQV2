import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type ViewToken,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ButtonHeight, Radius, Spacing } from "@/constants/layout";
import { Typography } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import * as Haptics from "@/lib/haptics";
import type { TranslationKey } from "@/lib/i18n/translations";
import { CCQ_ONBOARDING_DONE_KEY } from "@/lib/storage-keys";

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
  const { width } = useWindowDimensions();
  const listRef = useRef<FlatList<(typeof SLIDES)[number]>>(null);
  const [index, setIndex] = useState(0);
  const [pagerHeight, setPagerHeight] = useState(0);
  const last = index === SLIDES.length - 1;

  const finish = async () => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    await AsyncStorage.setItem(CCQ_ONBOARDING_DONE_KEY, "true");
    router.replace("/login" as never);
  };

  const goTo = useCallback(
    (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(nextIndex, SLIDES.length - 1));
      listRef.current?.scrollToIndex({ index: clamped, animated: true });
      setIndex(clamped);
    },
    [],
  );

  const next = () => {
    void Haptics.selectionAsync();
    if (last) {
      void finish();
      return;
    }
    goTo(index + 1);
  };

  const onViewableItemsChanged = useRef(({ viewableItems }: { viewableItems: ViewToken[] }) => {
    const first = viewableItems[0];
    if (first?.index != null) {
      setIndex(first.index);
    }
  }).current;

  const viewabilityConfig = useRef({ viewAreaCoveragePercentThreshold: 60 }).current;

  const onScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(e.nativeEvent.contentOffset.x / width);
    if (nextIndex !== index && nextIndex >= 0 && nextIndex < SLIDES.length) {
      void Haptics.selectionAsync();
      setIndex(nextIndex);
    }
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
      <View style={[styles.topRow, { paddingHorizontal: 18 }]}>
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

      <View
        style={styles.pager}
        onLayout={(e) => setPagerHeight(e.nativeEvent.layout.height)}
      >
        {pagerHeight > 0 ? (
          <FlatList
            ref={listRef}
            data={SLIDES}
            keyExtractor={(item) => item.titleKey}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            bounces
            onMomentumScrollEnd={onScrollEnd}
            onViewableItemsChanged={onViewableItemsChanged}
            viewabilityConfig={viewabilityConfig}
            getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
            style={{ flex: 1 }}
            renderItem={({ item }) => (
              <View style={[styles.slide, { width, height: pagerHeight }]}>
                <View style={[styles.iconCircle, { backgroundColor: colors.soft }]}>
                  <Feather name={item.icon} size={56} color={colors.primary} />
                </View>
                <Text style={[styles.title, { color: colors.foreground, ...Typography.display }]}>
                  {t(item.titleKey)}
                </Text>
                <Text style={[styles.copy, { color: colors.mutedForeground, ...Typography.body }]}>
                  {t(item.bodyKey)}
                </Text>
              </View>
            )}
          />
        ) : null}
      </View>

      <View style={[styles.footer, { paddingHorizontal: 18 }]}>
        <View style={styles.dots}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[
                styles.dot,
                {
                  backgroundColor: i === index ? colors.accent : colors.soft,
                },
              ]}
            />
          ))}
        </View>

        <Pressable
          onPress={next}
          style={[styles.cta, { backgroundColor: colors.primary, height: ButtonHeight.primary }]}
          accessibilityRole="button"
        >
          <Text style={[styles.ctaText, { color: colors.primaryForeground, fontFamily: "Inter_600SemiBold" }]}>
            {last ? t("onboarding.getStarted") : t("onboarding.next")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
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
  pager: {
    flex: 1,
  },
  slide: {
    alignItems: "center",
    justifyContent: "center",
    gap: 18,
    paddingHorizontal: 26,
  },
  iconCircle: {
    width: 150,
    height: 150,
    borderRadius: 75,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    textAlign: "center",
  },
  copy: {
    textAlign: "center",
    maxWidth: 260,
  },
  footer: {
    marginTop: Spacing[8],
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 7,
    marginBottom: Spacing[16],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cta: {
    borderRadius: Radius.pill,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: {
    fontSize: 14,
  },
});
