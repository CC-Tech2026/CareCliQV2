import { useEffect, useId, useState } from "react";
import { useLocation } from "wouter";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  AlertTriangle,
  ArrowRight,
  ShieldCheck,
  DollarSign,
  TrendingUp,
  TrendingDown,
  Info,
  Clock,
  Timer,
  Zap,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { readWaitlistSnapshot, type WaitlistSnapshot } from "@/lib/onboardingWaitlist";
import { GovernanceTriage } from "@/components/hub/GovernanceTriage";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
// Aliased — recharts also exports a "Tooltip" (used for the chart tooltips
// below), so both can't share the name in this file.
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";

const AMBER = "#9A5B0A";
const RED = "#B3261E";
const GREEN = "#0F7B57";
const BLUE = "#2A5C8A";
// Categorical pair for the Active staff ring (support workers vs coordinators) —
// validated against the dataviz palette checks: BLUE reads too gray as a
// categorical mark at this saturation, so the ring uses this sky blue instead.
const SKY = "#0EA5E9";

// Same placeholder caseload assumption used by the Screening capacity check
// in Participant Onboarding — no live staffing-capacity feed exists yet, so
// this estimates total capacity as active staff × a reasonable caseload.
const CASELOAD_PER_WORKER = 6;

// UI-only placeholder for the waiting-list cards until a real referral has
// been logged through the public form — see the read effect below.
const DUMMY_WAITLIST: WaitlistSnapshot = { count: 59, hours: 28 };

interface MDData {
  active_participants: number;
  active_staff: number;
  support_workers: number;
  coordinators: number;
  participants_by_sex: { male: number; female: number; unspecified: number };
  participants_by_plan_status: { active: number; pending: number; review: number; expired: number; inactive: number };
  staff_retention_rate: number;
  sessions_this_week: number;
  compliance_score: number;
  compliance_target: number;
  incidents_this_month: number;
  goal_achievement_rate: number;
  team_compliance_breakdown: { compliant: number; at_risk: number; non_compliant: number };

  workers_at_risk: Array<{
    id: string;
    full_name: string;
    compliance_score: number;
    sessions: number;
  }>;

  org_alerts: Array<{
    type: string;
    severity: string;
    message: string;
  }>;

  common_issues: Array<{
    issue: string;
    count: number;
  }>;

  generated_at: string;
}

interface TrendPoint {
  week: string;
  avg_score: number | null;
  session_count: number;
}

interface RevenueMonth {
  month: string;
  billed: number;
  paid: number;
  outstanding: number;
  count: number;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatNumber(value: number | null | undefined) {
  return (value ?? 0).toLocaleString("en-AU");
}

/* -------------------------------------------------------------------------- */
/* Executive metric strip                                                     */
/* -------------------------------------------------------------------------- */

// "Active participants used vs. total capacity" is a single ratio against a
// limit — a meter reads that correctly; a 2-slice pie doesn't (it makes the
// reader compare two arbitrary angles instead of just reading one bar).
// Track is a lighter tint of the same hue as the fill, not a neutral gray,
// so severity reads across the whole bar, not just the filled portion.
function CapacityMeter({ used, total }: { used: number; total: number }) {
  if (total <= 0) return null;
  const pct = Math.min(100, Math.round((used / total) * 100));
  const available = Math.max(0, total - used);
  const color = pct >= 90 ? RED : pct >= 70 ? AMBER : GREEN;
  return (
    <div className="mt-3">
      <div className="h-1.5 w-full rounded-full overflow-hidden" style={{ background: `${color}1F` }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
      <p className="mt-1.5 text-[10px] font-bold" style={{ color: MUTED }}>
        {available} spot{available === 1 ? "" : "s"} available for new participants
      </p>
    </div>
  );
}

/** Two named sub-counts under a total (e.g. Support workers / Coordinators under Active staff). */
function MetricBreakdown({ items }: { items: Array<{ label: string; value: number; color?: string }> }) {
  return (
    <div className="mt-3 flex items-center gap-4 border-t pt-3" style={{ borderColor: BORDER }}>
      {items.map((item) => (
        <div key={item.label}>
          <p className="text-[15px] font-black" style={{ color: item.color ?? TEXT }}>{formatNumber(item.value)}</p>
          <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{item.label}</p>
        </div>
      ))}
    </div>
  );
}

/** Ring composition chart — the team's total in the center, made up of two
 *  named categorical parts (support workers / coordinators). Unlike
 *  CapacityMeter, this total has no ceiling to read as a fill level against,
 *  so a ring split — not a linear meter — is the right form here. */
function StaffCompositionRing({ supportWorkers, coordinators, size = 136, stroke = 16 }: { supportWorkers: number; coordinators: number; size?: number; stroke?: number }) {
  const total = supportWorkers + coordinators;
  const center = size / 2;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const gap = total > 0 ? 3 : 0;
  const workerLen = total > 0 ? (supportWorkers / total) * circumference : 0;
  const coordLen = total > 0 ? (coordinators / total) * circumference : 0;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="shrink-0"
      role="img"
      aria-label={`${supportWorkers} support workers, ${coordinators} coordinators`}
    >
      <circle cx={center} cy={center} r={radius} fill="none" stroke={SOFT} strokeWidth={stroke} />
      {supportWorkers > 0 && (
        <circle
          cx={center} cy={center} r={radius} fill="none"
          stroke={PLUM} strokeWidth={stroke}
          strokeDasharray={`${Math.max(0, workerLen - gap)} ${circumference}`}
          transform={`rotate(-90 ${center} ${center})`}
        />
      )}
      {coordinators > 0 && (
        <circle
          cx={center} cy={center} r={radius} fill="none"
          stroke={SKY} strokeWidth={stroke}
          strokeDasharray={`${Math.max(0, coordLen - gap)} ${circumference}`}
          strokeDashoffset={-workerLen}
          transform={`rotate(-90 ${center} ${center})`}
        />
      )}
      <text x="50%" y="46%" textAnchor="middle" style={{ fill: TEXT, fontSize: 28, fontWeight: 900 }}>
        {formatNumber(total)}
      </text>
      <text x="50%" y="62%" textAnchor="middle" style={{ fill: MUTED, fontSize: 10, fontWeight: 700, letterSpacing: "0.04em" }}>
        TOTAL STAFF
      </text>
    </svg>
  );
}

/** A colored identity dot beside its own value + label — the ring's legend,
 *  since color alone (a WARN-contrast blue included) is never the only cue. */
function RingLegendItem({ color, value, label }: { color: string; value: number; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: color }} />
      <p className="text-[12px] font-bold" style={{ color: TEXT }}>
        {formatNumber(value)} <span className="font-semibold" style={{ color: MUTED }}>{label}</span>
      </p>
    </div>
  );
}

