import { useState } from "react";
import { Check } from "lucide-react";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { NAV_INDIGO_NIGHT_HEX } from "@/lib/nav-colors";

/**
 * Nav layout + color picker — originally built for the org Branding
 * settings page (pages/settings.tsx), now also used by the Master System
 * admin portal's Account → Settings → Layout screen. Shared here rather
 * than duplicated so both surfaces stay pixel-identical and any future
 * tweak (a new layout, a new color preset) only needs to happen once.
 */

function LayoutPreview({ variant }: { variant: "topbar" | "sidebar" | "bottombar" }) {
  const PLUM = "var(--cc-plum)";
  const LINE = "var(--cc-border)";
  const SURFACE = "var(--cc-surface)";
  const SOFT = "var(--cc-soft)";

  const headerRow = (
    <div className="flex h-3.5 shrink-0 items-center gap-1 border-b px-1.5" style={{ borderColor: LINE, background: SURFACE }}>
      <div className="h-1.5 w-1.5 rounded-sm shrink-0" style={{ background: PLUM }} />
      <div className="h-1 w-5 rounded-full shrink-0" style={{ background: LINE }} />
      <div className="ml-auto h-1.5 max-w-[24px] flex-1 rounded-full" style={{ background: SOFT }} />
      <div className="h-2 w-2 shrink-0 rounded-full" style={{ background: PLUM }} />
    </div>
  );

  const bodyLines = (
    <div className="flex-1 space-y-1 p-1.5">
      <div className="h-1 w-3/4 rounded-full" style={{ background: LINE }} />
      <div className="h-1 w-1/2 rounded-full" style={{ background: LINE }} />
    </div>
  );

  if (variant === "sidebar") {
    return (
      <div className="flex h-16 w-full overflow-hidden rounded-lg border" style={{ borderColor: LINE, background: SURFACE }}>
        <div className="flex h-full w-4 shrink-0 flex-col items-center gap-1 pt-1.5" style={{ background: PLUM }}>
          <div className="h-1 w-2 rounded-full bg-white/70" />
          <div className="h-1 w-2 rounded-full bg-white/40" />
          <div className="h-1 w-2 rounded-full bg-white/40" />
        </div>
        <div className="flex flex-1 flex-col">
          {headerRow}
          {bodyLines}
        </div>
      </div>
    );
  }

  if (variant === "bottombar") {
    return (
      <div className="relative flex h-16 w-full flex-col overflow-hidden rounded-lg border" style={{ borderColor: LINE, background: SURFACE }}>
        {headerRow}
        {bodyLines}
        <div className="absolute inset-x-0 bottom-1 flex justify-center">
          <div className="flex items-center gap-1 rounded-full border px-1.5 py-1" style={{ borderColor: LINE, background: SURFACE }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-1 w-3 rounded-full" style={{ background: i === 0 ? PLUM : LINE }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-16 w-full flex-col overflow-hidden rounded-lg border" style={{ borderColor: LINE, background: SURFACE }}>
      {headerRow}
      <div className="flex justify-center px-2 pt-1.5">
        <div className="flex items-center gap-1 rounded-full border px-1.5 py-1" style={{ borderColor: LINE, background: SURFACE }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="h-1 w-3 rounded-full" style={{ background: i === 0 ? PLUM : LINE }} />
          ))}
        </div>
      </div>
      <div className="flex-1 space-y-1 p-1.5">
        <div className="h-1 w-3/4 rounded-full" style={{ background: LINE }} />
      </div>
    </div>
  );
}

// A handful of curated, tested options, not a free-form picker, so every
// choice stays readable. "Midnight" reuses the same dark navy the
// worker/coordinator sidebar already uses (--cc-sidebar-bg), for a look
// that's consistent with the rest of the app rather than a one-off color.
// "Indigo Night" is a second dark option: same near-black family as
// Midnight, but the active pill is solid indigo instead of Midnight's
// translucent white overlay (reference screenshot, 2026-08-20). Its hex
// (NAV_INDIGO_NIGHT_HEX, shared with HubLayout.tsx via lib/nav-colors.ts)
// is checked explicitly so it gets that distinct active-pill treatment
// instead of the generic dark-background contrast fallback every other
// dark preset uses.
const NAV_COLOR_PRESETS: { hex: string | null; labelKey: string }[] = [
  { hex: null, labelKey: "settings.branding.navColorDefault" },
  { hex: "#E8457A", labelKey: "settings.branding.navColorPink" },
  { hex: "#6E79C2", labelKey: "settings.branding.navColorPurple" },
  { hex: "#1A1A18", labelKey: "settings.branding.navColorDark" },
  { hex: NAV_INDIGO_NIGHT_HEX, labelKey: "settings.branding.navColorIndigoNight" },
];

function isDarkHex(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 140;
}

