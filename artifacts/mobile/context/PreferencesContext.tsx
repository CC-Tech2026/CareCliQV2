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
  CCQ_LANGUAGE_KEY,
  CCQ_TEXT_SCALE_KEY,
  CCQ_THEME_MODE_KEY,
} from "@/lib/storage-keys";
import {
  LANGUAGES,
  translate as translateWith,
  type AppLanguage,
  type TranslationKey,
} from "@/lib/i18n/translations";

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

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  const deviceScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>("system");
  const [language, setLanguageState] = useState<AppLanguage>("en");
  const [textScale, setTextScaleState] = useState<TextScale>("default");
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [storedTheme, storedLang, storedScale] = await AsyncStorage.multiGet([
          CCQ_THEME_MODE_KEY,
          CCQ_LANGUAGE_KEY,
          CCQ_TEXT_SCALE_KEY,
        ]);
        if (!active) return;
        if (isThemeMode(storedTheme[1])) setThemeModeState(storedTheme[1]);
        if (storedLang[1] && VALID_LANGUAGES.has(storedLang[1] as AppLanguage)) {
          setLanguageState(storedLang[1] as AppLanguage);
        }
        if (isTextScale(storedScale[1])) setTextScaleState(storedScale[1]);
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

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    void AsyncStorage.setItem(CCQ_THEME_MODE_KEY, mode);
  }, []);

  const setLanguage = useCallback((next: AppLanguage) => {
    setLanguageState(next);
    void AsyncStorage.setItem(CCQ_LANGUAGE_KEY, next);
  }, []);

  const setTextScale = useCallback((scale: TextScale) => {
    setTextScaleState(scale);
    void AsyncStorage.setItem(CCQ_TEXT_SCALE_KEY, scale);
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
      t,
      isReady,
    }),
    [themeMode, resolvedScheme, setThemeMode, language, setLanguage, textScale, setTextScale, t, isReady],
  );

  return <PreferencesContext.Provider value={value}>{children}</PreferencesContext.Provider>;
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
