import AsyncStorage from "@react-native-async-storage/async-storage";
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useColorScheme } from "react-native";

import {
  getAccessibilityPreferences,
  saveAccessibilityPreferences,
} from "@/lib/accessibility-api";
import {
  CCQ_DYSLEXIA_FONT_KEY,
  CCQ_HIGH_CONTRAST_KEY,
  CCQ_HAPTIC_KEY,
  CCQ_LANGUAGE_KEY,
  CCQ_REDUCE_MOTION_KEY,
  CCQ_TEXT_SCALE_KEY,
  CCQ_THEME_MODE_KEY,
} from "@/lib/storage-keys";
import { setHapticsEnabled } from "@/lib/haptics";
import { setReduceMotionEnabled } from "@/lib/motion";
import { setRuntimeTextScale, TextScaleSubscriber } from "@/lib/text-scale-patch";
import {
  LANGUAGES,
  translate as translateWith,
  type AppLanguage,
  type TranslationKey,
} from "@/lib/i18n/translations";
import { getMobileDeviceId, readMobileAuthToken } from "@/lib/session";

export type ThemeMode = "system" | "light" | "dark";
export type TextScale = "small" | "default" | "large";
export type ResolvedScheme = "light" | "dark";

const TEXT_SCALE_VALUES: Record<TextScale, number> = {
  small: 0.9,
  default: 1,
  large: 1.15,
};

type PreferencesContextValue = {
  themeMode: ThemeMode;
  resolvedScheme: ResolvedScheme;
  setThemeMode: (mode: ThemeMode) => void;
  language: AppLanguage;
  setLanguage: (language: AppLanguage) => void;
  textScale: TextScale;
  textScaleValue: number;
  setTextScale: (scale: TextScale) => void;
  highContrast: boolean;
  setHighContrast: (enabled: boolean) => void;
  dyslexiaFont: boolean;
  setDyslexiaFont: (enabled: boolean) => void;
  reduceMotion: boolean;
  setReduceMotion: (enabled: boolean) => void;
  hapticFeedback: boolean;
  setHapticFeedback: (enabled: boolean) => void;
  t: (key: TranslationKey, params?: Record<string, string | number>) => string;
  isReady: boolean;
};

export const PreferencesContext = createContext<PreferencesContextValue | null>(null);

const VALID_LANGUAGES = new Set(LANGUAGES.map((l) => l.code));

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "system" || value === "light" || value === "dark";
}

function isTextScale(value: string | null): value is TextScale {
  return value === "small" || value === "default" || value === "large";
}

function parseBool(value: string | null): boolean {
  return value === "true";
}

function mapApiLanguage(value: string | null | undefined): AppLanguage | null {
  if (!value) return null;
  if (value === "zh-Hans") return "zh";
  if (VALID_LANGUAGES.has(value as AppLanguage)) return value as AppLanguage;
  return null;
}

function mapApiFontSize(value: string | undefined): TextScale | null {
  if (value === "small" || value === "default" || value === "large") return value;
  if (value === "xl") return "large";
  return null;
}

