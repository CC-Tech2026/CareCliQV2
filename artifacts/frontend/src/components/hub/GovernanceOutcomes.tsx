import { useState, type ComponentType } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  CheckCircle2,
  CircleDashed,
  ClipboardCheck,
  FileText,
  FolderCheck,
  HeartHandshake,
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

// Status: always an icon and a word as well as the colour.
const STATUS: Record<OutcomeStatus, { label: string; color: string; soft: string; icon: Icon }> = {
  on_track: { label: "On track", color: "#0F7B57", soft: "rgba(15,123,87,0.10)", icon: CheckCircle2 },
  attention: { label: "Needs attention", color: "#9A5B0A", soft: "rgba(154,91,10,0.10)", icon: AlertTriangle },
  off_track: { label: "Off track", color: "#B3261E", soft: "rgba(179,38,30,0.09)", icon: AlertOctagon },
  no_data: { label: "No data yet", color: "#6B7280", soft: "rgba(107,114,128,0.10)", icon: CircleDashed },
};

const GROUPS: Record<ActionGroup, { title: string; hint: string; color: string }> = {
  now: { title: "Do now", hint: "Overdue or affecting safety", color: "#B3261E" },
  week: { title: "This week", hint: "Due soon, or worse if left", color: "#9A5B0A" },
  watch: { title: "Keep an eye on", hint: "When you have time", color: "#6B7280" },
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

const AREA_ICON: Record<string, Icon> = {
  goals: Target,
  quality: FileText,
  safety: ShieldAlert,
  workforce: Users,
  demand: HeartHandshake,
  revenue: Receipt,
  owed: Receipt,
  profit: Wallet,
  cash: Wallet,
  claims: Send,
};

const SHOW_FIRST = 4;

function dueText(due?: string | null) {
  if (!due) return null;
  const d = new Date(due.length === 10 ? `${due}T00:00:00` : due);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const label = d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  return { text: d < today ? `Overdue since ${label}` : `Due ${label}`, overdue: d < today };
}

/** A thin bar with the target marked: how far along, at a glance. */
function Meter({ pct, target, label, color }: { pct: number; target?: number; label: string; color: string }) {
  const value = Math.max(0, Math.min(100, pct));
  return (
    <div>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(value)}
        className="relative h-2 overflow-hidden rounded-full bg-cc-soft"
      >
        <div className="h-full rounded-full" style={{ width: `${Math.max(value, 2)}%`, background: color }} />
        {target != null ? (
          <span className="absolute inset-y-[-2px] w-0.5 rounded bg-cc-text/60" style={{ left: `${Math.min(99.5, target)}%` }} aria-hidden />
        ) : null}
      </div>
      <p className="mt-phi-2 flex justify-between text-xs text-cc-muted">
        <span>{label}</span>
        {target != null ? <span className="tabular-nums">target {target}%</span> : null}
      </p>
    </div>
  );
}