function ActiveStaffCard({
  total,
  retentionRate,
  supportWorkers,
  coordinators,
  onClick,
}: {
  total: number;
  retentionRate: number;
  supportWorkers: number;
  coordinators: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col justify-start rounded-2xl border overflow-hidden text-left transition-colors hover:bg-cc-soft"
      style={{ borderColor: BORDER, background: SURFACE }}
    >
      <div className="relative w-full flex-1 px-5 py-5">
        <div className="absolute right-5 top-1/2 -translate-y-1/2">
          <StaffCompositionRing supportWorkers={supportWorkers} coordinators={coordinators} />
        </div>

        <div className="pr-32">
          <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Active staff</p>

          <div className="mt-3 flex flex-col gap-1.5">
            <RingLegendItem color={PLUM} value={supportWorkers} label="Support workers" />
            <RingLegendItem color={SKY} value={coordinators} label="Coordinators" />
          </div>

          <p className="mt-3 text-[11px]" style={{ color: MUTED }}>{retentionRate}% retention · {formatNumber(total)} active in total</p>
        </div>
      </div>
    </button>
  );
}

/** Same "single ratio" meter language as CapacityMeter, but inverted severity —
 *  here a higher percentage is the good outcome, so the color bands flip. */
function AchievementMeter({ pct }: { pct: number }) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  const color = clamped >= 85 ? GREEN : clamped >= 70 ? AMBER : RED;
  return (
    <div className="mt-3 h-1.5 w-full rounded-full overflow-hidden" style={{ background: `${color}1F` }}>
      <div className="h-full rounded-full" style={{ width: `${clamped}%`, background: color }} />
    </div>
  );
}

function ExecutiveMetric({
  label,
  value,
  detail,
  onClick,
  meter,
  breakdown,
  achievementPct,
}: {
  label: string;
  value: string | number;
  detail: string;
  onClick?: () => void;
  meter?: { used: number; total: number };
  breakdown?: Array<{ label: string; value: number; color?: string }>;
  achievementPct?: number;
}) {
  const content = (
    <div className="w-full px-5 py-5">
      <p
        className="text-[10px] font-bold uppercase tracking-[0.14em]"
        style={{ color: MUTED }}
      >
        {label}
      </p>

      <p
        className="mt-2 text-[26px] font-black tracking-tight"
        style={{ color: TEXT }}
      >
        {value}
      </p>

      <p
        className="mt-1 text-[11px]"
        style={{ color: MUTED }}
      >
        {detail}
      </p>

      {meter && <CapacityMeter used={meter.used} total={meter.total} />}
      {achievementPct !== undefined && <AchievementMeter pct={achievementPct} />}
      {breakdown && <MetricBreakdown items={breakdown} />}
    </div>
  );

  // Each metric is its own rounded, bordered card — not one shared strip —
  // so the four numbers read as separate facts, not one continuous block.
  if (!onClick) {
    return (
      <div className="rounded-2xl border overflow-hidden" style={{ borderColor: BORDER, background: SURFACE }}>
        {content}
      </div>
    );
  }

  return (
    <button
      onClick={onClick}
      className="flex flex-col justify-start rounded-2xl border overflow-hidden text-left transition-colors hover:bg-cc-soft"
      style={{ borderColor: BORDER, background: SURFACE }}
    >
      {content}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Participant overview                                                      */
/* -------------------------------------------------------------------------- */

/** One named sub-count in the participant overview card (Male/Female, Pending/Review/Expired). */
function ParticipantStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div>
      <p className="text-[17px] font-black" style={{ color: color ?? TEXT }}>{formatNumber(value)}</p>
      <p className="text-[9px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
    </div>
  );
}

/** A single real count, not a comparison or a ratio against a limit — a plain
 *  stat tile is the right form here, not a chart (see dataviz "is it even a
 *  chart?"). Sits above the participant overview it's a stage of. */
function WaitlistCard({ count, onNavigate }: { count: number; onNavigate: () => void }) {
  return (
    <button
      onClick={onNavigate}
      className="grid h-full w-full grid-rows-[auto_1fr] rounded-2xl border px-6 py-5 text-left transition-colors hover:bg-cc-soft"
      style={{ borderColor: BORDER, background: SURFACE }}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: count > 0 ? AMBER + "1F" : SOFT }}>
          <Clock size={16} style={{ color: count > 0 ? AMBER : MUTED }} />
        </span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Participants Waiting List</p>
          <p className="text-[11px]" style={{ color: MUTED }}>New enquiries not yet screened</p>
        </div>
      </div>
      <div className="flex items-center justify-center">
        <p className="text-[40px] font-black leading-none tracking-tight" style={{ color: count > 0 ? AMBER : TEXT }}>{formatNumber(count)}</p>
      </div>
    </button>
  );
}

/** Sits beside WaitlistCard — total weekly hours the same enquiry-stage
 *  people have requested, from the referral form's hours field. Additive
 *  (sum of what's known), not an estimate — enquiries logged without hours
 *  captured (e.g. via the staff-side manual form) simply contribute 0. */
