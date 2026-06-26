import { Monitor, Moon, Sun } from "lucide-react";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import type { ThemeMode } from "@/services/accessibilityService";
import { MUTED, TEXT } from "@/lib/shift-utils";

const MODES: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
];

export function ProfileThemeToggle() {
  const { prefs, setThemeMode, loading } = useAccessibility();
  const active = prefs?.theme_mode ?? "system";

  return (
    <div className="px-4 py-3 border-b border-cc-border">
      <p className="mb-2 px-2 text-[10px] font-black uppercase tracking-widest" style={{ color: MUTED }}>
        Appearance
      </p>
      <div className="grid grid-cols-3 gap-1 rounded-xl border border-cc-border bg-cc-bg p-1">
        {MODES.map(({ id, label, icon: Icon }) => {
          const selected = active === id;
          return (
            <button
              key={id}
              type="button"
              disabled={loading}
              onClick={() => setThemeMode(id)}
              className={`touch-target flex flex-col items-center gap-1 rounded-lg px-2 py-2 text-[11px] font-bold transition-colors ${
                selected ? "bg-cc-surface text-cc-plum shadow-sm" : "text-cc-muted hover:bg-cc-surface/60"
              }`}
              aria-pressed={selected}
            >
              <Icon size={14} aria-hidden />
              <span style={{ color: selected ? TEXT : undefined }}>{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
