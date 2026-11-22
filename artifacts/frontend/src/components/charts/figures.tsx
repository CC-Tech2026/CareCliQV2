/**
 * Figures that replace the old score rings and donuts.
 *
 * - <ScoreMeter>: one score out of 100 (compliance, note quality). The
 *   number is the figure; a straight bar shows how full it is, coloured by
 *   its band (compliant / at risk / non-compliant), with the band's word and
 *   icon beside it so the colour is never the only cue. The unfilled track is
 *   a lighter step of the same colour, so the band reads across the whole bar.
 * - <SegmentedBar>: one whole split into a few parts (support workers and
 *   coordinators; compliant, at risk and non-compliant shifts). Each part is
 *   its own block, sized by its share, its share printed on it where it fits,
 *   with a legend of names and counts, and a tooltip on hover or focus.
 *
 * Why not rings: a ring makes people compare arc lengths around a curve,
 * which is harder to read than lengths along a line, and a two-colour ring
 * of a single score is really just a bar bent into a circle.
 *
 * Colours come from the --viz-* tokens in index.css (light and dark).
 */
import { useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";

export type ScoreBand = "good" | "warning" | "critical";

export const BAND_COLOR: Record<ScoreBand, string> = {
  good: "var(--viz-good)",
  warning: "var(--viz-warning)",
  critical: "var(--viz-critical)",
};
export const BAND_TEXT: Record<ScoreBand, string> = {
  good: "var(--viz-good-text)",
  warning: "var(--viz-warning-text)",
  critical: "var(--viz-critical-text)",
};
const BAND_ICON: Record<ScoreBand, typeof CheckCircle2> = {
  good: CheckCircle2,
  warning: AlertTriangle,
  critical: XCircle,
};
export const DEFAULT_BAND_LABELS: Record<ScoreBand, string> = {
  good: "Compliant",
  warning: "At risk",
  critical: "Non-compliant",
};

/** The same bands everywhere: 85 and over compliant, 60 to 84 at risk. */
export function scoreBand(score: number, good = 85, warning = 60): ScoreBand {
  return score >= good ? "good" : score >= warning ? "warning" : "critical";
}

/** A lighter step of a colour, for a meter's track. */
function track(color: string) {
  return `color-mix(in oklab, ${color} 18%, var(--cc-surface))`;
}

export function BandBadge({ band, label }: { band: ScoreBand; label?: string }) {
  const Icon = BAND_ICON[band];
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold" style={{ color: BAND_TEXT[band] }}>
      <Icon size={13} aria-hidden /> {label ?? DEFAULT_BAND_LABELS[band]}
    </span>
  );
}

const FIGURE_SIZE = { sm: "text-lg", md: "text-3xl", lg: "text-5xl" } as const;