function WaitlistHoursCard({ hours }: { hours: number }) {
  return (
    <div
      className="grid h-full w-full grid-rows-[auto_1fr] rounded-2xl border px-6 py-5"
      style={{ borderColor: BORDER, background: SURFACE }}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: hours > 0 ? BLUE + "1F" : SOFT }}>
          <Timer size={16} style={{ color: hours > 0 ? BLUE : MUTED }} />
        </span>
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Hours in demand</p>
          <p className="text-[11px]" style={{ color: MUTED }}>Requested, waiting list</p>
        </div>
      </div>
      <div className="flex items-center justify-center">
        <p className="text-[40px] font-black leading-none tracking-tight" style={{ color: TEXT }}>
          {formatNumber(hours)}<span className="ml-1.5 text-[20px] font-bold" style={{ color: MUTED }}>h</span>
        </p>
      </div>
    </div>
  );
}

/** Sits beside Hours in demand, so the two can be read against each other at
 *  a glance. Dummy numbers for now — no rostering/availability feed backs
 *  this yet; the real version needs actual worker availability + shift-offer
 *  acceptance data, which is a backend job for later. Reliable and casual
 *  capacity get their own rows (not summed into one figure) since they carry
 *  different confidence — a single blended number would overstate what's
 *  actually guaranteed. */
function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const angleRad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(angleRad), y: cy + r * Math.sin(angleRad) };
}

/** SVG arc path for a ring segment from 0deg to `sweepDeg`, clockwise from
 *  the top — used instead of a plain <circle> so a dash texture (the
 *  "segmented gauge" look) only applies within the filled portion, not the
 *  whole 360°. */
function describeArc(cx: number, cy: number, r: number, sweepDeg: number): string {
  const clamped = Math.min(359.9, Math.max(0, sweepDeg));
  const start = polarToCartesian(cx, cy, r, clamped);
  const end = polarToCartesian(cx, cy, r, 0);
  const largeArcFlag = clamped > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y}`;
}

/** Two concentric smooth rings against a shared scale, each its own color —
 *  same job as the "Speed Statistic" reference (two arcs + a center
 *  readout), adapted to two reliability tiers instead of two speeds. Solid
 *  strokes, not dashed — a dash pattern stretched around a short arc at
 *  this size reads as lumpy/organic rather than a clean gauge.
 *
 *  Interactive: clicking a ring extends a short leader line outward from its
 *  edge, ending in a small label showing that ring's exact figure — the
 *  center total stays put either way. Each ring's callout toggles
 *  independently, so both can be open at once. */
function DualRingGauge({
  outerValue,
  innerValue,
  max,
  outerColor,
  innerColor,
  outerCallout,
  innerCallout,
  centerValue,
  centerLabel,
  size = 156,
  stroke = 12,
  gap = 9,
}: {
  outerValue: number;
  innerValue: number;
  max: number;
  outerColor: string;
  innerColor: string;
  /** Text shown in the popped-out label when that ring is clicked, e.g. "40 hrs/wk". */
  outerCallout: string;
  innerCallout: string;
  centerValue: string;
  centerLabel: string;
  size?: number;
  stroke?: number;
  gap?: number;
}) {
  const arrowId = useId();
  const [outerOpen, setOuterOpen] = useState(false);
  const [innerOpen, setInnerOpen] = useState(false);

  const center = size / 2;
  const outerRadius = (size - stroke) / 2;
  const innerRadius = outerRadius - stroke - gap;
  const outerSweep = 360 * Math.max(0, Math.min(1, outerValue / max));
  const innerSweep = 360 * Math.max(0, Math.min(1, innerValue / max));

  // Leader lines point outward from the midpoint of each ring's filled arc,
  // both reaching the same outer radius so the inner one's line visibly
  // crosses past the outer ring rather than getting lost near the center.
  const calloutRadius = outerRadius + 16;
  const outerMidAngle = outerSweep / 2;
  const innerMidAngle = innerSweep / 2;
  const outerAnchor = polarToCartesian(center, center, outerRadius, outerMidAngle);
  const outerTip = polarToCartesian(center, center, calloutRadius, outerMidAngle);
  const innerAnchor = polarToCartesian(center, center, innerRadius, innerMidAngle);
  const innerTip = polarToCartesian(center, center, calloutRadius, innerMidAngle);

  const padding = 32; // room for the callout labels to sit outside the ring itself
  const canvas = size + padding * 2;
  const shift = padding;

  function CalloutLabel({ point, color, text, onRingLeft }: { point: { x: number; y: number }; color: string; text: string; onRingLeft: boolean }) {
    return (
      <div
        className="pointer-events-none absolute z-10 flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-black shadow-sm"
        style={{
          left: point.x + shift,
          top: point.y + shift,
          transform: `translate(${onRingLeft ? "-100%" : "0%"}, -50%) translateX(${onRingLeft ? "-6px" : "6px"})`,
          borderColor: color,
          background: SURFACE,
          color,
        }}
      >
        {text}
      </div>
    );
  }

  return (
    <div className="relative" style={{ width: canvas, height: canvas }}>
      <svg
        width={canvas}
        height={canvas}
        viewBox={`0 0 ${canvas} ${canvas}`}
        className="absolute inset-0"
      >
        <defs>
          <marker id={`${arrowId}-outer`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={outerColor} />
          </marker>
          <marker id={`${arrowId}-inner`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" fill={innerColor} />
          </marker>
        </defs>
        <g transform={`translate(${shift} ${shift})`}>
          <circle cx={center} cy={center} r={outerRadius} fill="none" stroke={SOFT} strokeWidth={stroke} />
          <circle cx={center} cy={center} r={innerRadius} fill="none" stroke={SOFT} strokeWidth={stroke} />
          <path
            d={describeArc(center, center, outerRadius, outerSweep)}
            fill="none"
            stroke={outerColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            style={{ cursor: outerValue > 0 ? "pointer" : "default" }}
            onClick={() => outerValue > 0 && setOuterOpen((v) => !v)}
          />
          <path
            d={describeArc(center, center, innerRadius, innerSweep)}
            fill="none"
            stroke={innerColor}
            strokeWidth={stroke}
            strokeLinecap="round"
            style={{ cursor: innerValue > 0 ? "pointer" : "default" }}
            onClick={() => innerValue > 0 && setInnerOpen((v) => !v)}
          />
          <text x={center} y={center - 6} textAnchor="middle" style={{ fill: TEXT, fontSize: 26, fontWeight: 900 }}>{centerValue}</text>
          <text x={center} y={center + 14} textAnchor="middle" style={{ fill: MUTED, fontSize: 9, fontWeight: 700 }}>{centerLabel}</text>

          {outerOpen && (
            <>
              <circle cx={outerAnchor.x} cy={outerAnchor.y} r={3} fill={outerColor} />
              <line x1={outerAnchor.x} y1={outerAnchor.y} x2={outerTip.x} y2={outerTip.y} stroke={outerColor} strokeWidth={1.5} markerEnd={`url(#${arrowId}-outer)`} />
            </>
          )}
          {innerOpen && (
            <>
              <circle cx={innerAnchor.x} cy={innerAnchor.y} r={3} fill={innerColor} />
              <line x1={innerAnchor.x} y1={innerAnchor.y} x2={innerTip.x} y2={innerTip.y} stroke={innerColor} strokeWidth={1.5} markerEnd={`url(#${arrowId}-inner)`} />
            </>
          )}
        </g>
      </svg>

      {outerOpen && <CalloutLabel point={outerTip} color={outerColor} text={outerCallout} onRingLeft={outerTip.x < center} />}
      {innerOpen && <CalloutLabel point={innerTip} color={innerColor} text={innerCallout} onRingLeft={innerTip.x < center} />}
    </div>
  );
}

