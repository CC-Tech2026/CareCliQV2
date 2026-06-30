import { useState } from "react";
import { Accessibility, Globe, Loader2, Monitor, Moon, Sun, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import type { AppLanguage, FontSize, ThemeMode } from "@/services/accessibilityService";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

const FONT_OPTIONS: { id: FontSize; labelKey: string }[] = [
  { id: "small", labelKey: "accessibility.font.small" },
  { id: "default", labelKey: "accessibility.font.default" },
  { id: "large", labelKey: "accessibility.font.large" },
  { id: "xl", labelKey: "accessibility.font.xl" },
];

const THEME_OPTIONS: { id: ThemeMode; labelKey: string; icon: typeof Sun }[] = [
  { id: "system", labelKey: "accessibility.theme.system", icon: Monitor },
  { id: "light", labelKey: "accessibility.theme.light", icon: Sun },
  { id: "dark", labelKey: "accessibility.theme.dark", icon: Moon },
];

const LANGUAGE_OPTIONS: { id: AppLanguage; label: string }[] = [
  { id: "en", label: "English" },
  { id: "vi", label: "Tiếng Việt" },
  { id: "ar", label: "العربية" },
  { id: "zh-Hans", label: "简体中文" },
];

export default function WorkerAccessibility() {
  const { toast } = useToast();
  const { user } = useAuth();
  const {
    prefs,
    language,
    loading,
    setFontSize,
    setThemeMode,
    setHighContrast,
    setDyslexiaFont,
    setLanguage,
    translate,
  } = useAccessibility();
  const [saving, setSaving] = useState(false);

  async function run<T>(action: () => Promise<T>) {
    setSaving(true);
    try {
      await action();
    } catch (e) {
      toast({
        title: translate("common.error"),
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading || !prefs) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center" role="status" aria-live="polite">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: PLUM }} aria-hidden />
        <span className="sr-only">{translate("common.loading")}</span>
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 pb-24 text-safe">
      <header>
        <p className="text-xs font-black uppercase tracking-wider" style={{ color: PLUM }}>
          {translate("accessibility.inclusive")}
        </p>
        <h1 className="mt-1 text-2xl font-black" style={{ color: TEXT }}>
          {translate("accessibility.title")}
        </h1>
        <p className="mt-2 text-sm font-medium" style={{ color: MUTED }}>
          {translate("accessibility.subtitle")}
        </p>
      </header>

      <section
        className="rounded-2xl border bg-[var(--cc-surface)] p-5 shadow-sm"
        style={{ borderColor: BORDER }}
        aria-labelledby="font-size-heading"
      >
        <div className="mb-4 flex items-center gap-2">
          <Type size={18} style={{ color: PLUM }} aria-hidden />
          <h2 id="font-size-heading" className="text-sm font-black" style={{ color: TEXT }}>
            {translate("accessibility.fontSize")}
          </h2>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {FONT_OPTIONS.map((opt) => (
            <Button
              key={opt.id}
              type="button"
              variant={prefs.font_size === opt.id ? "default" : "outline"}
              className="h-auto min-h-[44px] py-2 text-xs font-bold"
              style={prefs.font_size === opt.id ? { background: PLUM } : undefined}
              disabled={saving}
              aria-pressed={prefs.font_size === opt.id}
              onClick={() => run(() => setFontSize(opt.id))}
            >
              {translate(opt.labelKey)}
            </Button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-stretch">
      <section
        className="flex h-full flex-col rounded-2xl border bg-[var(--cc-surface)] p-5 shadow-sm"
        style={{ borderColor: BORDER }}
        aria-labelledby="theme-heading"
      >
        <div className="mb-4 flex items-center gap-2">
          <Moon size={18} style={{ color: PLUM }} aria-hidden />
          <h2 id="theme-heading" className="text-sm font-black" style={{ color: TEXT }}>
            {translate("accessibility.theme")}
          </h2>
        </div>
        <div className="space-y-2" role="radiogroup" aria-label={translate("accessibility.theme")}>
          {THEME_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              role="radio"
              aria-checked={prefs.theme_mode === opt.id}
              disabled={saving}
              onClick={() => setThemeMode(opt.id)}
              className="flex min-h-[44px] w-full items-center justify-between rounded-xl border px-4 py-3 text-left transition hover:bg-[var(--cc-bg)]"
              style={{
                borderColor: prefs.theme_mode === opt.id ? PLUM : BORDER,
                background: prefs.theme_mode === opt.id ? "var(--cc-bg)" : "var(--cc-surface)",
              }}
            >
              <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: TEXT }}>
                <opt.icon size={16} aria-hidden />
                {translate(opt.labelKey)}
              </span>
              {prefs.theme_mode === opt.id && (
                <span className="text-xs font-black" style={{ color: PLUM }}>
                  {translate("accessibility.theme.active")}
                </span>
              )}
            </button>
          ))}
        </div>
      </section>

      <section
        className="flex h-full flex-col rounded-2xl border bg-[var(--cc-surface)] p-5 shadow-sm"
        style={{ borderColor: BORDER }}
        aria-labelledby="display-heading"
      >
        <div className="mb-4 flex items-center gap-2">
          <Accessibility size={18} style={{ color: PLUM }} aria-hidden />
          <h2 id="display-heading" className="text-sm font-black" style={{ color: TEXT }}>
            {translate("accessibility.displayOptions")}
          </h2>
        </div>
        <div className="space-y-4">
          <div className="flex min-h-[44px] items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold" style={{ color: TEXT }}>
                {translate("accessibility.highContrast")}
              </p>
              <p className="text-xs" style={{ color: MUTED }}>
                {translate("accessibility.highContrast.hint")}
              </p>
            </div>
            <Switch
              checked={prefs.high_contrast}
              disabled={saving}
              onCheckedChange={(v) => run(() => setHighContrast(Boolean(v)))}
              aria-label={translate("accessibility.highContrast")}
            />
          </div>
          <div className="flex min-h-[44px] items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold" style={{ color: TEXT }}>
                {translate("accessibility.dyslexia")}
              </p>
              <p className="text-xs" style={{ color: MUTED }}>
                {translate("accessibility.dyslexia.hint")}
              </p>
            </div>
            <Switch
              checked={prefs.dyslexia_font}
              disabled={saving}
              onCheckedChange={(v) => run(() => setDyslexiaFont(Boolean(v)))}
              aria-label={translate("accessibility.dyslexia")}
            />
          </div>
        </div>
      </section>
      </div>

      <section
        className="rounded-2xl border bg-[var(--cc-surface)] p-5 shadow-sm"
        style={{ borderColor: BORDER }}
        aria-labelledby="language-heading"
      >
        <div className="mb-4 flex items-center gap-2">
          <Globe size={18} style={{ color: PLUM }} aria-hidden />
          <h2 id="language-heading" className="text-sm font-black" style={{ color: TEXT }}>
            {translate("accessibility.language")}
          </h2>
        </div>
        <Label className="sr-only">{translate("accessibility.language")}</Label>
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={translate("accessibility.language")}>
          {LANGUAGE_OPTIONS.map((opt) => (
            <Button
              key={opt.id}
              type="button"
              variant={language === opt.id ? "default" : "outline"}
              className="min-h-[44px] font-bold"
              style={language === opt.id ? { background: PLUM } : undefined}
              disabled={saving}
              role="radio"
              aria-checked={language === opt.id}
              onClick={() => run(() => setLanguage(opt.id))}
            >
              {opt.label}
            </Button>
          ))}
        </div>
        <p className="mt-3 text-xs" style={{ color: MUTED }}>
          {translate(
            user?.role === "support_worker"
              ? "accessibility.language.hint"
              : "accessibility.language.hintGeneric",
          )}
        </p>
      </section>
    </div>
  );
}
