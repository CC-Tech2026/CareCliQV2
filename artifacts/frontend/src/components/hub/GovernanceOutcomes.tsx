import { useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";

import type { ActionGroup, ActionItem, Outcome, OutcomeStatus } from "@/lib/governance-outcomes";

const STATUS: Record<OutcomeStatus, { label: string; dot: string; text: string }> = {
  on_track: { label: "On track", dot: "#0F7B57", text: "text-[#0F7B57]" },
  attention: { label: "Needs attention", dot: "#9A5B0A", text: "text-[#9A5B0A]" },
  off_track: { label: "Off track", dot: "#B3261E", text: "text-[#B3261E]" },
  no_data: { label: "No data yet", dot: "#9CA3AF", text: "text-cc-muted" },
};

const GROUPS: Record<ActionGroup, { title: string; hint: string; dot: string }> = {
  now: { title: "Do now", hint: "Overdue or affecting someone's safety", dot: "#B3261E" },
  week: { title: "This week", hint: "Due soon, or getting worse if left", dot: "#9A5B0A" },
  watch: { title: "Keep an eye on", hint: "Worth a look when you have time", dot: "#9CA3AF" },
};

const SHOW_FIRST = 5;

function dueText(due?: string | null) {
  if (!due) return null;
  const d = new Date(due.length === 10 ? `${due}T00:00:00` : due);
  if (Number.isNaN(d.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const label = d.toLocaleDateString("en-AU", { day: "numeric", month: "short" });
  return d < today ? `Overdue since ${label}` : `Due ${label}`;
}

/** Where the organisation stands, one outcome per line, in plain words. */
export function OutcomeList({ outcomes, onNavigate }: { outcomes: Outcome[]; onNavigate: (href: string) => void }) {
  return (
    <ul className="divide-y divide-cc-border overflow-hidden rounded-2xl border border-cc-border bg-cc-surface">
      {outcomes.map((o) => {
        const s = STATUS[o.status];
        return (
          <li key={o.id} className="grid gap-x-5 gap-y-2 px-5 py-4 sm:grid-cols-[150px_minmax(0,1fr)_auto] sm:items-center">
            <div>
              <p className="text-xs font-medium text-cc-muted">{o.area}</p>
              <p className={`mt-0.5 flex items-center gap-1.5 text-sm font-semibold ${s.text}`}>
                <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: s.dot }} aria-hidden />
                {s.label}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[15px] font-semibold leading-snug text-cc-text">{o.headline}</p>
              <p className="mt-0.5 text-sm text-cc-muted">{o.detail}</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate(o.action.href)}
              className="inline-flex min-h-10 items-center gap-1.5 justify-self-start whitespace-nowrap rounded-full border border-cc-border px-4 text-sm font-medium text-cc-text hover:bg-cc-soft sm:justify-self-end"
            >
              {o.action.label} <ArrowRight size={14} aria-hidden />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function ActionGroupList({ group, items, onNavigate }: { group: ActionGroup; items: ActionItem[]; onNavigate: (href: string) => void }) {
  const [all, setAll] = useState(false);
  const g = GROUPS[group];
  const shown = all ? items : items.slice(0, SHOW_FIRST);
  return (
    <section aria-label={g.title} className="overflow-hidden rounded-2xl border border-cc-border bg-cc-surface">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-cc-border px-5 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-cc-text">
          <span className="h-2 w-2 rounded-full" style={{ background: g.dot }} aria-hidden />
          {g.title} <span className="font-normal text-cc-muted">{items.length}</span>
        </h3>
        <p className="text-xs text-cc-muted">{g.hint}</p>
      </header>
      <ul className="divide-y divide-cc-border">
        {shown.map((a) => {
          const due = dueText(a.due);
          return (
            <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5">
              <div className="min-w-0 flex-1 basis-72">
                <p className="text-sm font-semibold text-cc-text">{a.title}</p>
                <p className="mt-0.5 text-sm text-cc-muted">
                  {a.detail}
                  {due ? <span className={due.startsWith("Overdue") ? " font-medium text-[#B3261E]" : ""}>{` ${due}.`}</span> : null}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onNavigate(a.href)}
                className="inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap rounded-full border border-cc-border px-4 text-sm font-medium text-cc-text hover:bg-cc-soft"
              >
                {a.actionLabel} <ArrowRight size={14} aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {items.length > SHOW_FIRST ? (
        <button
          type="button"
          onClick={() => setAll((v) => !v)}
          className="w-full border-t border-cc-border px-5 py-2.5 text-left text-sm font-medium text-cc-plum hover:bg-cc-soft"
        >
          {all ? "Show fewer" : `Show ${items.length - SHOW_FIRST} more`}
        </button>
      ) : null}
    </section>
  );
}

/** Everything to act on, grouped by when it needs doing, one button each. */
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
      <div role="status" className="space-y-2">
        <span className="sr-only">Loading what needs doing…</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-16 animate-pulse rounded-2xl bg-cc-soft" />
        ))}
      </div>
    );
  }
  const groups = (["now", "week", "watch"] as const).filter((g) => actions.some((a) => a.group === g));
  return (
    <div className="space-y-4">
      {failed ? (
        <p role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-cc-border bg-cc-surface px-4 py-3 text-sm text-cc-text">
          Some action items couldn't be loaded, so this list may be short.
          {onRetry ? (
            <button type="button" onClick={onRetry} className="font-semibold text-cc-plum underline">
              Try again
            </button>
          ) : null}
        </p>
      ) : null}
      {groups.length ? (
        groups.map((g) => (
          <ActionGroupList key={g} group={g} items={actions.filter((a) => a.group === g)} onNavigate={onNavigate} />
        ))
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-cc-border bg-cc-surface px-5 py-4 text-sm text-cc-text">
          <CheckCircle2 size={18} className="text-[#0F7B57]" aria-hidden />
          Nothing needs your action right now.
        </div>
      )}
    </div>
  );
}
