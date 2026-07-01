import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api-fetch";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { CareCliQLogoSVG } from "@/components/CareCliQLogoSVG";

const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const PLUM   = "var(--cc-plum)";

const ROLE_KEYS: Record<string, string> = {
  support_worker: "hub.role.supportWorker",
  support_coordinator: "hub.role.supportCoordinator",
  managing_director: "hub.role.managingDirector",
  allied_health: "hub.role.alliedHealth",
  admin: "hub.role.admin",
};

function getInitials(name: string) {
  return name
    .split(" ")
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function HubLayout({ children }: { children: React.ReactNode }) {
  const { translate, setThemeMode } = useAccessibility();
  const { resolvedTheme } = useTheme();
  const { user } = useAuth();
  const isDark =
    resolvedTheme === "dark" ||
    (!resolvedTheme && typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  const toggleTheme = () => setThemeMode(isDark ? "light" : "dark");
  const displayName = user?.full_name || user?.email || translate("hub.role.staffFallback");
  const initials    = getInitials(displayName);
  const role        = translate(ROLE_KEYS[user?.role ?? ""] ?? "hub.role.staffFallback");

  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    apiFetch("/api/hub/org")
      .then((res) => res.ok ? res.json() : Promise.reject())
      .then((data) => setOrgName(data?.organization_name || null))
      .catch(() => setOrgName(null));
  }, []);

  return (
    <div className="min-h-screen" style={{ background: "var(--cc-soft)", color: TEXT }}>

      {/* ── STICKY HEADER ─────────────────────────────── */}
      <header
        className="sticky top-0 z-50"
        style={{ background: "var(--cc-bg)", borderBottom: `1px solid ${BORDER}`, boxShadow: "var(--cc-shadow-sm)" }}
      >
        {/* Plum accent line */}
        <div style={{ height: 3, background: PLUM }} />

        <div className="px-4">
          <div className="flex h-14 items-center justify-between">

            {/* LEFT — logo + org */}
            <div className="flex items-center gap-4">
              <CareCliQLogoSVG size={70} />
              <div
                className="hidden h-5 w-px sm:block"
                style={{ background: BORDER }}
              />
              <span
                className="hidden text-[13px] font-semibold sm:block"
                style={{ color: TEXT }}
              >
                {orgName ?? translate("hub.orgFallback")}
              </span>
            </div>

            {/* RIGHT — theme toggle + role + name + avatar */}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={toggleTheme}
                title={isDark ? translate("layout.theme.lightMode") : translate("layout.theme.darkMode")}
                aria-label={isDark ? translate("layout.theme.switchToLight") : translate("layout.theme.switchToDark")}
                className="h-8 w-8 rounded-xl border flex items-center justify-center transition-colors hover:bg-cc-soft"
                style={{ borderColor: BORDER, color: MUTED }}
              >
                {isDark ? <Sun size={15} strokeWidth={2} /> : <Moon size={15} strokeWidth={2} />}
              </button>

              <div className="hidden text-right sm:block">
                <div className="text-[11px] font-semibold" style={{ color: MUTED }}>
                  {role}
                </div>
                <div className="text-[13px] font-bold" style={{ color: TEXT }}>
                  {displayName}
                </div>
              </div>

              <div
                className="flex h-9 w-9 items-center justify-center rounded-full text-[12px] font-black"
                style={{ background: "var(--cc-active-bg)", color: PLUM }}
              >
                {initials}
              </div>
            </div>

          </div>
        </div>
      </header>

      {/* ── CONTENT ──────────────────────────────────── */}
      <main className="px-4 py-8">
        {children}
      </main>
    </div>
  );
}
