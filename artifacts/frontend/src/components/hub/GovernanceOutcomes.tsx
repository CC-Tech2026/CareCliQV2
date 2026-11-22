import { useState, type ComponentType } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  ClipboardCheck,
  FileText,
  FolderCheck,
  type LucideProps,
  Receipt,
  Send,
  ShieldAlert,
  Target,
  UserPlus,
  Users,
  Wallet,
} from "lucide-react";

import {
  actionKind,
  type ActionGroup,
  type ActionItem,
  type ActionKind,
  type Outcome,
  type OutcomeStatus,
} from "@/lib/governance-outcomes";

type Icon = ComponentType<LucideProps>;

// Status is always an icon and a word as well as a colour.
const STATUS: Record<OutcomeStatus, { label: string; color: string; soft: string; icon: Icon }> = {
  on_track: { label: "On track", color: "#0F7B57", soft: "rgba(15,123,87,0.10)", icon: CheckCircle2 },
  attention: { label: "Needs a look", color: "#9A5B0A", soft: "rgba(154,91,10,0.10)", icon: AlertTriangle },
  off_track: { label: "Off track", color: "#B3261E", soft: "rgba(179,38,30,0.09)", icon: AlertOctagon },
  no_data: { label: "No data yet", color: "#6B7280", soft: "rgba(107,114,128,0.10)", icon: CircleDashed },
};

const GROUPS: Record<ActionGroup, { title: string; color: string }> = {
  now: { title: "Do now", color: "#B3261E" },
  week: { title: "This week", color: "#9A5B0A" },
  watch: { title: "Later", color: "#6B7280" },
};

const KIND_ICON: Record<ActionKind, Icon> = {
  incident: ShieldAlert,
  credential: BadgeCheck,
  notes: FileText,
  enquiry: UserPlus,
  goal: Target,
  invoice: Receipt,
  claim: Send,
  money: Wallet,
  evidence: FolderCheck,
  people: Users,
  other: ClipboardCheck,
};

const SHOW_FIRST = 6;

function dueText(due?: string | null) {
  if (!due) return null;
  const d = new Date(due.length === 10 ? `${due}T00:00:00` : due);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { text: d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }), overdue: d < today };
}

// The status as text and as a bar, from the shared chart colours so they hold
// up in dark mode. The word and icon always come with the colour.
const STATUS_INK: Record<OutcomeStatus, { text: string; bar: string }> = {
  on_track: { text: "var(--viz-good-text)", bar: "var(--viz-good)" },
  attention: { text: "var(--viz-warning-text)", bar: "var(--viz-warning)" },
  off_track: { text: "var(--viz-critical-text)", bar: "var(--viz-critical)" },
  no_data: { text: "var(--cc-muted)", bar: "var(--cc-muted)" },
};

/** How full against 100, on a lighter step of the same colour, with the
 *  target marked. Only for a figure that is a share; a count gets no bar. */
function TileMeter({ pct, target, color, label }: { pct: number; target?: number; color: string; label: string }) {
  const value = Math.max(0, Math.min(100, pct));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      aria-valuetext={target != null ? `${Math.round(value)}%, target ${target}%` : `${Math.round(value)}%`}
      className="relative h-1.5 w-full rounded-full"
      style={{ background: `color-mix(in oklab, ${color} 18%, var(--cc-surface))` }}
    >
      {value > 0 ? <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} /> : null}
      {target != null ? (
        <span aria-hidden className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-cc-text/60" style={{ left: `calc(${Math.min(99, target)}% - 1px)` }} />
      ) : null}
    </div>
  );
}

/** Where things stand: one tile per area. Each tile says everything about
 *  its area (the figure, how it stands, why, and against what target) and
 *  takes you to where you deal with it; there's nothing more to open. */