/** Where the organisation stands: one tile per outcome, in plain words. */
export function OutcomeList({ outcomes, onNavigate }: { outcomes: Outcome[]; onNavigate: (href: string) => void }) {
  return (
    <ul className="grid gap-phi-4 sm:grid-cols-2 xl:grid-cols-3">
      {outcomes.map((o) => {
        const s = STATUS[o.status];
        const StatusIcon = s.icon;
        const AreaIcon = AREA_ICON[o.id] ?? ClipboardCheck;
        return (
          <li key={o.id} className="flex min-w-0 flex-col rounded-2xl border border-cc-border bg-cc-surface p-phi-5">
            <div className="flex items-center justify-between gap-phi-3">
              <span className="flex min-w-0 items-center gap-phi-3 text-sm font-medium text-cc-muted">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: s.soft, color: s.color }}>
                  <AreaIcon size={17} aria-hidden />
                </span>
                <span className="truncate">{o.area}</span>
              </span>
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: s.soft, color: s.color }}>
                <StatusIcon size={13} aria-hidden /> {s.label}
              </span>
            </div>
            <p className="mt-phi-4 text-base font-semibold leading-snug text-cc-text">{o.headline}</p>
            <p className="mt-phi-2 text-sm text-cc-muted">{o.detail}</p>
            {o.meter ? (
              <div className="mt-phi-4">
                <Meter pct={o.meter.pct} target={o.meter.target} label={o.meter.label} color={s.color} />
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => onNavigate(o.action.href)}
              className="mt-auto inline-flex min-h-10 items-center gap-1.5 self-start pt-phi-4 text-sm font-semibold text-cc-text hover:underline"
            >
              {o.action.label} <ArrowRight size={14} aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function TaskCard({ item, onNavigate }: { item: ActionItem; onNavigate: (href: string) => void }) {
  const KindIcon = KIND_ICON[actionKind(item)];
  const due = dueText(item.due);
  const g = GROUPS[item.group];
  return (
    <li className="rounded-xl border border-cc-border bg-cc-surface p-phi-4 shadow-[0_1px_0_rgba(0,0,0,0.02)]">
      <div className="flex gap-phi-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cc-soft" style={{ color: g.color }}>
          <KindIcon size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 text-sm font-semibold leading-snug text-cc-text">{item.title}</p>
          <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-cc-muted" title={item.detail}>{item.detail}</p>
        </div>
      </div>
      <div className="mt-phi-3 flex flex-wrap items-center justify-between gap-2 pl-[2.6rem]">
        {due ? (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${due.overdue ? "bg-[rgba(179,38,30,0.09)] text-[#B3261E]" : "bg-cc-soft text-cc-muted"}`}>
            {due.text}
          </span>
        ) : <span />}
        <button
          type="button"
          onClick={() => onNavigate(item.href)}
          className="inline-flex min-h-9 items-center gap-1 rounded-full border border-cc-border bg-cc-surface px-3 text-xs font-semibold text-cc-text hover:border-cc-text/40 hover:bg-cc-soft"
        >
          {item.actionLabel} <ArrowRight size={13} aria-hidden />
        </button>
      </div>
    </li>
  );
}

function BoardColumn({ group, items, onNavigate }: { group: ActionGroup; items: ActionItem[]; onNavigate: (href: string) => void }) {
  const [all, setAll] = useState(false);
  const g = GROUPS[group];
  const shown = all ? items : items.slice(0, SHOW_FIRST);
  return (
    <section aria-label={g.title} className="flex min-w-0 flex-col rounded-2xl bg-cc-soft/60 p-phi-3">
      <header className="flex items-baseline justify-between gap-2 px-phi-2 pb-phi-3 pt-phi-1">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-cc-text">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} aria-hidden />
          {g.title}
          <span className="rounded-full bg-cc-surface px-2 text-xs font-semibold tabular-nums text-cc-muted">{items.length}</span>
        </h3>
        <p className="truncate text-[11px] text-cc-muted">{g.hint}</p>
      </header>
      {items.length ? (
        <ul className="space-y-phi-3">
          {shown.map((a) => <TaskCard key={a.id} item={a} onNavigate={onNavigate} />)}
        </ul>
      ) : (
        <p className="flex items-center gap-2 rounded-xl bg-cc-surface px-phi-4 py-phi-4 text-sm text-cc-muted">
          <CheckCircle2 size={16} className="text-[#0F7B57]" aria-hidden /> Nothing here
        </p>
      )}
      {items.length > SHOW_FIRST ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="mt-phi-3 min-h-10 rounded-xl px-phi-3 text-left text-sm font-semibold text-cc-text hover:bg-cc-surface"
        >
          {all ? "Show fewer" : `Show ${items.length - SHOW_FIRST} more`}
        </button>
      ) : null}
    </section>
  );
}

/** What to do, as a board: Do now, This week, Keep an eye on, side by side. */
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
      <div role="status" className="grid gap-phi-4 lg:grid-cols-3">
        <span className="sr-only">Loading what needs doing…</span>
        {[0, 1, 2].map((i) => <div key={i} className="h-56 animate-pulse rounded-2xl bg-cc-soft" />)}
      </div>
    );
  }
  if (!actions.length && !failed) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-cc-border bg-cc-surface px-phi-5 py-phi-4 text-sm text-cc-text">
        <CheckCircle2 size={18} className="text-[#0F7B57]" aria-hidden />
        Nothing needs your action right now.
      </div>
    );
  }
  return (
    <div className="space-y-phi-3">
      {failed ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-cc-border bg-cc-surface px-4 py-3 text-sm text-cc-text">
          Some action items couldn't be loaded, so this list may be short.
          {onRetry ? <button type="button" onClick={onRetry} className="font-semibold text-cc-plum underline">Try again</button> : null}
        </p>
      ) : null}
      {(() => {
        // Only columns with something in them; the rest give way.
        const used = (["now", "week", "watch"] as const).filter((g) => actions.some((a) => a.group === g));
        const cols = used.length === 3 ? "lg:grid-cols-3" : used.length === 2 ? "lg:grid-cols-2" : "";
        return (
          <div className={`grid items-start gap-phi-4 ${cols}`}>
            {used.map((g) => (
              <BoardColumn key={g} group={g} items={actions.filter((a) => a.group === g)} onNavigate={onNavigate} />
            ))}
          </div>
        );
      })()}
    </div>
  );
}
