import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { getDeviceId } from "@/lib/device-id";
import { useAuth } from "@/contexts/AuthContext";
import { t, tParams, type AppLanguage } from "@/lib/i18n/translations";
import {
  getAccessibilityPreferences,
  saveAccessibilityPreferences,
  updatePreferredLanguage,
  type AccessibilityPreferences,
  type FontSize,
  type ThemeMode,
} from "@/services/accessibilityService";
import {
  applyThemeModeImmediate,
  getStoredThemeMode,
  THEME_STORAGE_KEY,
} from "@/lib/theme-apply";

type AccessibilityContextValue = {
  prefs: AccessibilityPreferences | null;
  language: AppLanguage;
  loading: boolean;
  setFontSize: (size: FontSize) => Promise<void>;
  setThemeMode: (mode: ThemeMode) => void;
  setHighContrast: (enabled: boolean) => Promise<void>;
  setDyslexiaFont: (enabled: boolean) => Promise<void>;
  setLanguage: (lang: AppLanguage) => Promise<void>;
  translate: (key: string) => string;
  translateParams: (key: string, params: Record<string, string>) => string;
};

const AccessibilityContext = createContext<AccessibilityContextValue | null>(null);

const THEME_PERSIST_DEBOUNCE_MS = 5000;

const FONT_SCALE: Record<FontSize, string> = {
  small: "0.9",
  default: "1",
  large: "1.18",
  xl: "1.4",
};

export { FONT_SCALE };

function applyDocumentClasses(prefs: AccessibilityPreferences | null, language: AppLanguage) {
  const root = document.documentElement;
  root.style.setProperty("--font-scale", FONT_SCALE[prefs?.font_size ?? "default"]);
  root.classList.toggle("high-contrast", Boolean(prefs?.high_contrast));
  root.classList.toggle("font-dyslexic", Boolean(prefs?.dyslexia_font));
  root.setAttribute("lang", language);
  root.setAttribute("dir", language === "ar" ? "rtl" : "ltr");
}

function ThemeSync({ themeMode }: { themeMode: ThemeMode | undefined }) {
  const { setTheme } = useTheme();
  useEffect(() => {
    if (!themeMode) return;
    applyThemeModeImmediate(themeMode);
    setTheme(themeMode);
  }, [themeMode, setTheme]);
  return null;
}