async function persistAccessibility(
  prefs: Partial<{
    font_size: TextScale;
    theme_mode: ThemeMode;
    high_contrast: boolean;
    dyslexia_font: boolean;
  }>,
) {
  try {
    const token = await readMobileAuthToken();
    if (!token) return;
    const deviceId = await getMobileDeviceId();
    await saveAccessibilityPreferences(deviceId, prefs);
  } catch {
    /* sync best-effort */
  }
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const deviceScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");
  const [language, setLanguageState] = useState<AppLanguage>("en");
  const [textScale, setTextScaleState] = useState<TextScale>("default");
  const [highContrast, setHighContrastState] = useState(false);
  const [dyslexiaFont, setDyslexiaFontState] = useState(false);
  const [reduceMotion, setReduceMotionState] = useState(false);
  const [hapticFeedback, setHapticFeedbackState] = useState(true);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [
          storedTheme,
          storedLang,
          storedScale,
          storedContrast,
          storedDyslexia,
          storedMotion,
          storedHaptic,
        ] = await AsyncStorage.multiGet([
          CCQ_THEME_MODE_KEY,
          CCQ_LANGUAGE_KEY,
          CCQ_TEXT_SCALE_KEY,
          CCQ_HIGH_CONTRAST_KEY,
          CCQ_DYSLEXIA_FONT_KEY,
          CCQ_REDUCE_MOTION_KEY,
          CCQ_HAPTIC_KEY,
        ]);
        if (!active) return;
        if (isThemeMode(storedTheme[1])) setThemeModeState(storedTheme[1]);
        if (storedLang[1] && VALID_LANGUAGES.has(storedLang[1] as AppLanguage)) {
          setLanguageState(storedLang[1] as AppLanguage);
        }
        if (isTextScale(storedScale[1])) setTextScaleState(storedScale[1]);
        setHighContrastState(parseBool(storedContrast[1]));
        setDyslexiaFontState(parseBool(storedDyslexia[1]));
        const motionOn = parseBool(storedMotion[1]);
        const hapticOn = storedHaptic[1] === null ? true : parseBool(storedHaptic[1]);
        setReduceMotionState(motionOn);
        setHapticFeedbackState(hapticOn);
        setReduceMotionEnabled(motionOn);
        setHapticsEnabled(hapticOn && !motionOn);

        const token = await readMobileAuthToken();
        if (!token) return;
        const deviceId = await getMobileDeviceId();
        const remote = await getAccessibilityPreferences(deviceId);
        if (!active || !remote.preferences) return;

        const prefs = remote.preferences;
        if (isThemeMode(prefs.theme_mode)) setThemeModeState(prefs.theme_mode);
        const fontSize = mapApiFontSize(prefs.font_size);
        if (fontSize) setTextScaleState(fontSize);
        setHighContrastState(Boolean(prefs.high_contrast));
        setDyslexiaFontState(Boolean(prefs.dyslexia_font));

        const apiLang = mapApiLanguage(remote.preferred_language);
        if (apiLang) setLanguageState(apiLang);
      } catch {
        /* use defaults */
      } finally {
        if (active) setIsReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    setRuntimeTextScale(TEXT_SCALE_VALUES[textScale]);
  }, [textScale]);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    void AsyncStorage.setItem(CCQ_THEME_MODE_KEY, mode);
    void persistAccessibility({ theme_mode: mode });
  }, []);

  const setLanguage = useCallback((next: AppLanguage) => {
    setLanguageState(next);
    void AsyncStorage.setItem(CCQ_LANGUAGE_KEY, next);
  }, []);

  const setTextScale = useCallback((scale: TextScale) => {
    setTextScaleState(scale);
    void AsyncStorage.setItem(CCQ_TEXT_SCALE_KEY, scale);
    void persistAccessibility({ font_size: scale });
  }, []);

  const setHighContrast = useCallback((enabled: boolean) => {
    setHighContrastState(enabled);
    void AsyncStorage.setItem(CCQ_HIGH_CONTRAST_KEY, String(enabled));
    void persistAccessibility({ high_contrast: enabled });
  }, []);

  const setDyslexiaFont = useCallback((enabled: boolean) => {
    setDyslexiaFontState(enabled);
    void AsyncStorage.setItem(CCQ_DYSLEXIA_FONT_KEY, String(enabled));
    void persistAccessibility({ dyslexia_font: enabled });
  }, []);

  const setReduceMotion = useCallback((enabled: boolean) => {
    setReduceMotionState(enabled);
    setReduceMotionEnabled(enabled);
    void AsyncStorage.setItem(CCQ_REDUCE_MOTION_KEY, String(enabled));
    setHapticFeedbackState((prev) => {
      setHapticsEnabled(prev && !enabled);
      return prev;
    });
  }, []);

  const setHapticFeedback = useCallback((enabled: boolean) => {
    setHapticFeedbackState(enabled);
    void AsyncStorage.setItem(CCQ_HAPTIC_KEY, String(enabled));
    setReduceMotionState((motion) => {
      setHapticsEnabled(enabled && !motion);
      return motion;
    });
  }, []);

  const resolvedScheme: ResolvedScheme =
    themeMode === "system" ? (deviceScheme === "dark" ? "dark" : "light") : themeMode;

  const t = useCallback(
    (key: TranslationKey, params?: Record<string, string | number>) =>
      translateWith(language, key, params),
    [language],
  );

  const value = useMemo<PreferencesContextValue>(
    () => ({
      themeMode,
      resolvedScheme,
      setThemeMode,
      language,
      setLanguage,
      textScale,
      textScaleValue: TEXT_SCALE_VALUES[textScale],
      setTextScale,
      highContrast,
      setHighContrast,
      dyslexiaFont,
      setDyslexiaFont,
      reduceMotion,
      setReduceMotion,
      hapticFeedback,
      setHapticFeedback,
      t,
      isReady,
    }),
    [
      themeMode,
      resolvedScheme,
      setThemeMode,
      language,
      setLanguage,
      textScale,
      setTextScale,
      highContrast,
      setHighContrast,
      dyslexiaFont,
      setDyslexiaFont,
      reduceMotion,
      setReduceMotion,
      hapticFeedback,
      setHapticFeedback,
      t,
      isReady,
    ],
  );

  return (
    <PreferencesContext.Provider value={value}>
      <TextScaleSubscriber />
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const ctx = useContext(PreferencesContext);
  if (!ctx) {
    throw new Error("usePreferences must be used within a PreferencesProvider");
  }
  return ctx;
}

/** Convenience hook returning only the translate function. */
export function useT() {
  return usePreferences().t;
}
