import { Monitor, Moon, Sun } from "lucide-react";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import type { ThemeMode } from "@/services/accessibilityService";

const MODES: { id: ThemeMode; icon: typeof Sun; labelKey: string }[] = [
  { id: "light", icon: Sun, labelKey: "accessibility.theme.light" },
  { id: "dark", icon: Moon, labelKey: "accessibility.theme.dark" },
  { id: "system", icon: Monitor, labelKey: "accessibility.theme.system" },
];

export function AuthThemeToggle() {
  const { prefs, setThemeMode, loading, translate } = useAccessibility();
  const active = prefs?.theme_mode ?? "system";

  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-full border border-cc-border bg-cc-surface p-0.5 shadow-sm"
      role="group"
      aria-label={translate("accessibility.theme")}
    >
      {MODES.map(({ id, icon: Icon, labelKey }) => {
        const selected = active === id;
        return (
          <button
            key={id}
            type="button"
            disabled={loading}
            onClick={() => setThemeMode(id)}
            className={`flex h-8 w-8 items-center justify-center rounded-full transition-colors ${
              selected ? "bg-cc-plum text-white" : "text-cc-muted hover:bg-cc-soft"
            }`}
            aria-pressed={selected}
            aria-label={translate(labelKey)}
            title={translate(labelKey)}
          >
            <Icon size={14} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