export function AccessibilityProvider({ children }: { children: ReactNode }) {
  const deviceId = useMemo(() => getDeviceId(), []);
  const { isAuthenticated } = useAuth();
  const [prefs, setPrefs] = useState<AccessibilityPreferences | null>(null);
  const [language, setLanguageState] = useState<AppLanguage>("en");
  const [loading, setLoading] = useState(true);
  const themePersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingThemeRef = useRef<ThemeMode | null>(null);

  useEffect(() => {
    let active = true;
    
    // Boot from localStorage so theme matches pre-React paint (see theme-apply.ts).
    const bootTheme = getStoredThemeMode();
    const defaults: AccessibilityPreferences = {
      font_size: "default",
      theme_mode: bootTheme,
      high_contrast: false,
      dyslexia_font: false,
      device_id: deviceId,
    };
    setPrefs(defaults);
    applyDocumentClasses(defaults, "en");
    applyThemeModeImmediate(bootTheme);
    
    // Only fetch from backend if authenticated
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    
    getAccessibilityPreferences(deviceId)
      .then((res) => {
        if (!active) return;
        setPrefs(res.preferences);
        setLanguageState(res.preferred_language || "en");
        applyDocumentClasses(res.preferences, res.preferred_language || "en");
        applyThemeModeImmediate(res.preferences.theme_mode ?? "system");
      })
      .catch(() => {
        if (!active) return;
        setPrefs(defaults);
        applyDocumentClasses(defaults, "en");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [deviceId, isAuthenticated]);

  /** Re-apply theme when OS preference changes while in system mode. */
  useEffect(() => {
    if (prefs?.theme_mode !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyThemeModeImmediate("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [prefs?.theme_mode]);

  const persist = useCallback(
    async (patch: Partial<AccessibilityPreferences>) => {
      const res = await saveAccessibilityPreferences(deviceId, patch);
      setPrefs(res.preferences);
      applyDocumentClasses(res.preferences, language);
      return res.preferences;
    },
    [deviceId, language],
  );

  const scheduleThemePersist = useCallback(
    (theme_mode: ThemeMode) => {
      pendingThemeRef.current = theme_mode;
      if (themePersistTimerRef.current) clearTimeout(themePersistTimerRef.current);
      themePersistTimerRef.current = setTimeout(() => {
        themePersistTimerRef.current = null;
        const mode = pendingThemeRef.current;
        pendingThemeRef.current = null;
        if (mode) void persist({ theme_mode: mode }).catch(() => undefined);
      }, THEME_PERSIST_DEBOUNCE_MS);
    },
    [persist],
  );

  useEffect(() => {
    return () => {
      if (themePersistTimerRef.current) {
        clearTimeout(themePersistTimerRef.current);
        themePersistTimerRef.current = null;
      }
      const mode = pendingThemeRef.current;
      pendingThemeRef.current = null;
      if (mode) void persist({ theme_mode: mode }).catch(() => undefined);
    };
  }, [persist]);

  const applyPrefsPatch = useCallback(
    (patch: Partial<AccessibilityPreferences>) => {
      setPrefs((prev) => {
        const next: AccessibilityPreferences = prev
          ? { ...prev, ...patch }
          : {
              font_size: "default",
              theme_mode: "system",
              high_contrast: false,
              dyslexia_font: false,
              device_id: deviceId,
              ...patch,
            };
        applyDocumentClasses(next, language);
        return next;
      });
    },
    [deviceId, language],
  );

  const setThemeMode = useCallback(
    (theme_mode: ThemeMode) => {
      applyThemeModeImmediate(theme_mode);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, theme_mode);
      } catch {
        /* noop */
      }
      setPrefs((prev) => {
        const next: AccessibilityPreferences = prev
          ? { ...prev, theme_mode }
          : {
              font_size: "default",
              theme_mode,
              high_contrast: false,
              dyslexia_font: false,
              device_id: deviceId,
            };
        return next;
      });
      if (isAuthenticated) scheduleThemePersist(theme_mode);
    },
    [deviceId, isAuthenticated, scheduleThemePersist],
  );

  const value = useMemo<AccessibilityContextValue>(
    () => ({
      prefs,
      language,
      loading,
      setFontSize: async (font_size) => {
        applyPrefsPatch({ font_size });
        await persist({ font_size });
      },
      setThemeMode,
      setHighContrast: async (high_contrast) => {
        applyPrefsPatch({ high_contrast });
        await persist({ high_contrast });
      },
      setDyslexiaFont: async (dyslexia_font) => {
        applyPrefsPatch({ dyslexia_font });
        await persist({ dyslexia_font });
      },
      setLanguage: async (lang) => {
        await updatePreferredLanguage(lang);
        setLanguageState(lang);
        applyDocumentClasses(prefs, lang);
      },
      translate: (key) => t(language, key),
      translateParams: (key, params) => tParams(language, key, params),
    }),
    [prefs, language, loading, persist, setThemeMode, applyPrefsPatch],
  );

  return (
    <AccessibilityContext.Provider value={value}>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey={THEME_STORAGE_KEY} disableTransitionOnChange>
        <ThemeSync themeMode={prefs?.theme_mode} />
        {children}
      </ThemeProvider>
    </AccessibilityContext.Provider>
  );
}

export function useAccessibility() {
  const ctx = useContext(AccessibilityContext);
  if (!ctx) throw new Error("useAccessibility must be used within AccessibilityProvider");
  return ctx;
}