/** Dummy numbers for now — no rostering/availability feed backs this yet;
 *  the real version needs actual worker availability + shift-offer
 *  acceptance data, which is a backend job for later. Reliable and casual
 *  capacity get their own ring (not summed into the visual encoding) since
 *  they carry different confidence — the center total is a convenience
 *  readout, and the info popover spells out the two components it hides. */
function AvailableHoursCard() {
  const reliable = 40;
  const casual = 26;
  const max = Math.ceil((Math.max(reliable, casual) * 1.25) / 10) * 10;
  return (
    <div className="flex h-full w-full flex-col rounded-2xl border px-6 py-5" style={{ borderColor: BORDER, background: SURFACE }}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--cc-plum-soft)" }}>
            <Zap size={16} style={{ color: PLUM }} />
          </span>
          <div>
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Available hours</p>
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" aria-label="What does available hours mean?" className="flex h-3.5 w-3.5 items-center justify-center rounded-full hover:opacity-70" style={{ color: MUTED }}>
                    <Info size={12} />
                  </button>
                </PopoverTrigger>
                <PopoverContent side="top" align="start" className="w-[280px] space-y-2.5 p-3.5 text-[11px] leading-relaxed">
                  <p><strong style={{ color: PLUM }}>Reliable extra capacity</strong> — {reliable} hrs/week from part-time staff who've opted in to extra shifts. Safe to plan against.</p>
                  <p><strong style={{ color: SKY }}>Casual staff typical volume</strong> — ~{casual} hrs/week, based on casual staff's usual availability. Not guaranteed — don't commit new participants against this alone.</p>
                  <p style={{ color: MUTED }}>Placeholder numbers for now — a real feed needs actual worker availability and shift-offer acceptance data.</p>
                </PopoverContent>
              </Popover>
            </div>
            <p className="text-[11px]" style={{ color: MUTED }}>Extra weekly capacity, by reliability</p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-4">
        <span className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: MUTED }}>
          <span className="h-2 w-2 rounded-full" style={{ background: PLUM }} /> Reliable
        </span>
        <span className="flex items-center gap-1.5 text-[10px] font-bold" style={{ color: MUTED }}>
          <span className="h-2 w-2 rounded-full" style={{ background: SKY }} /> Casual
        </span>
      </div>

      <div className="mt-2 flex flex-1 items-center justify-center">
        <DualRingGauge
          outerValue={reliable}
          innerValue={casual}
          max={max}
          outerColor={PLUM}
          innerColor={SKY}
          outerCallout={`${reliable} hrs/wk`}
          innerCallout={`~${casual} hrs/wk`}
          centerValue={`${reliable + casual}`}
          centerLabel="hrs/wk available"
        />
      </div>
    </div>
  );
}

