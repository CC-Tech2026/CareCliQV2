/**
 * Page-level pieces in the vault's style, so the Oversight & Risk pages
 * (Audit & Compliance, incidents, complaints, feedback) read as one set:
 * a quiet header, a strip of numbers you can click, pill filters, white
 * borderless surfaces with divided rows, and plain empty states.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { Search, type LucideIcon } from "lucide-react";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

const focusRing =
  "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum";

/** Main action: a solid pill in the CTA colour. */
export const ctaClass = `inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 bg-[var(--cc-cta)] ${focusRing}`;
/** Quiet header action: text only until hovered. */
export const ghostClass = `inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium text-cc-text transition hover:bg-cc-soft disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
/** Secondary action inside content: an outlined pill. */
export const outlineClass = `inline-flex min-h-10 items-center justify-center gap-2 rounded-full border border-cc-border px-4 text-sm font-medium text-cc-text transition hover:bg-cc-soft disabled:cursor-not-allowed disabled:opacity-50 ${focusRing}`;
/** Row inside a Surface list. */
export const rowClass =
  "flex w-full items-center gap-3 px-4 py-3.5 text-left transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cc-plum sm:px-5";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
  back,
}: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** A small link above the header, e.g. back to a parent list. */
  back?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-5">
      <div className="max-w-2xl">
        {back && <div className="mb-3">{back}</div>}
        <p className="text-xs font-semibold" style={{ color: MUTED }}>{eyebrow}</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>
          {title}
        </h1>
        {description && <p className="mt-2 text-sm leading-6" style={{ color: MUTED }}>{description}</p>}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-1 sm:w-auto sm:gap-2">{actions}</div>}
    </header>
  );
}

export type Tone = "neutral" | "good" | "warning" | "danger" | "info";

export function toneColor(tone: Tone | undefined) {
  if (tone === "danger") return "var(--cc-danger-text)";
  if (tone === "warning") return "var(--cc-amber)";
  if (tone === "good") return "var(--cc-green)";
  if (tone === "info") return "var(--cc-sky)";
  return TEXT;
}

export interface SummaryItem {
  value: ReactNode;
  label: string;
  tone?: Tone;
  onClick?: () => void;
  /** Shown filled when this number is the active filter. */
  active?: boolean;
  /** A short second line under the number, e.g. "186 invoices · 91% collected". */
  hint?: ReactNode;
}

/** Big numbers in a row, split by thin rules. Each can act as a filter. */
export function SummaryStrip({ items, loading }: { items: SummaryItem[]; loading?: boolean }) {
  return (
    <div className="flex flex-wrap items-stretch gap-x-2 gap-y-3">
      {items.map((item, index) => {
        const body = (
          <span className="block text-left">
            <span className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums tracking-tight" style={{ color: toneColor(item.tone) }}>
                {loading ? "…" : item.value}
              </span>
              <span className="text-sm" style={{ color: MUTED }}>{item.label}</span>
            </span>
            {item.hint && <span className="block text-xs" style={{ color: MUTED }}>{item.hint}</span>}
          </span>
        );
        return (
          <div key={item.label} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden className="mr-2 hidden h-6 w-px sm:block" style={{ background: BORDER }} />}
            {item.onClick ? (
              <button
                type="button"
                onClick={item.onClick}
                aria-pressed={item.active}
                className={`flex min-h-11 items-center px-3 transition hover:bg-cc-soft ${item.hint ? "rounded-2xl py-1.5" : "rounded-full"} ${focusRing}`}
                style={item.active ? { boxShadow: `inset 0 0 0 1px ${BORDER}`, background: "var(--cc-surface)" } : undefined}
              >
                {body}
              </button>
            ) : (
              <span className="flex min-h-11 items-center px-3">{body}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export interface PillOption<K extends string> {
  key: K;
  label: string;
  icon?: LucideIcon;
  count?: number;
  /** Render as a link instead of a button. */
  href?: string;
  /** Hover hint describing the view. */
  title?: string;
}

/** A row of pill filters: the chosen one is filled navy, like the vault's toggles. */
export function PillTabs<K extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: PillOption<K>[];
  value: K;
  onChange?: (key: K) => void;
  label: string;
}) {
  return (
    <nav aria-label={label} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-1">
      {options.map(({ key, label: text, icon: Icon, count, href, title }) => {
        const on = key === value;
        const className = `inline-flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-sm font-medium transition ${on ? "" : "hover:bg-cc-soft"} ${focusRing}`;
        const style = on
          ? { background: "var(--cc-text)", color: "var(--cc-bg)" }
          : { color: TEXT, boxShadow: `inset 0 0 0 1px ${BORDER}` };
        const content = (
          <>
            {Icon && <Icon size={15} />}
            {text}
            {count != null && count > 0 && (
              <span className="tabular-nums" style={{ color: on ? "var(--cc-bg)" : MUTED, opacity: on ? 0.75 : 1 }}>{count}</span>
            )}
          </>
        );
        return href ? (
          <Link key={key} href={href} title={title} aria-current={on ? "page" : undefined} className={className} style={style}>
            {content}
          </Link>
        ) : (
          <button key={key} type="button" title={title} aria-pressed={on} aria-current={on ? "page" : undefined} onClick={() => onChange?.(key)} className={className} style={style}>
            {content}
          </button>
        );
      })}
    </nav>
  );
}

export function SearchField({
  value,
  onChange,
  placeholder,
  label,
  className = "",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  label: string;
  className?: string;
}) {
  return (
    <div className={`relative w-full sm:max-w-sm ${className}`}>
      <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
      <input
        aria-label={label}
        type="search"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-full border bg-cc-surface pl-11 pr-4 text-sm outline-none transition focus:ring-2 focus:ring-cc-plum"
        style={{ borderColor: BORDER, color: TEXT }}
      />
    </div>
  );
}

/** A titled block of the page: heading, a line of context, then content. */
export function Section({
  title,
  description,
  action,
  children,
  className = "",
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`min-w-0 space-y-3 ${className}`} aria-label={title}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold" style={{ color: TEXT }}>{title}</h2>
          {description && <p className="mt-0.5 text-sm" style={{ color: MUTED }}>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** White, borderless panel. Put `divide-y` rows or padded content inside. */
export function Surface({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`overflow-hidden rounded-2xl bg-cc-surface ${className}`}>{children}</div>;
}

/** Rows in a Surface, split by hairlines. */
export function RowList({ children }: { children: ReactNode }) {
  return <ul className="divide-y" style={{ borderColor: BORDER }}>{children}</ul>;
}

/** Coloured status words, as the vault shows "6 gaps" or "Nothing missing". */
export function StatusText({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className="shrink-0 whitespace-nowrap text-xs font-semibold" style={{ color: tone === "neutral" ? MUTED : toneColor(tone) }}>
      {children}
    </span>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: {
  icon: LucideIcon;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl bg-cc-surface px-6 py-12 text-center">
      <Icon size={26} className="mx-auto mb-3" style={{ color: MUTED }} />
      <p className="text-base font-semibold" style={{ color: TEXT }}>{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-sm" style={{ color: MUTED }}>{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function LoadError({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-wrap items-center gap-3 rounded-2xl bg-cc-surface px-5 py-4 text-sm" style={{ color: TEXT }}>
      {children}
      {onRetry && (
        <button type="button" onClick={onRetry} className="min-h-10 rounded-full border px-4 font-semibold" style={{ borderColor: BORDER }}>
          Try again
        </button>
      )}
    </div>
  );
}

/** Soft note above content: warning or danger, no heavy border. */
export function Notice({
  tone,
  icon: Icon,
  title,
  children,
  action,
}: {
  tone: "warning" | "danger" | "info";
  icon: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  const bg = tone === "danger" ? "var(--cc-status-danger-bg)" : tone === "warning" ? "var(--cc-status-warning-bg)" : "var(--cc-status-info-bg)";
  return (
    <div className="flex flex-wrap items-start gap-3 rounded-2xl px-5 py-4" style={{ background: bg }}>
      <Icon size={18} className="mt-0.5 shrink-0" style={{ color: toneColor(tone) }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold" style={{ color: TEXT }}>{title}</p>
        {children && <p className="mt-0.5 text-sm leading-6" style={{ color: MUTED }}>{children}</p>}
      </div>
      {action}
    </div>
  );
}

export function SkeletonBlocks({ count = 3, height = "h-20" }: { count?: number; height?: string }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className={`${height} animate-pulse rounded-2xl bg-cc-surface`} />
      ))}
    </div>
  );
}
