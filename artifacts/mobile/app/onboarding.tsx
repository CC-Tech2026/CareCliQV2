import { FontFamily } from "@/constants/typography";
import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import React, { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { OnboardingIllustration } from "@/components/onboarding/OnboardingIllustration";
import { AuthBrandHeader } from "@/components/auth/AuthBrandHeader";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import { CCQ_ONBOARDING_DONE_KEY } from "@/lib/storage-keys";
const features = [
  {
    icon: "calendar",
    title: "onboarding.slide1.title",
    body: "onboarding.slide1.body",
  },
  {
    icon: "edit-3",
    title: "onboarding.slide2.title",
    body: "onboarding.slide2.body",
  },
  {
    icon: "check-circle",
    title: "onboarding.slide3.title",
    body: "onboarding.slide3.body",
  },
] as const;
export default function OnboardingScreen() {
  const colors = useColors();
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const last = step === features.length - 1;
  const feature = features[step];
  function goTo(next: number) {
    setStep(Math.max(0, Math.min(features.length - 1, next)));
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  }
  const [busy, setBusy] = useState(false);
  async function continueTo(route: "/login" | "/activate-account") {
    if (busy) return;
    setBusy(true);
    try {
      await AsyncStorage.setItem(CCQ_ONBOARDING_DONE_KEY, "true");
    } catch {
      /* Onboarding can be shown again if local storage is unavailable. */
    }
    router.replace(route as never);
  }
  return (
    <ScrollView
      ref={scrollRef}
      style={{ flex: 1, backgroundColor: colors.background }}
      contentContainerStyle={[
        styles.page,
        { paddingTop: insets.top, paddingBottom: Math.max(insets.bottom, 20) },
      ]}
    >
      <View style={styles.content}>
        <AuthBrandHeader taglineKey="auth.login.marketing.tagline" compact />
        <View style={styles.progressRow}>
          {step > 0 ? (
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => goTo(step - 1)}
              style={styles.textButton}
            >
              <Feather name="arrow-left" size={16} color={colors.primary} />
              <Text style={[styles.buttonText, { color: colors.primary }]}>
                {t("common.back")}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.navPlaceholder} />
          )}

          <Text
            accessibilityLiveRegion="polite"
            style={[styles.progressText, { color: colors.mutedForeground }]}
          >
            {t("onboarding.progress", {
              step: step + 1,
              total: features.length,
            })}
          </Text>
          {!last ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => goTo(features.length - 1)}
              style={styles.textButton}
            >
              <Text style={[styles.progressText, { color: colors.primary }]}>
                {t("onboarding.skip")}
              </Text>
            </Pressable>
          ) : (
            <View style={styles.navPlaceholder} />
          )}
        </View>
        <View
          accessible
          accessibilityRole="progressbar"
          accessibilityLabel={t("onboarding.progress", {
            step: step + 1,
            total: features.length,
          })}
          accessibilityValue={{ min: 1, max: features.length, now: step + 1 }}
          style={styles.tracks}
        >
          {features.map((item, index) => (
            <View
              key={item.title}
              style={[
                styles.track,
                {
                  backgroundColor: index <= step ? colors.primary : colors.soft,
                },
              ]}
            />
          ))}
        </View>
        <View style={[styles.storyCard, { borderColor: colors.border }]}>
          <View style={styles.illustration}>
            <OnboardingIllustration step={step} />
          </View>
          <View
            key={step}
            accessibilityLiveRegion="polite"
            style={styles.intro}
          >
            <Text
              accessibilityRole="header"
              style={[styles.title, { color: colors.foreground }]}
            >
              {t(feature.title)}
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              {t(feature.body)}
            </Text>
          </View>
          <View style={[styles.actions, { borderColor: colors.border }]}>
            {!last ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => goTo(step + 1)}
                style={[styles.button, { backgroundColor: colors.primary }]}
              >
                <Text
                  style={[
                    styles.buttonText,
                    { color: colors.primaryForeground },
                  ]}
                >
                  {t("onboarding.next")}
                </Text>
                <Feather
                  name="arrow-right"
                  size={18}
                  color={colors.primaryForeground}
                />
              </Pressable>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void continueTo("/login")}
                  style={[
                    styles.button,
                    {
                      backgroundColor: colors.primary,
                      opacity: busy ? 0.6 : 1,
                    },
                  ]}
                >
                  <Text
                    style={[
                      styles.buttonText,
                      { color: colors.primaryForeground },
                    ]}
                  >
                    {t("auth.signup.signIn")}
                  </Text>
                  <Feather
                    name="arrow-right"
                    size={18}
                    color={colors.primaryForeground}
                  />
                </Pressable>
                <Text
                  style={[styles.invite, { color: colors.mutedForeground }]}
                >
                  {t("auth.login.noAccount")}
                </Text>
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() => void continueTo("/activate-account")}
                  style={[
                    styles.button,
                    {
                      borderWidth: 1,
                      borderColor: colors.border,
                      opacity: busy ? 0.6 : 1,
                    },
                  ]}
                >
                  <Text style={[styles.buttonText, { color: colors.primary }]}>
                    {t("auth.login.createAccount")}
                  </Text>
                </Pressable>
              </>
            )}
          </View>
        </View>
      </View>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  page: { flexGrow: 1, paddingHorizontal: 24 },
  content: { width: "100%", maxWidth: 440, alignSelf: "center", gap: 12 },
  progressRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  progressText: { fontFamily: FontFamily.interRegular, fontSize: 13 },
  navPlaceholder: { width: 64 },
  textButton: {
    minWidth: 64,
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  tracks: { flexDirection: "row", gap: 6 },
  track: { flex: 1, height: 2 },
  storyCard: { gap: 22, paddingTop: 10 },
  illustration: {
    width: 220,
    maxWidth: "100%",
    aspectRatio: 1,
    alignSelf: "center",
    overflow: "hidden",
    borderRadius: 8,
  },
  intro: { gap: 8 },
  title: { fontFamily: FontFamily.interSemiBold, fontSize: 24, lineHeight: 31 },
  body: { fontFamily: FontFamily.interRegular, fontSize: 15, lineHeight: 23 },
  actions: {
    gap: 10,
    paddingTop: 18,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  button: {
    minHeight: 48,
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  buttonText: { fontFamily: FontFamily.interSemiBold, fontSize: 15 },
  invite: {
    textAlign: "center",
    fontFamily: FontFamily.interRegular,
    fontSize: 13,
    marginTop: 6,
  },
});