// Renders the nav exactly as it will actually look with this preset:
// background and correctly-contrasted text/active-pill, bundled together,
// so there's nothing to discover after clicking. Mirrors the real
// Command Deck nav's own contrast logic (see HubLayout.tsx's navText/
// navActiveBg derivation) so the preview never lies about the result.
function NavDesignPreview({ hex }: { hex: string | null }) {
  const bg = hex ?? "var(--cc-surface)";
  const dark = hex ? isDarkHex(hex) : false;
  const indigoNight = hex === NAV_INDIGO_NIGHT_HEX;
  const text = dark ? "rgba(255,255,255,0.85)" : "var(--cc-muted)";
  const activeBg = indigoNight ? "#6C63FF" : dark ? "rgba(255,255,255,0.18)" : "var(--cc-plum)";

  return (
    <div
      className="flex h-11 w-full items-center justify-center gap-1 rounded-full border px-2"
      style={{ background: bg, borderColor: "var(--cc-border)" }}
    >
      <span className="rounded-full px-2 py-1 text-[8px] font-bold whitespace-nowrap" style={{ background: activeBg, color: "#FFFFFF" }}>
        Dashboard
      </span>
      <span className="rounded-full px-2 py-1 text-[8px] font-bold whitespace-nowrap" style={{ color: text }}>
        Staff
      </span>
    </div>
  );
}

function NavColorPicker() {
  const { prefs, setNavColor, translate } = useAccessibility();
  const current = prefs?.nav_color ?? null;
  const [busy, setBusy] = useState(false);

  async function apply(hex: string | null) {
    if (hex === current || busy) return;
    setBusy(true);
    try {
      await setNavColor(hex);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--cc-border)" }}>
      <p className="mb-1 text-[12px] font-bold" style={{ color: "var(--cc-text)" }}>
        {translate("settings.branding.navColorLabel")}
      </p>
      <p className="mb-3 text-[11px]" style={{ color: "var(--cc-muted)" }}>
        Each option is a full nav design. Background and text are matched for you, so you never end up with unreadable labels.
      </p>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {NAV_COLOR_PRESETS.map((preset) => {
          const selected = current === preset.hex;
          return (
            <button
              key={preset.hex ?? "default"}
              type="button"
              onClick={() => apply(preset.hex)}
              disabled={busy}
              className="rounded-xl border p-2 text-left transition-all disabled:opacity-60"
              style={{
                borderColor: selected ? "var(--cc-plum)" : "var(--cc-border)",
                boxShadow: selected ? "0 0 0 2px var(--cc-plum-ring)" : "none",
                background: "var(--cc-soft)",
              }}
              aria-pressed={selected}
            >
              <NavDesignPreview hex={preset.hex} />
              <div className="mt-2 flex items-center justify-between gap-1.5">
                <span className="text-[11px] font-bold" style={{ color: selected ? "var(--cc-plum)" : "var(--cc-text)" }}>
                  {translate(preset.labelKey)}
                </span>
                {selected && <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--cc-plum)" }} />}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function NavLayoutCard() {
  const { prefs, setNavLayout, translate } = useAccessibility();
  const layout = prefs?.nav_layout ?? "topbar";
  const [busy, setBusy] = useState(false);

  async function choose(value: "topbar" | "sidebar" | "bottombar") {
    if (value === layout || busy) return;
    setBusy(true);
    try {
      await setNavLayout(value);
    } finally {
      setBusy(false);
    }
  }

  const options: { value: "topbar" | "sidebar" | "bottombar"; label: string }[] = [
    { value: "topbar", label: translate("settings.branding.layoutTopbar") },
    { value: "sidebar", label: translate("settings.branding.layoutSidebar") },
    { value: "bottombar", label: translate("settings.branding.layoutBottombar") },
  ];

  return (
    <div className="overflow-hidden rounded-2xl bg-white" style={{ border: "1px solid var(--cc-border)" }}>
      <div className="p-6">
        <p className="mb-4 text-[15px] font-bold" style={{ color: "var(--cc-text)" }}>{translate("settings.branding.layoutLabel")}</p>
        <p className="mb-3 text-[11px]" style={{ color: "var(--cc-muted)" }}>{translate("settings.branding.layoutHint")}</p>
        <div className="grid grid-cols-3 gap-3 max-w-lg">
          {options.map((opt) => {
            const selected = layout === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => choose(opt.value)}
                disabled={busy}
                className="rounded-xl border p-2 text-left transition-all disabled:opacity-60"
                style={{
                  borderColor: selected ? "var(--cc-plum)" : "var(--cc-border)",
                  boxShadow: selected ? "0 0 0 2px var(--cc-plum-ring)" : "none",
                  background: "var(--cc-soft)",
                }}
              >
                <LayoutPreview variant={opt.value} />
                <div className="mt-2 flex items-center justify-between gap-1.5">
                  <span className="text-[12px] font-bold" style={{ color: selected ? "var(--cc-plum)" : "var(--cc-text)" }}>
                    {opt.label}
                  </span>
                  {selected && (
                    <Check className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--cc-plum)" }} />
                  )}
                </div>
              </button>
            );
          })}
        </div>

        <NavColorPicker />
      </div>
    </div>
  );
}