function ParticipantOverviewCard({
  total,
  bySex,
  byPlanStatus,
  capacity,
  onNavigate,
}: {
  total: number;
  bySex: MDData["participants_by_sex"] | null | undefined;
  byPlanStatus: MDData["participants_by_plan_status"] | null | undefined;
  capacity: { used: number; total: number };
  onNavigate: () => void;
}) {
  const sex = bySex ?? { male: 0, female: 0, unspecified: 0 };
  const planStatus = byPlanStatus ?? { pending: 0, review: 0, expired: 0 };

  return (
    <div className="rounded-2xl border overflow-hidden" style={{ borderColor: BORDER, background: SURFACE }}>
      <div className="flex items-center justify-between px-6 py-5 border-b" style={{ borderColor: BORDER }}>
        <div>
          <h3 className="text-[13px] font-black" style={{ color: TEXT }}>Participant overview</h3>
          <p className="mt-0.5 text-[11px]" style={{ color: MUTED }}>Caseload composition and plan status</p>
        </div>
        <button onClick={onNavigate} className="flex items-center gap-1 text-[11px] font-bold" style={{ color: PLUM }}>
          View participants <ArrowRight size={12} />
        </button>
      </div>

      <div className="grid gap-6 px-6 py-6 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
        <div>
          <p className="text-[40px] font-black leading-none tracking-tight" style={{ color: PLUM }}>{formatNumber(total)}</p>
          <p className="mt-1 text-[11px]" style={{ color: MUTED }}>Total participants</p>
          <CapacityMeter used={capacity.used} total={capacity.total} />
          <div className="mt-4 flex items-center gap-6">
            <ParticipantStat label="Male" value={sex.male} />
            <ParticipantStat label="Female" value={sex.female} />
            {sex.unspecified > 0 && <ParticipantStat label="Others" value={sex.unspecified} />}
          </div>
        </div>

        <span className="hidden h-24 w-px sm:block" style={{ background: BORDER }} />

        <div>
          <div className="mb-3 flex items-center gap-1.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.14em]" style={{ color: MUTED }}>Plan status</p>
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" aria-label="What does plan status mean?" className="flex h-3.5 w-3.5 items-center justify-center rounded-full hover:opacity-70" style={{ color: MUTED }}>
                  <Info size={12} />
                </button>
              </PopoverTrigger>
              <PopoverContent side="top" align="start" className="w-[280px] space-y-2.5 p-3.5 text-[11px] leading-relaxed">
                <p><strong>Pending</strong> — waiting on NDIA or the plan manager to confirm the plan. Services shouldn't be billed against it until it's confirmed.</p>
                <p><strong>Review</strong> — the participant's plan is being reassessed. Budget and goals may change once it's finalized.</p>
                <p><strong>Expired</strong> — the plan's end date has passed with no new plan on file. Services delivered now may not be billable — follow up before continuing support.</p>
              </PopoverContent>
            </Popover>
          </div>
          <div className="flex items-center gap-6">
            <ParticipantStat label="Pending" value={planStatus.pending} color={planStatus.pending > 0 ? AMBER : undefined} />
            <ParticipantStat label="Review" value={planStatus.review} color={planStatus.review > 0 ? AMBER : undefined} />
            <ParticipantStat label="Expired" value={planStatus.expired} color={planStatus.expired > 0 ? RED : undefined} />
          </div>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Compliance                                                                 */
/* -------------------------------------------------------------------------- */

function ComplianceCard({
  score,
  target,
  onNavigate,
}: {
  score: number;
  target: number;
  onNavigate: (path: string) => void;
}) {
  const { translate, translateParams } = useAccessibility();

  const percentage = Math.min(Math.max(score, 0), 100);
  const belowTarget = score < target;
  const difference = Math.abs(score - target);

  return (
    <section
      className="overflow-hidden rounded-2xl border"
      style={{
        borderColor: BORDER,
        background: SURFACE,
      }}
    >
      <div
        className="flex items-center justify-between gap-4 border-b px-5 py-4 sm:px-6"
        style={{ borderColor: BORDER }}
      >
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck
              size={16}
              strokeWidth={2}
              style={{ color: PLUM }}
            />

            <h2
              className="text-[14px] font-black"
              style={{ color: TEXT }}
            >
              Compliance health
            </h2>
          </div>

          <p
            className="mt-1 text-[11px]"
            style={{ color: MUTED }}
          >
            Organisation-wide compliance performance
          </p>
        </div>

        <button
          onClick={() => onNavigate("/md/compliance")}
          className="flex items-center gap-1 text-[11px] font-bold"
          style={{ color: PLUM }}
        >
          View quality
          <ArrowRight size={12} strokeWidth={2} />
        </button>
      </div>

      <div className="grid gap-7 p-5 sm:p-6 lg:grid-cols-[240px_1fr] lg:items-center">
        <div>
          <div className="flex items-end gap-2">
            <span
              className="text-[44px] font-black leading-none tracking-[-0.04em]"
              style={{
                color: belowTarget ? RED : TEXT,
              }}
            >
              {score}%
            </span>

            <span
              className="mb-1.5 text-[11px] font-semibold"
              style={{ color: MUTED }}
            >
              current
            </span>
          </div>

          <div
            className="mt-3 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-bold"
            style={{
              background: belowTarget ? "#FBEAE9" : "#E9F5F0",
              color: belowTarget ? RED : GREEN,
            }}
          >
            {belowTarget ? (
              <TrendingDown size={11} />
            ) : (
              <TrendingUp size={11} />
            )}

            {belowTarget
              ? `${difference}% below target`
              : "On target"}
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <span
              className="text-[10px] font-bold"
              style={{ color: MUTED }}
            >
              Current performance
            </span>

            <span
              className="text-[10px] font-bold"
              style={{ color: TEXT }}
            >
              {target}% target
            </span>
          </div>

          <div
            className="h-2 overflow-hidden rounded-full"
            style={{ background: SOFT }}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${percentage}%`,
                background: belowTarget ? RED : PLUM,
              }}
            />
          </div>

          <div className="mt-3 flex items-center justify-between">
            <span
              className="text-[10px]"
              style={{ color: MUTED }}
            >
              Organisation compliance score
            </span>

            <span
              className="text-[10px] font-semibold"
              style={{
                color: belowTarget ? RED : GREEN,
              }}
            >
              {belowTarget
                ? translateParams("hub.mdHub.belowTarget", {
                    target: String(target),
                  })
                : translate("hub.mdHub.onTarget")}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Compliance trend                                                           */
/* -------------------------------------------------------------------------- */

function ComplianceTrend({
  trend,
  target,
}: {
  trend: TrendPoint[];
  target: number;
}) {
  const { translate, translateParams } = useAccessibility();

  const chartData = trend
    .filter((item) => item.avg_score !== null)
    .slice(-13)
    .map((item) => ({
      week: item.week.replace(/^\d{4}-/, ""),
      score: item.avg_score,
      sessions: item.session_count,
    }));

  if (chartData.length < 2) {
    return null;
  }

  return (
    <section
      className="rounded-2xl border"
      style={{
        borderColor: BORDER,
        background: SURFACE,
      }}
    >
      <div
        className="flex items-center justify-between gap-3 border-b px-5 py-4 sm:px-6"
        style={{ borderColor: BORDER }}
      >
        <div>
          <h2
            className="text-[14px] font-black"
            style={{ color: TEXT }}
          >
            Compliance trend
          </h2>

          <p
            className="mt-1 text-[11px]"
            style={{ color: MUTED }}
          >
            Average session compliance over recent weeks
          </p>
        </div>

        <div
          className="hidden items-center gap-1.5 text-[10px] font-bold sm:flex"
          style={{ color: MUTED }}
        >
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: PLUM }}
          />

          Compliance
        </div>
      </div>

      <div className="px-2 pb-4 pt-4 sm:px-5">
        <ResponsiveContainer width="100%" height={220}>
          <LineChart
            data={chartData}
            margin={{
              top: 8,
              right: 12,
              bottom: 0,
              left: -18,
            }}
          >
            <CartesianGrid
              strokeDasharray="3 3"
              stroke={BORDER}
              vertical={false}
            />

            <XAxis
              dataKey="week"
              tick={{
                fontSize: 9,
                fill: MUTED,
              }}
              axisLine={false}
              tickLine={false}
            />

            <YAxis
              domain={[50, 100]}
              tick={{
                fontSize: 9,
                fill: MUTED,
              }}
              axisLine={false}
              tickLine={false}
            />

            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: `1px solid ${BORDER}`,
                background: SURFACE,
                fontSize: 11,
                boxShadow: "0 6px 20px rgba(0,0,0,0.06)",
              }}
              formatter={(value: number) => [
                `${value}%`,
                translate("hub.mdHub.avgScore"),
              ]}
            />

            <ReferenceLine
              y={target}
              stroke={AMBER}
              strokeDasharray="4 4"
              strokeWidth={1.5}
              label={{
                value: translateParams("hub.mdHub.target", {
                  target: String(target),
                }),
                fontSize: 9,
                fill: AMBER,
                position: "insideTopRight",
              }}
            />

            <Line
              type="monotone"
              dataKey="score"
              stroke={PLUM}
              strokeWidth={2.5}
              dot={false}
              activeDot={{
                r: 4,
                fill: PLUM,
              }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Revenue trend                                                              */
/* -------------------------------------------------------------------------- */

type RevenuePeriod = "monthly" | "quarterly" | "yearly";

const REVENUE_PERIOD_META: Record<RevenuePeriod, { label: string; window: string }> = {
  monthly: { label: "Monthly", window: "last 12 months" },
  quarterly: { label: "Quarterly", window: "last 8 quarters" },
  yearly: { label: "Yearly", window: "last 5 years" },
};

/** Re-buckets the same monthly report into quarters/years — no new endpoint,
 *  just a different grouping of data already on the page. */
function bucketRevenue(monthly: RevenueMonth[], period: RevenuePeriod): Array<{ key: string; billed: number; paid: number }> {
  if (period === "monthly") {
    return monthly.slice(-12).map((m) => ({
      key: m.month.slice(5), // "2026-08" -> "08"; recent months only, so this stays unambiguous
      billed: Math.round(m.billed / 100),
      paid: Math.round(m.paid / 100),
    }));
  }

  const buckets = new Map<string, { label: string; billed: number; paid: number }>();
  for (const m of monthly) {
    const [yearStr, monthStr] = m.month.split("-");
    const monthNum = Number(monthStr);
    let sortKey: string;
    let label: string;
    if (period === "quarterly") {
      const quarter = Math.floor((monthNum - 1) / 3) + 1;
      sortKey = `${yearStr}-Q${quarter}`;
      label = `Q${quarter} ${yearStr}`;
    } else {
      sortKey = yearStr;
      label = yearStr;
    }
    const existing = buckets.get(sortKey) ?? { label, billed: 0, paid: 0 };
    existing.billed += m.billed;
    existing.paid += m.paid;
    buckets.set(sortKey, existing);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(period === "quarterly" ? -8 : -5)
    .map(([, v]) => ({ key: v.label, billed: Math.round(v.billed / 100), paid: Math.round(v.paid / 100) }));
}

interface RevenueReport {
  monthly?: RevenueMonth[];
  total_billed_cents?: number;
  total_paid_cents?: number;
  total_outstanding_cents?: number;
  invoice_count?: number;
}

/** One figure in the billing summary strip — always the live, current-to-the-day
 *  total from the report, independent of the chart's Monthly/Quarterly/Yearly view. */
function BillingStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-[17px] font-black" style={{ color: color ?? TEXT }}>{value}</p>
      <p className="mt-0.5 text-[9px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
    </div>
  );
}

function RevenueChart() {
  const [report, setReport] = useState<RevenueReport | null>(null);
  const [period, setPeriod] = useState<RevenuePeriod>("monthly");

  useEffect(() => {
    apiFetch("/api/billing/revenue-report")
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setReport(data ?? {}))
      .catch(() => setReport({}));
  }, []);

  const chartData = bucketRevenue(report?.monthly ?? [], period);
  const totalBilled = (report?.total_billed_cents ?? 0) / 100;
  const totalPaid = (report?.total_paid_cents ?? 0) / 100;
  const totalOutstanding = (report?.total_outstanding_cents ?? 0) / 100;
  const invoiceCount = report?.invoice_count ?? 0;

  return (
    <section className="flex h-full flex-col rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4 sm:px-6" style={{ borderColor: BORDER }}>
        <div>
          <h2 className="text-[14px] font-black" style={{ color: TEXT }}>Revenue</h2>
          <p className="mt-1 text-[11px]" style={{ color: MUTED }}>Billed vs. paid, {REVENUE_PERIOD_META[period].window}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 text-[10px] font-bold sm:flex" style={{ color: MUTED }}>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: BLUE }} /> Billed</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: GREEN }} /> Paid</span>
          </div>
          <Select value={period} onValueChange={(v) => setPeriod(v as RevenuePeriod)}>
            <SelectTrigger className="h-8 w-[120px] rounded-full border text-[11px] font-bold" style={{ borderColor: BORDER, color: TEXT }}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="monthly">Monthly</SelectItem>
              <SelectItem value="quarterly">Quarterly</SelectItem>
              <SelectItem value="yearly">Yearly</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Current-to-the-day totals — always the live report totals, not
          re-bucketed by the period selector above (that only reshapes the
          chart below). */}
      <div className="grid grid-cols-2 gap-4 border-b px-5 py-4 sm:grid-cols-4 sm:px-6" style={{ borderColor: BORDER }}>
        <BillingStat label="Billed" value={`$${formatNumber(totalBilled)}`} />
        <BillingStat label="Paid" value={`$${formatNumber(totalPaid)}`} color={GREEN} />
        <BillingStat label="Outstanding" value={`$${formatNumber(totalOutstanding)}`} color={totalOutstanding > 0 ? AMBER : undefined} />
        <BillingStat label="Invoices" value={formatNumber(invoiceCount)} />
      </div>

      <div className="flex-1 px-2 pb-4 pt-4 sm:px-5">
        {report === null ? (
          <div className="flex h-[220px] items-center justify-center text-[11px]" style={{ color: MUTED }}>Loading…</div>
        ) : chartData.length < 2 ? (
          <div className="flex h-[220px] items-center justify-center text-[11px]" style={{ color: MUTED }}>Not enough billing history yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={BORDER} vertical={false} />
              <XAxis dataKey="key" tick={{ fontSize: 9, fill: MUTED }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 9, fill: MUTED }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${formatNumber(v)}`} />
              <Tooltip
                contentStyle={{ borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE, fontSize: 11, boxShadow: "0 6px 20px rgba(0,0,0,0.06)" }}
                formatter={(value: number, name: string) => [`$${formatNumber(value)}`, name === "billed" ? "Billed" : "Paid"]}
              />
              <Line type="monotone" dataKey="billed" stroke={BLUE} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: BLUE }} />
              <Line type="monotone" dataKey="paid" stroke={GREEN} strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: GREEN }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------------- */
