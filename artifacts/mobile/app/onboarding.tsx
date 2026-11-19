import { Feather } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { LanguageNotePreview, NoteGuidePreview } from "@/components/onboarding/OnboardingVisuals";
import { FontFamily } from "@/constants/typography";
import { useT } from "@/context/PreferencesContext";
import { useColors } from "@/hooks/useColors";
import type { TranslationKey } from "@/lib/i18n/translations";
import { CCQ_ONBOARDING_DONE_KEY } from "@/lib/storage-keys";

type Slide = { title: TranslationKey; body: TranslationKey; visual: "photo" | "language" | "guide" };

const SLIDES: readonly Slide[] = [
  { title: "onboarding.slide1.title", body: "onboarding.slide1.body", visual: "photo" },
  { title: "onboarding.slide2.title", body: "onboarding.slide2.body", visual: "language" },
  { title: "onboarding.slide3.title", body: "onboarding.slide3.body", visual: "guide" },
];
/** The step after the slides: the welcome page with sign in. */
const WELCOME = SLIDES.length;

// Flat Charcoal Navy shade over the welcome photo so white text reads on it
// (no gradient, matching the web sign-in pages).
const PHOTO_SHADE = "rgba(26,26,46,0.58)";

export default function OnboardingScreen() {
  const colors = useColors();
  const t = useT();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let mounted = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((on) => mounted && setReduceMotion(on));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);

  function goTo(next: number) {
    const target = Math.max(0, Math.min(WELCOME, next));
    if (target === step) return;
    if (reduceMotion) {
      setStep(target);
      return;
    }
    Animated.timing(fade, { toValue: 0, duration: 120, useNativeDriver: true }).start(() => {
      setStep(target);
      Animated.timing(fade, { toValue: 1, duration: 220, useNativeDriver: true }).start();
    });
  }

  // Swipe left and right between slides.
  const stepRef = useRef(step);
  stepRef.current = step;
  const pan = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) > 18 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderRelease: (_, g) => {
          if (g.dx < -50) goTo(stepRef.current + 1);
          else if (g.dx > 50) goTo(stepRef.current - 1);
        },
      }),
    // goTo reads the latest step through stepRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reduceMotion],
  );

  async function finish(route: "/login" | "/activate-account") {
    if (busy) return;
    setBusy(true);
    try {
      await AsyncStorage.setItem(CCQ_ONBOARDING_DONE_KEY, "true");
    } catch {
      /* Onboarding can be shown again if local storage is unavailable. */
    }
    router.replace(route as never);
  }

  // One fading container holds every step (the welcome page included), so a
  // step change only swaps its contents.
  const welcome = (
      <View style={styles.fill}>
        <Image
          source={require("@/assets/images/welcome-active.jpg")}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          contentPosition={{ left: "38%", top: "50%" }}
          accessibilityLabel={t("onboarding.photo.active")}
        />
        <View style={[StyleSheet.absoluteFill, { backgroundColor: PHOTO_SHADE }]} />
        <View
          style={[
            styles.welcome,
            { paddingTop: insets.top + 24, paddingBottom: Math.max(insets.bottom, 20) + 8 },
          ]}
        >
          <View style={styles.logoBadge}>
            <Image
              source={require("@/assets/animate/carecliq-logo-final.png")}
              style={styles.logoImage}
              contentFit="contain"
              accessibilityLabel="CareCliQ"
            />
          </View>
          <View style={styles.welcomeText}>
            <Text accessibilityRole="header" style={styles.welcomeTitle}>
              {t("onboarding.welcome.title")}
            </Text>
            <Text style={styles.welcomeBody}>{t("onboarding.welcome.body")}</Text>
          </View>
          <View style={styles.welcomeActions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void finish("/login")}
              style={({ pressed }) => [styles.lightButton, { opacity: busy || pressed ? 0.85 : 1 }]}
            >
              <Text style={styles.lightButtonText}>{t("onboarding.welcome.signIn")}</Text>
            </Pressable>
            <Text style={styles.invited}>{t("auth.login.noAccount")}</Text>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => void finish("/activate-account")}
              style={({ pressed }) => [styles.outlineButton, { opacity: busy || pressed ? 0.85 : 1 }]}
            >
              <Text style={styles.outlineButtonText}>{t("onboarding.welcome.activate")}</Text>
            </Pressable>
          </View>
        </View>
      </View>
  );

  const slide = SLIDES[Math.min(step, SLIDES.length - 1)];
  const mediaHeight = Math.round(height * 0.5);

  return (
    <View
      style={[styles.fill, { backgroundColor: step === WELCOME ? "#1A1A2E" : colors.background }]}
      {...pan.panHandlers}
    >
      <Animated.View style={[styles.fill, { opacity: fade }]}>
        {step === WELCOME ? welcome : (
        <>
        <View style={[styles.media, { height: mediaHeight }]}>
          {slide.visual === "photo" ? (
            <Image
              source={require("@/assets/images/welcome-together.jpg")}
              style={StyleSheet.absoluteFill}
              contentFit="cover"
              contentPosition={{ left: "52%", top: "50%" }}
              accessibilityLabel={t("onboarding.photo.together")}
            />
          ) : slide.visual === "language" ? (
            <View style={[styles.previewWrap, { paddingTop: insets.top + 36 }]}>
              <LanguageNotePreview />
            </View>
          ) : (
            <View style={[styles.previewWrap, { paddingTop: insets.top + 36 }]}>
              <NoteGuidePreview />
            </View>
          )}
        </View>

        <View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 20) + 8 }]}>
          <View
            style={styles.dots}
            accessible
            accessibilityRole="progressbar"
            accessibilityLabel={t("onboarding.progress", { step: step + 1, total: SLIDES.length })}
            accessibilityValue={{ min: 1, max: SLIDES.length, now: step + 1 }}
          >
            {SLIDES.map((item, index) => (
              <View
                key={item.title}
                style={[
                  styles.dot,
                  index === step
                    ? { width: 22, backgroundColor: colors.primary }
                    : { backgroundColor: colors.mutedForeground, opacity: 0.35 },
                ]}
              />
            ))}
          </View>
          <View style={styles.copy} accessibilityLiveRegion="polite">
            <Text accessibilityRole="header" style={[styles.title, { color: colors.foreground }]}>
              {t(slide.title)}
            </Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>{t(slide.body)}</Text>
          </View>
          <View style={styles.footer}>
            {step > 0 ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => goTo(step - 1)}
                hitSlop={8}
                style={styles.backButton}
              >
                <Feather name="arrow-left" size={18} color={colors.foreground} />
                <Text style={[styles.backText, { color: colors.foreground }]}>{t("common.back")}</Text>
              </Pressable>
            ) : (
              <View />
            )}
            <Pressable
              accessibilityRole="button"
              onPress={() => goTo(step + 1)}
              style={({ pressed }) => [
                styles.nextButton,
                { backgroundColor: colors.primary, opacity: pressed ? 0.88 : 1 },
              ]}
            >
              <Text style={[styles.nextText, { color: colors.primaryForeground }]}>
                {t("onboarding.next")}
              </Text>
              <Feather name="arrow-right" size={18} color={colors.primaryForeground} />
            </Pressable>
          </View>
        </View>
        </>
        )}
      </Animated.View>

      {step !== WELCOME && (
        <Pressable
          accessibilityRole="button"
          onPress={() => goTo(WELCOME)}
          hitSlop={8}
          style={[styles.skip, { top: insets.top + 10, backgroundColor: "rgba(26,26,46,0.45)" }]}
        >
          <Text style={styles.skipText}>{t("onboarding.skip")}</Text>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  media: { width: "100%", overflow: "hidden" },
  previewWrap: { flex: 1 },
  sheet: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 22,
    gap: 18,
  },
  dots: { flexDirection: "row", gap: 6, alignItems: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  copy: { gap: 10, flex: 1 },
  title: { fontFamily: FontFamily.display, fontSize: 26, lineHeight: 32, letterSpacing: -0.3 },
  body: { fontFamily: FontFamily.interRegular, fontSize: 16, lineHeight: 24 },
  footer: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backButton: { flexDirection: "row", alignItems: "center", gap: 6, minHeight: 48, paddingRight: 8 },
  backText: { fontFamily: FontFamily.interMedium, fontSize: 15 },
  nextButton: {
    minHeight: 52,
    minWidth: 140,
    borderRadius: 14,
    paddingHorizontal: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  nextText: { fontFamily: FontFamily.interSemiBold, fontSize: 16 },
  skip: {
    position: "absolute",
    right: 16,
    borderRadius: 999,
    paddingHorizontal: 14,
    minHeight: 36,
    justifyContent: "center",
  },
  skipText: { fontFamily: FontFamily.interSemiBold, fontSize: 14, color: "#FFFFFF" },

  welcome: { flex: 1, paddingHorizontal: 24, justifyContent: "space-between" },
  logoBadge: {
    alignSelf: "flex-start",
    backgroundColor: "#F9F5EF",
    borderRadius: 20,
    padding: 6,
  },
  logoImage: { width: 96, height: 89 },
  welcomeText: { gap: 12, marginTop: "auto", marginBottom: 28 },
  welcomeTitle: {
    fontFamily: FontFamily.display,
    fontSize: 32,
    lineHeight: 38,
    letterSpacing: -0.4,
    color: "#FFFFFF",
  },
  welcomeBody: { fontFamily: FontFamily.interRegular, fontSize: 17, lineHeight: 25, color: "rgba(255,255,255,0.85)" },
  welcomeActions: { gap: 10 },
  lightButton: {
    minHeight: 54,
    borderRadius: 14,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },
  lightButtonText: { fontFamily: FontFamily.interSemiBold, fontSize: 16, color: "#1A1A2E" },
  invited: {
    textAlign: "center",
    fontFamily: FontFamily.interRegular,
    fontSize: 14,
    color: "rgba(255,255,255,0.85)",
    marginTop: 6,
  },
  outlineButton: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.85)",
    alignItems: "center",
    justifyContent: "center",
  },
  outlineButtonText: { fontFamily: FontFamily.interSemiBold, fontSize: 16, color: "#FFFFFF" },
});
