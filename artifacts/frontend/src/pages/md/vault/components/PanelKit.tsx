/**
 * Shared pieces for the vault's side panels and dialogs, so sharing,
 * uploading, creating and managing folders all look and behave alike:
 * a header with a purple icon, labelled fields, choice cards, a drop zone
 * and a footer that stays in view.
 */
import { useRef, useState, type ReactNode } from "react";
import { Check, FileUp, Loader2, type LucideIcon } from "lucide-react";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const PURPLE = "var(--cc-brand-purple)";
const PURPLE_SOFT = "var(--cc-brand-purple-soft)";

export function PanelHeader({
  icon: Icon,
  title,
  description,
  tone = "brand",
}: {
  icon: LucideIcon;
  title: string;
  description?: ReactNode;
  tone?: "brand" | "danger";
}) {
  const danger = tone === "danger";
  return (
    <div className="flex items-start gap-4 pr-8">
      <span
        className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl"
        style={{
          background: danger ? "var(--cc-status-danger-bg)" : PURPLE_SOFT,
          color: danger ? "var(--cc-danger-text)" : PURPLE,
        }}
        aria-hidden="true"
      >
        <Icon size={22} />
      </span>
      <div className="min-w-0">
        <h2 className="text-xl font-semibold tracking-tight" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>
          {title}
        </h2>
        {description && (
          <div className="mt-1 text-sm leading-6" style={{ color: MUTED }}>
            {description}
          </div>
        )}
      </div>
    </div>
  );
}

export function Field({
  label,
  hint,
  htmlFor,
  optional,
  children,
}: {
  label: string;
  hint?: ReactNode;
  htmlFor?: string;
  optional?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="flex items-baseline gap-2 text-sm font-medium" style={{ color: TEXT }}>
        {label}
        {optional && <span className="text-xs font-normal" style={{ color: MUTED }}>Optional</span>}
      </label>
      {children}
      {hint && <p className="text-xs leading-5" style={{ color: MUTED }}>{hint}</p>}
    </div>
  );
}

/** Text input styled for the panels. */
export const inputClass =
  "h-11 w-full rounded-xl border bg-cc-surface px-4 text-sm outline-none transition placeholder:text-cc-muted focus:border-[color:var(--cc-brand-purple)] focus:ring-4 focus:ring-[color:var(--cc-brand-purple-soft)]";
export const textareaClass =
  "w-full rounded-xl border bg-cc-surface px-4 py-3 text-sm leading-6 outline-none transition placeholder:text-cc-muted focus:border-[color:var(--cc-brand-purple)] focus:ring-4 focus:ring-[color:var(--cc-brand-purple-soft)]";

/** A selectable card: one choice among a few, with a tick when chosen. */
export function ChoiceCard({
  selected,
  onSelect,
  icon: Icon,
  title,
  description,
  badge,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  icon?: LucideIcon;
  title: string;
  description?: string;
  badge?: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className="relative flex w-full items-start gap-3 rounded-2xl border p-4 text-left transition hover:bg-cc-soft disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:bg-transparent focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum"
      style={{
        borderColor: selected ? PURPLE : BORDER,
        background: selected ? PURPLE_SOFT : undefined,
        boxShadow: selected ? `0 0 0 1px ${PURPLE}` : undefined,
      }}
    >
      {Icon && (
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
          style={{ background: selected ? PURPLE : "var(--cc-soft)", color: selected ? "#fff" : TEXT }}
          aria-hidden="true"
        >
          <Icon size={17} />
        </span>
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-semibold" style={{ color: TEXT }}>
          {title}
          {badge && (
            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: "var(--cc-soft)", color: MUTED }}>
              {badge}
            </span>
          )}
        </span>
        {description && <span className="mt-0.5 block text-xs leading-5" style={{ color: MUTED }}>{description}</span>}
      </span>
      <span
        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border"
        style={{ borderColor: selected ? PURPLE : BORDER, background: selected ? PURPLE : "transparent" }}
        aria-hidden="true"
      >
        {selected && <Check size={12} color="#fff" strokeWidth={3} />}
      </span>
    </button>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  busy,
  type = "button",
  tone = "brand",
  className = "",
  form,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  type?: "button" | "submit";
  /** Submits this form when the button sits outside it (e.g. in a panel footer). */
  form?: string;
  tone?: "brand" | "danger";
  className?: string;
}) {
  return (
    <button
      type={type}
      form={form}
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum ${className}`}
      style={{ background: tone === "danger" ? "var(--cc-danger-text)" : "var(--cc-cta)" }}
    >
      {busy && <Loader2 size={15} className="animate-spin" />}
      {children}
    </button>
  );
}

export function SecondaryButton({
  children,
  onClick,
  disabled,
  className = "",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-full border px-5 text-sm font-medium transition hover:bg-cc-soft disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum ${className}`}
      style={{ borderColor: BORDER, color: TEXT }}
    >
      {children}
    </button>
  );
}

/** Footer for a side panel: stays at the bottom while the body scrolls. */
export function PanelFooter({ children }: { children: ReactNode }) {
  return (
    <div
      className="sticky bottom-0 -mx-6 mt-6 flex flex-wrap items-center justify-end gap-2 border-t bg-cc-surface px-6 py-4"
      style={{ borderColor: BORDER }}
    >
      {children}
    </div>
  );
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Drag a file in, or click to choose one. */
export function DropZone({
  file,
  onFile,
  accept,
  hint,
}: {
  file: File | null;
  onFile: (file: File | null) => void;
  accept: string;
  hint: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const dropped = e.dataTransfer.files?.[0];
        if (dropped) onFile(dropped);
      }}
      className="rounded-2xl border-2 border-dashed p-5 text-center transition"
      style={{
        borderColor: dragging || file ? PURPLE : BORDER,
        background: dragging ? PURPLE_SOFT : file ? PURPLE_SOFT : "transparent",
      }}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => onFile(e.target.files?.[0] ?? null)}
      />
      <span
        className="mx-auto flex h-11 w-11 items-center justify-center rounded-2xl"
        style={{ background: file ? PURPLE : "var(--cc-soft)", color: file ? "#fff" : TEXT }}
        aria-hidden="true"
      >
        <FileUp size={20} />
      </span>
      {file ? (
        <>
          <p className="mt-3 truncate text-sm font-semibold" style={{ color: TEXT }}>{file.name}</p>
          <p className="mt-0.5 text-xs" style={{ color: MUTED }}>{formatFileSize(file.size)}</p>
          <button type="button" onClick={() => input.current?.click()} className="mt-3 text-sm font-semibold underline-offset-4 hover:underline" style={{ color: PURPLE }}>
            Choose a different file
          </button>
        </>
      ) : (
        <>
          <p className="mt-3 text-sm font-semibold" style={{ color: TEXT }}>
            Drag a file here, or{" "}
            <button type="button" onClick={() => input.current?.click()} className="underline-offset-4 hover:underline" style={{ color: PURPLE }}>
              browse
            </button>
          </p>
          <p className="mt-1 text-xs" style={{ color: MUTED }}>{hint}</p>
        </>
      )}
    </div>
  );
}