/* Financial summary                                                         */
/* -------------------------------------------------------------------------- */

function FinancialSummary({
  onNavigate,
}: {
  onNavigate: () => void;
}) {
  const [rev, setRev] = useState<{
    total_billed_cents?: number;
    total_paid_cents?: number;
    invoice_count?: number;
    monthly?: RevenueMonth[];
  } | null>(null);

  useEffect(() => {
    apiFetch("/api/billing/revenue-report")
      .then((response) =>
        response.ok ? response.json() : null
      )
      .then((data) => setRev(data))
      .catch(() => {});
  }, []);

  const totalRevenue =
    (rev?.total_billed_cents ?? 0) / 100;

  const totalPaid =
    (rev?.total_paid_cents ?? 0) / 100;

  const invoices = rev?.invoice_count ?? 0;

  const collectionRate =
    totalRevenue > 0
      ? Math.round((totalPaid / totalRevenue) * 100)
      : 0;

  // Baseline comparison: the two most recent months from the same report,
  // so "collection rate" reads against a prior period instead of standing
  // alone as a bare percentage.
  const monthly = rev?.monthly ?? [];
  const thisMonth = monthly[0];
  const lastMonth = monthly[1];
  const lastMonthRate =
    lastMonth && lastMonth.billed > 0
      ? Math.round((lastMonth.paid / lastMonth.billed) * 100)
      : null;
  const thisMonthRate =
    thisMonth && thisMonth.billed > 0
      ? Math.round((thisMonth.paid / thisMonth.billed) * 100)
      : null;
  const collectionDelta =
    thisMonthRate !== null && lastMonthRate !== null
      ? thisMonthRate - lastMonthRate
      : null;

  return (
    <section
      className="rounded-2xl border"
      style={{
        borderColor: BORDER,
        background: SURFACE,
      }}
    >
      <div
        className="flex items-center justify-between border-b px-5 py-4"
        style={{ borderColor: BORDER }}
      >
        <div>
          <div className="flex items-center gap-2">
            <DollarSign
              size={15}
              strokeWidth={2}
              style={{ color: BLUE }}
            />

            <h2
              className="text-[14px] font-black"
              style={{ color: TEXT }}
            >
              Financial snapshot
            </h2>
          </div>

          <p
            className="mt-1 text-[11px]"
            style={{ color: MUTED }}
          >
            Current billing activity
          </p>
        </div>

        <button
          onClick={onNavigate}
          className="flex items-center gap-1 text-[11px] font-bold"
          style={{ color: PLUM }}
        >
          Full report
          <ArrowRight size={12} />
        </button>
      </div>

      <div className="grid grid-cols-1 divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <FinancialMetric
          label="Billed"
          value={`$${totalRevenue.toLocaleString("en-AU", {
            maximumFractionDigits: 0,
          })}`}
        />

        <FinancialMetric
          label="Paid"
          value={`$${totalPaid.toLocaleString("en-AU", {
            maximumFractionDigits: 0,
          })}`}
        />

        <FinancialMetric
          label="Collection"
          value={`${collectionRate}%`}
          detail={
            collectionDelta === null
              ? `${formatNumber(invoices)} invoices`
              : `${collectionDelta >= 0 ? "+" : ""}${collectionDelta} pts vs last month`
          }
          warning={collectionRate < 90}
          trend={collectionDelta}
        />
      </div>
    </section>
  );
}

