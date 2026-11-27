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

/* Governance pages share two pieces: a scorecard (where each area stands)
 * and an inbox (what to do about it). Both are one surface of ruled rows,
 * never a grid of boxes. Status is always a word and an icon as well as a
 * colour, and the colours come from the chart tokens so dark mode holds. */

const STATUS: Record<OutcomeStatus, { label: string; text: string; bar: string; icon: Icon }> = {
  on_track: { label: "Meets target", text: "var(--viz-good-text)", bar: "var(--viz-good)", icon: CheckCircle2 },
  attention: { label: "Review recommended", text: "var(--viz-warning-text)", bar: "var(--viz-warning)", icon: AlertTriangle },
  off_track: { label: "Action required", text: "var(--viz-critical-text)", bar: "var(--viz-critical)", icon: AlertOctagon },
  no_data: { label: "No data recorded", text: "var(--cc-muted)", bar: "var(--cc-muted)", icon: CircleDashed },
};

const GROUPS: Record<ActionGroup, { title: string; color: string }> = {
  now: { title: "Immediate action", color: "var(--viz-critical-text)" },
  week: { title: "Due this week", color: "var(--viz-warning-text)" },
  watch: { title: "Monitor", color: "var(--cc-muted)" },
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

const SHOW_FIRST = 5;
const SURFACE = "overflow-hidden rounded-xl border border-cc-border bg-cc-surface";
const ROW_HOVER = "transition-colors hover:bg-cc-soft/50 focus-visible:relative focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cc-plum";

function dueText(due?: string | null) {
  if (!due) return null;
  const d = new Date(due.length === 10 ? `${due}T00:00:00` : due);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return { text: d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }), overdue: d < today };
}

function dueLabel(due: { text: string; overdue: boolean }) {
  return due.overdue ? `Overdue since ${due.text}` : `Due ${due.text}`;
}

function dueStyle(overdue: boolean) {
  return { color: overdue ? "var(--viz-critical-text)" : "var(--cc-muted)", fontWeight: overdue ? 600 : 400 };
}

/** How full against 100, on a lighter step of the same colour, with the
 *  target marked. Only for a figure that is a share; a count gets no bar. */
function Meter({ pct, target, color, label }: { pct: number; target?: number; color: string; label: string }) {
  const value = Math.max(0, Math.min(100, pct));
  return (
    <span className="flex w-full items-center gap-2.5">
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        aria-valuetext={target != null ? `${Math.round(value)}%, target ${target}%` : `${Math.round(value)}%`}
        className="relative block h-1.5 min-w-0 flex-1 rounded-full"
        style={{ background: `color-mix(in oklab, ${color} 18%, var(--cc-surface))` }}
      >
        {value > 0 ? <span className="block h-full rounded-full" style={{ width: `${value}%`, background: color }} /> : null}
        {target != null ? (
          <span aria-hidden className="absolute -top-1 h-3.5 w-0.5 rounded-full bg-cc-text/60" style={{ left: `calc(${Math.min(99, target)}% - 1px)` }} />
        ) : null}
      </span>
      {target != null ? <span className="shrink-0 text-[11px] tabular-nums text-cc-muted">Target {target}%</span> : null}
    </span>
  );
}

/** Where things stand, one ruled row per area: the name and its status,
 *  the figure, a meter against the target when the figure is a share, why,
 *  and where to deal with it. In a narrow column the row folds to two
 *  lines; across a page it reads as a scorecard. */