export function OutcomeList({ outcomes, onNavigate }: { outcomes: Outcome[]; onNavigate: (href: string) => void }) {
  const n = outcomes.length;
  const cols = n >= 7 ? "lg:grid-cols-4 xl:grid-cols-7" : n === 6 ? "lg:grid-cols-3 xl:grid-cols-6" : n === 5 ? "lg:grid-cols-5" : n === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3";
  return (
    <ul className={`grid grid-cols-1 gap-phi-4 min-[420px]:grid-cols-2 sm:grid-cols-3 ${cols}`}>
      {outcomes.map((o) => {
        const s = STATUS[o.status];
        const ink = STATUS_INK[o.status];
        const StatusIcon = s.icon;
        const tile = o.ring ?? { value: "", label: o.area, caption: s.label, pct: o.meter?.pct };
        const pct = o.meter?.pct ?? tile.pct;
        return (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => onNavigate(o.action.href)}
              className="group flex h-full w-full flex-col items-start rounded-2xl border border-cc-border bg-cc-surface p-phi-4 text-left transition-colors hover:border-cc-text/30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
            >
              <span className="text-sm font-medium text-cc-muted">{tile.label}</span>
              {/* The area in full, for screen readers: the tile shows it in short. */}
              <span className="sr-only"><span>{o.area}</span> <span>{s.label}.</span> <span>{o.headline}</span></span>
              {tile.value ? (
                <span className={`mt-1 ${tile.value.length >= 5 ? "text-2xl" : "text-3xl"} font-semibold leading-tight tracking-tight text-cc-text`}>{tile.value}</span>
              ) : (
                <span className="mt-1 text-lg font-semibold leading-tight text-cc-text">{s.label}</span>
              )}
              <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium" style={{ color: ink.text }}>
                <StatusIcon size={12} aria-hidden /> {tile.value ? tile.caption : s.label === tile.caption ? null : tile.caption}
              </span>
              {pct != null ? (
                <span className="mt-phi-3 block w-full">
                  <TileMeter pct={pct} target={o.meter?.target} color={ink.bar} label={o.meter?.label ?? tile.label} />
                  {o.meter?.target != null ? <span className="mt-1 block text-[11px] text-cc-muted">Target {o.meter.target}%</span> : null}
                </span>
              ) : null}
              <span className="mt-phi-3 line-clamp-3 text-xs leading-5 text-cc-muted">{o.detail}</span>
              <span className="mt-auto inline-flex items-center gap-1 pt-phi-3 text-xs font-semibold text-cc-text group-hover:underline">
                {o.action.label} <ArrowRight size={13} aria-hidden />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TaskChip({ item, onNavigate }: { item: ActionItem; onNavigate: (href: string) => void }) {
  const KindIcon = KIND_ICON[actionKind(item)];
  const due = dueText(item.due);
  const g = GROUPS[item.group];
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => onNavigate(item.href)}
        title={`${item.title}. ${item.detail}`}
        className="group flex w-full items-center gap-phi-3 rounded-xl border border-cc-border bg-cc-surface px-phi-3 py-phi-3 text-left transition hover:border-cc-text/25 hover:shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: "var(--cc-soft)", color: g.color }}>
          <KindIcon size={17} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-cc-text">{item.title}</span>
          <span className="sr-only">{item.detail} {item.actionLabel}.</span>
          {due ? (
            <span className={`block text-xs ${due.overdue ? "font-semibold text-[#B3261E]" : "text-cc-muted"}`}>
              {due.overdue ? `Overdue since ${due.text}` : `Due ${due.text}`}
            </span>
          ) : (
            <span className="block truncate text-xs text-cc-muted">{item.actionLabel}</span>
          )}
        </span>
        <ChevronRight size={16} className="shrink-0 text-cc-muted transition group-hover:translate-x-0.5" aria-hidden />
      </button>
    </li>
  );
}

function ChipGroup({ group, items, onNavigate }: { group: ActionGroup; items: ActionItem[]; onNavigate: (href: string) => void }) {
  const [all, setAll] = useState(false);
  const g = GROUPS[group];
  const shown = all ? items : items.slice(0, SHOW_FIRST);
  return (
    <section aria-label={g.title}>
      <h3 className="mb-phi-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-cc-muted">
        <span className="h-2 w-2 rounded-full" style={{ background: g.color }} aria-hidden />
        {g.title} <span className="tabular-nums">{items.length}</span>
      </h3>
      <ul className="grid gap-phi-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((a) => <TaskChip key={a.id} item={a} onNavigate={onNavigate} />)}
        {items.length > SHOW_FIRST ? (
          <li>
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className="flex h-full min-h-[3.75rem] w-full items-center justify-center rounded-xl border border-dashed border-cc-border text-sm font-semibold text-cc-text hover:bg-cc-soft"
            >
              {all ? "Show fewer" : `+${items.length - SHOW_FIRST} more`}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

/** What to do, as short chips grouped Do now / This week / Later. Each opens
 *  where it's dealt with; the full note shows on hover and to screen readers. */
export function ActionList({
  actions,
  loading,
  failed,
  onRetry,
  onNavigate,
}: {
  actions: ActionItem[];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
  onNavigate: (href: string) => void;
}) {
  if (loading) {
    return (
      <div role="status" className="grid gap-phi-3 sm:grid-cols-2 xl:grid-cols-3">
        <span className="sr-only">Loading what needs doing…</span>
        {[0, 1, 2, 3, 4, 5].map((i) => <div key={i} className="h-[3.75rem] animate-pulse rounded-xl bg-cc-soft" />)}
      </div>
    );
  }
  if (!actions.length && !failed) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-cc-border bg-cc-surface px-phi-5 py-phi-4 text-sm text-cc-text">
        <CheckCircle2 size={18} className="text-[#0F7B57]" aria-hidden />
        Nothing needs you right now.
      </div>
    );
  }
  return (
    <div className="space-y-phi-5">
      {failed ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-cc-border bg-cc-surface px-4 py-3 text-sm text-cc-text">
          Some items couldn't be loaded.
          {onRetry ? <button type="button" onClick={onRetry} className="font-semibold text-cc-plum underline">Try again</button> : null}
        </p>
      ) : null}
      {(["now", "week", "watch"] as const)
        .filter((g) => actions.some((a) => a.group === g))
        .map((g) => <ChipGroup key={g} group={g} items={actions.filter((a) => a.group === g)} onNavigate={onNavigate} />)}
    </div>
  );
}

/** "7 things need you · 3 overdue", for the top of a page. */
export function actionCountLine(actions: ActionItem[]): string {
  if (!actions.length) return "Nothing needs you right now";
  const overdue = actions.filter((a) => a.group === "now").length;
  return `${actions.length} ${actions.length === 1 ? "thing needs" : "things need"} you${overdue ? ` · ${overdue} to do now` : ""}`;
}