function FinancialMetric({
  label,
  value,
  detail,
  warning,
  trend,
}: {
  label: string;
  value: string;
  detail?: string;
  warning?: boolean;
  trend?: number | null;
}) {
  return (
    <div className="px-5 py-4">
      <p
        className="text-[9px] font-black uppercase tracking-[0.15em]"
        style={{ color: MUTED }}
      >
        {label}
      </p>

      <p
        className="mt-1 text-[21px] font-black"
        style={{
          color: warning ? RED : TEXT,
        }}
      >
        {value}
      </p>

      {detail && (
        <p
          className="mt-0.5 flex items-center gap-1 text-[10px]"
          style={{ color: trend !== undefined && trend !== null ? (trend >= 0 ? GREEN : RED) : MUTED }}
        >
          {trend !== undefined && trend !== null ? (
            trend >= 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />
          ) : null}
          {detail}
        </p>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main component                                                             */
/* -------------------------------------------------------------------------- */

export function MDHubView() {
  const { translate } = useAccessibility();
  const [, navigate] = useLocation();

  const [data, setData] = useState<MDData | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [waitlist, setWaitlist] = useState<WaitlistSnapshot>({ count: 0, hours: 0 });

  // TEMP: always shows the UI-only placeholder numbers right now, ignoring
  // any real snapshot in localStorage (e.g. leftover from testing the
  // onboarding board/referral form) — purely for the UI per request. Swap
  // back to `setWaitlist(snapshot.count > 0 ? snapshot : DUMMY_WAITLIST)`
  // once ready to show real enquiry data again.
  useEffect(() => {
    setWaitlist(DUMMY_WAITLIST);
  }, []);

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    setError(false);

    Promise.all([
      apiFetch("/api/dashboard/managing-director").then(
        (response) =>
          response.ok
            ? response.json()
            : Promise.reject()
      ),

      apiFetch("/api/dashboard/compliance-trend").then(
        (response) =>
          response.ok
            ? response.json()
            : { trend: [] }
      ),
    ])
      .then(([mdData, trendData]) => {
        if (cancelled) return;

        setData(mdData);
        setTrend(trendData.trend ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /* ------------------------------------------------------------------------ */
  /* Loading                                                                  */
  /* ------------------------------------------------------------------------ */

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid gap-5 xl:grid-cols-2">
          <div
            className="h-64 animate-pulse rounded-2xl"
            style={{ background: SOFT }}
          />
          <div
            className="h-64 animate-pulse rounded-2xl"
            style={{ background: SOFT }}
          />
        </div>

        <div
          className="grid overflow-hidden rounded-2xl border sm:grid-cols-2 xl:grid-cols-4"
          style={{ borderColor: BORDER }}
        >
          {[1, 2, 3, 4].map((item) => (
            <div
              key={item}
              className="h-32 animate-pulse"
              style={{ background: SOFT }}
            />
          ))}
        </div>

        <div
          className="h-52 animate-pulse rounded-2xl"
          style={{ background: SOFT }}
        />
      </div>
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Error                                                                    */
  /* ------------------------------------------------------------------------ */

  if (error || !data) {
    return (
      <div
        className="rounded-2xl border p-10 text-center"
        style={{
          borderColor: BORDER,
          background: SURFACE,
        }}
      >
        <AlertTriangle
          size={26}
          className="mx-auto mb-3"
          style={{ color: "#9A5B0A" }}
        />

        <p
          className="text-[14px] font-black"
          style={{ color: TEXT }}
        >
          {translate("hub.mdHub.loadFailed")}
        </p>

        <p
          className="mt-1 text-[12px]"
          style={{ color: MUTED }}
        >
          {translate("hub.mdHub.retryHint")}
        </p>
      </div>
    );
  }

  /* ------------------------------------------------------------------------ */
  /* Dashboard                                                                */
  /* ------------------------------------------------------------------------ */

  return (
    <div className="space-y-8">

      {/* ------------------------------------------------------------------ */}
      {/* Waiting list + participant overview (left) + needs action /        */}
      {/* exposure (right) — a two-column row rather than the triage list's  */}
      {/* usual full width, since it's paired with real content instead of   */}
      {/* sitting next to blank canvas (see the "sidebar" variant note in    */}
      {/* GovernanceTriage). Revenue moves below "How we're tracking".       */}
      {/* ------------------------------------------------------------------ */}

      <div className="grid items-stretch gap-5 lg:grid-cols-[1fr_360px]">
        <div className="flex flex-col gap-5">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <WaitlistCard count={waitlist.count} onNavigate={() => navigate("/onboard-participant")} />
            <WaitlistHoursCard hours={waitlist.hours} />
            <AvailableHoursCard />
          </div>
          <ParticipantOverviewCard
            total={data.active_participants}
            bySex={data.participants_by_sex}
            byPlanStatus={data.participants_by_plan_status}
            capacity={{ used: data.active_participants, total: data.active_staff * CASELOAD_PER_WORKER }}
            onNavigate={() => navigate("/patients")}
          />
        </div>
        <GovernanceTriage variant="sidebar" onNavigate={navigate} workersAtRisk={data.workers_at_risk} />
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* How we're tracking — demoted below the triage list                 */}
      {/* ------------------------------------------------------------------ */}

      <div className="space-y-5">
        <div className="flex items-center gap-2">
          <span
            className="text-[10px] font-black uppercase tracking-[0.16em]"
            style={{ color: MUTED }}
          >
            How we're tracking
          </span>
          <span className="h-px flex-1" style={{ background: BORDER }} />
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <ActiveStaffCard
            total={data.active_staff}
            retentionRate={data.staff_retention_rate}
            supportWorkers={data.support_workers}
            coordinators={data.coordinators}
            onClick={() => navigate("/md/staff")}
          />

          <ExecutiveMetric
            label="Support visits"
            value={formatNumber(data.sessions_this_week)}
            detail="This week"
            onClick={() => navigate("/md/schedule")}
            breakdown={[
              { label: "Compliant", value: data.team_compliance_breakdown.compliant, color: GREEN },
              { label: "At risk", value: data.team_compliance_breakdown.at_risk, color: AMBER },
              { label: "Non-compliant", value: data.team_compliance_breakdown.non_compliant, color: RED },
            ]}
          />

          <ExecutiveMetric
            label="Goal achievement"
            value={`${data.goal_achievement_rate}%`}
            detail="Participant goals"
            onClick={() => navigate("/md/service-delivery")}
            achievementPct={data.goal_achievement_rate}
          />
        </div>

        <ComplianceCard
          score={data.compliance_score}
          target={data.compliance_target}
          onNavigate={navigate}
        />

        <ComplianceTrend
          trend={trend}
          target={data.compliance_target}
        />
      </div>

      <RevenueChart />

      <FinancialSummary
        onNavigate={() => navigate("/md/financial")}
      />
    </div>
  );
}