export function OutcomeList({ outcomes, onNavigate }: { outcomes: Outcome[]; onNavigate: (href: string) => void }) {
  return (
    <ul className={`@container divide-y divide-cc-border ${SURFACE}`}>
      {outcomes.map((o) => {
        const s = STATUS[o.status];
        const StatusIcon = s.icon;
        const tile = o.ring ?? { value: "", label: o.area, caption: s.label, pct: o.meter?.pct };
        const pct = o.meter?.pct ?? tile.pct;
        const caption = tile.value ? tile.caption : s.label;
        return (
          <li key={o.id}>
            <button
              type="button"
              onClick={() => onNavigate(o.action.href)}
              className={`group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-5 py-4 text-left @3xl:grid-cols-[minmax(9rem,13rem)_6.5rem_minmax(8rem,13rem)_minmax(0,1fr)_auto] @3xl:gap-x-6 ${ROW_HOVER}`}
            >
              {/* The area in full, for screen readers: the row shows it in short. */}
              <span className="sr-only"><span>{o.area}</span> <span>{s.label}.</span> <span>{o.headline}</span></span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-cc-text group-hover:underline">{tile.label}</span>
                <span className="mt-0.5 flex items-center gap-1 text-xs font-medium" style={{ color: s.text }}>
                  <StatusIcon size={12} className="shrink-0" />
                  <span className="truncate">{caption}</span>
                </span>
              </span>
              <span className={`text-right font-semibold tabular-nums tracking-tight text-cc-text @3xl:text-left ${tile.value ? (tile.value.length >= 6 ? "text-xl" : "text-2xl") : "text-base"}`}>
                {tile.value || s.label}
              </span>
              <span className={pct == null ? "hidden @3xl:block" : "col-span-2 @3xl:col-span-1"}>
                {pct != null ? <Meter pct={pct} target={o.meter?.target} color={s.bar} label={o.meter?.label ?? tile.label} /> : null}
              </span>
              <span className="col-span-2 line-clamp-2 text-xs leading-5 text-cc-muted @3xl:col-span-1">{o.detail}</span>
              <span className="hidden items-center gap-1 whitespace-nowrap text-xs font-semibold text-cc-text @3xl:inline-flex">
                {o.action.label}
                <ArrowRight size={13} className="transition-transform group-hover:translate-x-0.5" />
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** The same areas as a slim strip of figures, for the top of a page: one
 *  surface split by hairlines, each figure opening where it's dealt with.
 *  The reason sentence shows on hover and to screen readers. */
export function OutcomeStrip({ outcomes, onNavigate }: { outcomes: Outcome[]; onNavigate: (href: string) => void }) {
  const n = outcomes.length;
  const wide = n >= 6 ? "lg:grid-cols-6" : n === 5 ? "lg:grid-cols-5" : n === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3";
  return (
    <ul className={`grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-cc-border bg-cc-border sm:grid-cols-3 ${wide}`}>
      {outcomes.map((o, i) => {
        const s = STATUS[o.status];
        const StatusIcon = s.icon;
        const tile = o.ring ?? { value: "", label: o.area, caption: s.label, pct: o.meter?.pct };
        const pct = o.meter?.pct ?? tile.pct;
        const caption = tile.value ? tile.caption : s.label;
        // An odd last item on a phone takes the whole row rather than leave a hole.
        const last = i === n - 1 && n % 2 === 1 ? "col-span-2 sm:col-span-1" : "";
        return (
          <li key={o.id} className={`bg-cc-surface ${last}`}>
            <button
              type="button"
              onClick={() => onNavigate(o.action.href)}
              title={`${o.headline}. ${o.detail}`}
              className={`group flex h-full w-full flex-col items-start px-5 py-4 text-left ${ROW_HOVER}`}
            >
              <span className="sr-only"><span>{o.area}</span> <span>{s.label}.</span> <span>{o.headline}.</span> <span>{o.detail}</span></span>
              <span aria-hidden className="text-xs font-medium text-cc-muted group-hover:text-cc-text">{tile.label}</span>
              <span aria-hidden className={`mt-1 font-semibold tabular-nums tracking-tight text-cc-text ${tile.value ? "text-2xl" : "text-base"}`}>
                {tile.value || s.label}
              </span>
              <span aria-hidden className="mt-1 flex items-center gap-1 text-xs font-medium" style={{ color: s.text }}>
                <StatusIcon size={12} className="shrink-0" />
                <span className="line-clamp-1">{caption}</span>
              </span>
              {pct != null ? (
                <span aria-hidden className="mt-3 block w-full">
                  <Meter pct={pct} target={o.meter?.target} color={s.bar} label={o.meter?.label ?? tile.label} />
                </span>
              ) : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TaskRow({ item, onNavigate }: { item: ActionItem; onNavigate: (href: string) => void }) {
  const KindIcon = KIND_ICON[actionKind(item)];
  const due = dueText(item.due);
  const g = GROUPS[item.group];
  return (
    <li>
      <button
        type="button"
        onClick={() => onNavigate(item.href)}
        title={`${item.title}. ${item.detail}`}
        className={`group flex w-full items-center gap-3.5 px-5 py-3 text-left ${ROW_HOVER}`}
      >
        <KindIcon size={18} className="shrink-0" style={{ color: g.color }} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-sm font-medium text-cc-text sm:line-clamp-1">{item.title}</span>
          <span className="sr-only">{item.detail}</span>
          {/* On a phone the due date takes the second line; wider, it sits on the right. */}
          {due ? (
            <span className="block text-xs sm:hidden" style={dueStyle(due.overdue)}>{dueLabel(due)}</span>
          ) : null}
          <span className={`truncate text-xs text-cc-muted ${due ? "hidden sm:block" : "block"}`}>{item.actionLabel}</span>
        </span>
        {due ? (
          <span className="hidden shrink-0 whitespace-nowrap text-xs tabular-nums sm:block" style={dueStyle(due.overdue)}>
            {dueLabel(due)}
          </span>
        ) : null}
        <ChevronRight size={16} className="shrink-0 text-cc-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
      </button>
    </li>
  );
}

function TaskGroup({ group, items, onNavigate }: { group: ActionGroup; items: ActionItem[]; onNavigate: (href: string) => void }) {
  const [all, setAll] = useState(false);
  const g = GROUPS[group];
  const shown = all ? items : items.slice(0, SHOW_FIRST);
  return (
    <section aria-label={g.title}>
      <h3 className="flex items-center gap-2 bg-cc-soft/40 px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-cc-muted">
        <span className="h-1.5 w-1.5 rounded-full" style={{ background: g.color }} aria-hidden />
        {g.title}
        <span className="tabular-nums">{items.length}</span>
      </h3>
      <ul className="divide-y divide-cc-border border-t border-cc-border">
        {shown.map((a) => <TaskRow key={a.id} item={a} onNavigate={onNavigate} />)}
        {items.length > SHOW_FIRST ? (
          <li>
            <button
              type="button"
              onClick={() => setAll((v) => !v)}
              className={`w-full px-5 py-2.5 text-left text-xs font-semibold text-cc-text ${ROW_HOVER}`}
            >
              {all ? "Show fewer" : `Show ${items.length - SHOW_FIRST} more`}
            </button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

/** What to do, as an inbox: ruled rows under Do now / This week / Later.
 *  Each row opens where it's dealt with; the full note shows on hover and
 *  to screen readers. */
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
      <div role="status" className={`divide-y divide-cc-border ${SURFACE}`}>
        <span className="sr-only">Loading actions…</span>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-3.5 px-5 py-3.5">
            <div className="h-4 w-4 animate-pulse rounded bg-cc-soft motion-reduce:animate-none" />
            <div className="h-3.5 flex-1 animate-pulse rounded bg-cc-soft motion-reduce:animate-none" />
          </div>
        ))}
      </div>
    );
  }
  if (!actions.length && !failed) {
    return (
      <div className={`flex items-center gap-3 px-5 py-4 text-sm text-cc-text ${SURFACE}`}>
        <CheckCircle2 size={18} style={{ color: "var(--viz-good-text)" }} aria-hidden />
        No actions are outstanding.
      </div>
    );
  }
  return (
    <div className={`divide-y divide-cc-border ${SURFACE}`}>
      {failed ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 px-5 py-3 text-sm text-cc-text">
          Some actions could not be loaded.
          {onRetry ? <button type="button" onClick={onRetry} className="font-semibold text-cc-plum underline">Try again</button> : null}
        </p>
      ) : null}
      {(["now", "week", "watch"] as const)
        .filter((g) => actions.some((a) => a.group === g))
        .map((g) => <TaskGroup key={g} group={g} items={actions.filter((a) => a.group === g)} onNavigate={onNavigate} />)}
    </div>
  );
}

/** "7 actions outstanding · 3 require immediate action", for the top of a page. */
export function actionCountLine(actions: ActionItem[]): string {
  if (!actions.length) return "No actions are outstanding";
  const now = actions.filter((a) => a.group === "now").length;
  return `${actions.length} ${actions.length === 1 ? "action" : "actions"} outstanding${now ? ` · ${now} ${now === 1 ? "requires" : "require"} immediate action` : ""}`;
}