/** A score out of 100 as a figure, its band, and a meter. */
export function ScoreMeter({
  value,
  label,
  size = "md",
  bandLabels,
  good = 85,
  warning = 60,
  caption,
  showTarget = true,
  ariaLabel,
  className = "",
}: {
  value: number | null | undefined;
  /** What the score is, above the figure ("Overall score"). */
  label?: ReactNode;
  size?: keyof typeof FIGURE_SIZE;
  bandLabels?: Partial<Record<ScoreBand, string>>;
  good?: number;
  warning?: number;
  /** A line under the meter ("12 of 14 rules passing"). */
  caption?: ReactNode;
  /** A small mark on the track where "compliant" starts. */
  showTarget?: boolean;
  /** The meter's name when there's no visible label (a card title names it). */
  ariaLabel?: string;
  className?: string;
}) {
  const known = typeof value === "number" && Number.isFinite(value);
  const score = known ? Math.max(0, Math.min(100, Math.round(value as number))) : 0;
  const band = scoreBand(score, good, warning);
  const color = known ? BAND_COLOR[band] : "var(--cc-muted)";
  const names = { ...DEFAULT_BAND_LABELS, ...bandLabels };
  const name = ariaLabel ?? (typeof label === "string" ? label : "Score");
  return (
    <div className={`min-w-0 ${className}`}>
      {label && <p className="text-xs font-medium" style={{ color: MUTED }}>{label}</p>}
      <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className={`${FIGURE_SIZE[size]} font-semibold leading-tight`} style={{ color: TEXT }}>
          {known ? score : "No score"}
        </span>
        {known && <span className="text-xs" style={{ color: MUTED }}>out of 100</span>}
        {known && <BandBadge band={band} label={names[band]} />}
      </div>
      <div
        role="meter"
        aria-label={name}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={known ? score : undefined}
        aria-valuetext={known ? `${score} out of 100, ${names[band]}` : "No score yet"}
        className={`relative mt-2 w-full overflow-hidden rounded-full ${size === "sm" ? "h-1.5" : "h-2"}`}
        style={{ background: known ? track(color) : "var(--cc-soft)" }}
      >
        {known && score > 0 && (
          <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${score}%`, background: color }} />
        )}
        {showTarget && known && (
          <span
            aria-hidden
            title={`${names.good} from ${good}`}
            className="absolute top-0 h-full w-0.5"
            style={{ left: `${good}%`, background: "var(--cc-surface)" }}
          />
        )}
      </div>
      {caption && <p className="mt-1.5 text-xs" style={{ color: MUTED }}>{caption}</p>}
    </div>
  );
}

export type SegmentPart = { key: string; label: string; value: number; color: string; /** Text on the block: white unless the fill is light. */ ink?: string };

/** One whole split into parts: a tall bar of blocks and a legend. */
export function SegmentedBar({
  parts,
  label,
  unit,
  empty = "Nothing to show yet",
  legend = true,
}: {
  parts: SegmentPart[];
  /** The bar's accessible name ("Active staff by role"). */
  label: string;
  /** For the tooltip and screen readers: "staff", "shifts". */
  unit?: string;
  empty?: string;
  legend?: boolean;
}) {
  const [active, setActive] = useState<string | null>(null);
  const total = parts.reduce((sum, p) => sum + Math.max(0, p.value), 0);
  const shown = parts.filter((p) => p.value > 0);
  const share = (v: number) => (total > 0 ? Math.round((v / total) * 100) : 0);
  const describe = (p: SegmentPart) => `${p.label}: ${p.value.toLocaleString("en-AU")}${unit ? ` ${unit}` : ""}, ${share(p.value)}%`;
  const activePart = shown.find((p) => p.key === active);

  return (
    <div className="min-w-0">
      {total === 0 ? (
        <div className="flex h-7 items-center rounded px-3 text-xs" style={{ background: "var(--cc-soft)", color: MUTED }}>{empty}</div>
      ) : (
        <div className="relative">
          <div role="img" aria-label={`${label}. ${shown.map(describe).join("; ")}`} className="flex h-7 w-full gap-0.5">
            {shown.map((p) => {
              const pct = (p.value / total) * 100;
              return (
                <div
                  key={p.key}
                  tabIndex={0}
                  aria-label={describe(p)}
                  onMouseEnter={() => setActive(p.key)}
                  onMouseLeave={() => setActive(null)}
                  onFocus={() => setActive(p.key)}
                  onBlur={() => setActive(null)}
                  className="flex min-w-[6px] items-center overflow-hidden rounded px-2 outline-none focus-visible:ring-2 focus-visible:ring-cc-plum focus-visible:ring-offset-1"
                  style={{ flexGrow: pct, flexBasis: 0, background: p.color }}
                >
                  {pct >= 14 && (
                    <span className="truncate text-xs font-semibold" style={{ color: p.ink ?? "#ffffff" }}>{share(p.value)}%</span>
                  )}
                </div>
              );
            })}
          </div>
          {activePart && (
            <div
              role="tooltip"
              className="pointer-events-none absolute -top-2 left-1/2 z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md border border-cc-border bg-cc-surface px-2.5 py-1.5 text-xs shadow-md"
              style={{ color: TEXT }}
            >
              <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: activePart.color }} />
              <span className="font-semibold">{activePart.label}</span>
              <span style={{ color: MUTED }}> · {activePart.value.toLocaleString("en-AU")}{unit ? ` ${unit}` : ""} · {share(activePart.value)}%</span>
            </div>
          )}
        </div>
      )}
      {legend && (
        <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
          {parts.map((p) => (
            <li key={p.key} className="flex items-center gap-1.5 text-xs">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: p.color }} />
              <span style={{ color: MUTED }}>{p.label}</span>
              <span className="font-semibold tabular-nums" style={{ color: TEXT }}>{p.value.toLocaleString("en-AU")}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The three compliance bands as parts of a SegmentedBar. */
export function bandParts(counts: { compliant: number; at_risk: number; non_compliant: number }, labels?: Partial<Record<ScoreBand, string>>): SegmentPart[] {
  const names = { ...DEFAULT_BAND_LABELS, ...labels };
  return [
    { key: "good", label: names.good, value: counts.compliant, color: BAND_COLOR.good },
    { key: "warning", label: names.warning, value: counts.at_risk, color: BAND_COLOR.warning, ink: "#0b0b0b" },
    { key: "critical", label: names.critical, value: counts.non_compliant, color: BAND_COLOR.critical },
  ];
}

/* -------------------------------------------------------------------------- */
/* Shared settings for line and bar charts (recharts)                         */
/* -------------------------------------------------------------------------- */

/** Series colours in their fixed order: a series keeps its colour whatever
 *  else is shown. */
export const SERIES = ["var(--viz-1)", "var(--viz-2)", "var(--viz-3)", "var(--viz-4)"] as const;

/** Hairline grid, horizontal only. */
export const GRID_PROPS = { stroke: "var(--viz-grid)", vertical: false } as const;
/** Quiet axis text, no axis or tick lines. */
export const AXIS_PROPS = { tick: { fontSize: 11, fill: "var(--cc-muted)" }, axisLine: false, tickLine: false } as const;
export const TOOLTIP_PROPS = {
  contentStyle: {
    borderRadius: 8,
    border: "1px solid var(--cc-border)",
    background: "var(--cc-surface)",
    color: "var(--cc-text)",
    fontSize: 12,
    boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
    padding: "8px 10px",
  },
  labelStyle: { color: "var(--cc-text)", fontWeight: 600, marginBottom: 2 },
  itemStyle: { color: "var(--cc-text)", padding: 0 },
  cursor: { stroke: "var(--cc-muted)", strokeWidth: 1, strokeDasharray: "3 3" },
} as const;
/** Bars: thin, rounded at the data end only. */
export const BAR_PROPS = { radius: [4, 4, 0, 0] as [number, number, number, number], maxBarSize: 24 };
/** Lines: 2px, no dots except the one hovered. */
export function lineProps(color: string) {
  return { stroke: color, strokeWidth: 2, dot: false, activeDot: { r: 4, fill: color, stroke: "var(--cc-surface)", strokeWidth: 2 } } as const;
}
/** A target or limit drawn across the chart, labelled. */
export function referenceProps(label: string) {
  return {
    stroke: "var(--cc-muted)",
    strokeDasharray: "4 4",
    label: { value: label, position: "insideTopRight" as const, fontSize: 11, fill: "var(--cc-muted)" },
  };
}

/** The legend above a chart: one entry per series, in series order. */
export function ChartLegend({ items }: { items: Array<{ label: string; color: string; dashed?: boolean }> }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {items.map((it) => (
        <li key={it.label} className="flex items-center gap-1.5 text-xs" style={{ color: MUTED }}>
          <span
            aria-hidden
            className="inline-block h-0 w-4"
            style={{ borderTop: `2px ${it.dashed ? "dashed" : "solid"} ${it.color}` }}
          />
          {it.label}
        </li>
      ))}
    </ul>
  );
}
