/**
 * File-manager building blocks for the Documents & Audit Vault: a folder
 * glyph, a folder card with a "⋮" menu, and a hover/focus preview that lists
 * what's inside (subfolders, or the latest files) as a small tree.
 */
import { Fragment, useRef, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  FileImage,
  FileSpreadsheet,
  FileText,
  MoreVertical,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
/** Folder colour: the brand purple, with a lighter front panel. Solid fills only. */
const FOLDER = "var(--cc-brand-purple)";
const FOLDER_FRONT = "color-mix(in srgb, var(--cc-brand-purple) 74%, white)";
const FOLDER_MUTED = "color-mix(in srgb, var(--cc-muted) 45%, var(--cc-surface))";

export type FolderTone = "good" | "warning" | "danger" | "neutral";

export function toneColor(tone: FolderTone | undefined) {
  if (tone === "danger") return "var(--cc-danger-text)";
  if (tone === "warning") return "var(--cc-amber)";
  if (tone === "good") return "var(--cc-green)";
  return MUTED;
}

/** A plain two-tone folder: tabbed back panel, lighter front panel. */
export function FolderIcon({
  size = 64,
  Icon,
  muted = false,
}: {
  size?: number;
  Icon?: LucideIcon;
  muted?: boolean;
}) {
  const back = muted ? FOLDER_MUTED : FOLDER;
  const front = muted ? "color-mix(in srgb, var(--cc-muted) 30%, var(--cc-surface))" : FOLDER_FRONT;
  const height = Math.round(size * 0.8);
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height }} aria-hidden="true">
      <svg viewBox="0 0 64 51" width={size} height={height}>
        <path d="M2 7a5 5 0 0 1 5-5h15.5a5 5 0 0 1 3.6 1.5L30 7.5h27a5 5 0 0 1 5 5V44a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5Z" fill={back} />
        <rect x="2" y="14" width="60" height="35" rx="5" fill={front} />
      </svg>
      {Icon && (
        <span className="absolute inset-x-0 flex justify-center" style={{ top: height * 0.42 }}>
          <Icon size={Math.round(size * 0.26)} color="white" strokeWidth={2.25} />
        </span>
      )}
    </span>
  );
}

/** Small square folder mark used inside lists and previews. */
export function FolderMark({ muted = false }: { muted?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]"
      style={{ background: muted ? FOLDER_MUTED : FOLDER }}
    >
      <svg viewBox="0 0 12 10" width="10" height="8">
        <path d="M0.5 1.5a1 1 0 0 1 1-1h3l1 1.2h4.5a1 1 0 0 1 1 1V8.5a1 1 0 0 1-1 1h-8.5a1 1 0 0 1-1-1Z" fill="white" />
      </svg>
    </span>
  );
}

/** File glyph by the document's file type, guessed from its title. */
export function FileMark({ title }: { title: string }) {
  const lower = title.toLowerCase();
  const Icon = /\.(png|jpe?g|gif|webp|heic)$/.test(lower)
    ? FileImage
    : /\.(xlsx?|csv)$/.test(lower)
      ? FileSpreadsheet
      : FileText;
  return (
    <span
      aria-hidden="true"
      className="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px]"
      style={{ background: "var(--cc-soft)", color: TEXT }}
    >
      <Icon size={11} />
    </span>
  );
}

// ── Preview ──────────────────────────────────────────────────────────────

export interface PreviewNode {
  label: string;
  /** Optional second line, e.g. the document title under the person's name. */
  sublabel?: string;
  kind: "folder" | "file";
  /** Right-hand detail, e.g. "12" or "Missing". */
  meta?: string;
  tone?: FolderTone;
  href?: string;
  muted?: boolean;
  children?: PreviewNode[];
}

export interface PreviewContent {
  nodes: PreviewNode[];
  /** How many more items exist beyond those listed. */
  more?: number;
  moreNoun?: string;
  empty?: string;
}

function PreviewRow({ node, nested }: { node: PreviewNode; nested?: boolean }) {
  const row = (
    <span
      className={`flex min-w-0 items-center gap-2 rounded-md px-1.5 py-1 ${node.href ? "hover:bg-cc-soft" : ""}`}
    >
      {node.kind === "folder" ? <FolderMark muted={node.muted} /> : <FileMark title={node.label} />}
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate ${nested ? "text-xs" : "text-[13px] font-medium"}`}
          style={{ color: node.muted ? MUTED : TEXT }}
        >
          {node.label}
        </span>
        {node.sublabel && (
          <span className="block truncate text-xs" style={{ color: MUTED }}>{node.sublabel}</span>
        )}
      </span>
      {node.meta && (
        <span className="shrink-0 text-xs tabular-nums" style={{ color: toneColor(node.tone), fontWeight: node.tone && node.tone !== "neutral" ? 600 : 400 }}>
          {node.meta}
        </span>
      )}
    </span>
  );
  return (
    <li className={nested ? "relative before:absolute before:-left-3 before:top-1/2 before:w-2.5 before:border-t before:border-cc-border" : ""}>
      {node.href ? (
        <Link href={node.href} className="block focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum rounded-md">
          {row}
        </Link>
      ) : (
        row
      )}
      {node.children && node.children.length > 0 && (
        <ul className="ml-[15px] border-l border-cc-border pl-3">
          {node.children.map((child, index) => (
            <PreviewRow key={`${child.label}-${index}`} node={child} nested />
          ))}
        </ul>
      )}
    </li>
  );
}

function PreviewPanel({ content, loading }: { content?: PreviewContent | null; loading?: boolean }) {
  return (
    <div
      className="w-full rounded-2xl border bg-cc-surface p-2.5"
      style={{ borderColor: BORDER }}
    >
      {loading || !content ? (
        <div className="space-y-2 p-1.5" aria-label="Loading folder contents">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-4 animate-pulse rounded-full" style={{ background: "var(--cc-soft)", width: `${80 - i * 15}%` }} />
          ))}
        </div>
      ) : content.nodes.length === 0 ? (
        <p className="px-1.5 py-1 text-xs" style={{ color: MUTED }}>{content.empty ?? "This folder is empty."}</p>
      ) : (
        <>
          <ul className="space-y-0.5">
            {content.nodes.map((node, index) => (
              <PreviewRow key={`${node.label}-${index}`} node={node} />
            ))}
          </ul>
          {!!content.more && content.more > 0 && (
            <p className="px-1.5 pt-1.5 text-xs" style={{ color: MUTED }}>
              …and {content.more} more {content.moreNoun ?? (content.more === 1 ? "item" : "items")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────

export interface FolderMenuItem {
  label: string;
  onSelect: () => void;
  icon?: LucideIcon;
  /** Draw a divider above this item, to group related actions. */
  separatorBefore?: boolean;
  /** Destructive actions (delete) are shown in red. */
  destructive?: boolean;
  disabled?: boolean;
  /** A short reason under the label, e.g. why an action isn't available. */
  hint?: string;
}

export interface FolderCardProps {
  title: string;
  /** Left and right meta, like "18 files" and "1.12 GB" in a desktop file manager. */
  meta: [string, string?];
  status?: { label: string; tone: FolderTone };
  Icon?: LucideIcon;
  muted?: boolean;
  onOpen: () => void;
  menu?: FolderMenuItem[];
  /** Static preview content, or a loader called the first time it's needed. */
  preview?: PreviewContent;
  loadPreview?: () => void;
  previewLoading?: boolean;
  /** Small badge on the folder glyph, e.g. flagged documents. */
  badge?: number;
  /** Spread onto the card for drag-to-reorder (dnd-kit attributes + listeners). */
  dragProps?: Record<string, unknown>;
  compact?: boolean;
}

/**
 * One folder. The card opens the folder; the ⋮ menu holds folder actions;
 * hovering (or tabbing to) the card shows what's inside underneath it, the
 * way a desktop file manager previews a folder.
 */
export function FolderCard({
  title,
  meta,
  status,
  Icon,
  muted,
  onOpen,
  menu,
  preview,
  loadPreview,
  previewLoading,
  badge,
  dragProps,
  compact = false,
}: FolderCardProps) {
  const timer = useRef<number | null>(null);
  const [requested, setRequested] = useState(false);
  const hasPreview = !!preview || !!loadPreview;

  // Wait a moment before loading, so sweeping the cursor across the grid
  // doesn't fire a request for every folder it passes.
  function armPreview() {
    if (!loadPreview || requested) return;
    timer.current = window.setTimeout(() => {
      setRequested(true);
      loadPreview();
    }, 300);
  }
  function disarmPreview() {
    if (timer.current) window.clearTimeout(timer.current);
  }

  return (
    <div
      className="group relative"
      onMouseEnter={armPreview}
      onMouseLeave={disarmPreview}
      onFocus={armPreview}
    >
      <div
        className="relative flex h-full flex-col rounded-2xl border border-transparent bg-cc-surface transition-colors hover:border-[color:var(--cc-brand-purple)] focus-within:border-[color:var(--cc-brand-purple)]"
        style={{ opacity: muted ? 0.7 : 1 }}
      >
        <button
          type="button"
          onClick={onOpen}
          className={`flex h-full w-full flex-col items-start text-left focus-visible:outline-none ${compact ? "p-3.5" : "p-4 sm:p-5"}`}
          aria-label={`Open ${title}`}
          {...dragProps}
        >
          <span className="relative">
            <FolderIcon size={compact ? 48 : 64} Icon={Icon} muted={muted} />
            {!!badge && badge > 0 && (
              <span
                className="absolute -right-2 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] font-semibold"
                style={{ background: "var(--cc-amber)", color: "var(--cc-surface)" }}
                title={`${badge} flagged for review`}
              >
                {badge}
              </span>
            )}
          </span>
          <span
            className={`mt-3 line-clamp-2 w-full pr-4 font-semibold leading-snug ${compact ? "text-sm" : "text-[15px]"}`}
            style={{ color: TEXT }}
          >
            {title}
          </span>
          <span className="mt-auto flex w-full items-baseline justify-between gap-2 pt-2 text-xs tabular-nums" style={{ color: MUTED }}>
            <span className="truncate">{meta[0]}</span>
            {meta[1] && <span className="shrink-0">{meta[1]}</span>}
          </span>
          {status && (
            <span className="mt-1.5 line-clamp-2 text-xs font-semibold" style={{ color: toneColor(status.tone) }}>
              {status.label}
            </span>
          )}
        </button>

        {menu && menu.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label={`More actions for ${title}`}
                className="absolute right-2 top-2 flex h-9 w-9 items-center justify-center rounded-full transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum"
                style={{ color: MUTED }}
              >
                <MoreVertical size={17} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52 shadow-none">
              {menu.map((item, index) => (
                <Fragment key={item.label}>
                  {item.separatorBefore && index > 0 && <DropdownMenuSeparator />}
                  <DropdownMenuItem
                    onSelect={item.onSelect}
                    disabled={item.disabled}
                    className="min-h-9 items-start gap-2.5"
                    style={item.destructive ? { color: "var(--cc-danger-text)" } : undefined}
                  >
                    {item.icon && <item.icon size={15} className="mt-0.5 shrink-0" />}
                    <span className="min-w-0">
                      <span className="block">{item.label}</span>
                      {item.hint && (
                        <span className="block max-w-56 text-xs leading-4" style={{ color: MUTED }}>{item.hint}</span>
                      )}
                    </span>
                  </DropdownMenuItem>
                </Fragment>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {/* Preview: pointer devices on hover, keyboard users on focus; as wide
          as its card. Not on phones, where there's no hover and no room.
          The pt-2 bridge keeps the hover alive while moving onto the panel. */}
      {hasPreview && (
        <div className="invisible absolute inset-x-0 top-full z-30 hidden pt-2 opacity-0 sm:block transition-[opacity,visibility] delay-150 duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
          <PreviewPanel content={preview} loading={previewLoading || (!!loadPreview && !preview)} />
        </div>
      )}
    </div>
  );
}

/** A folder row for the details (list) view. */
export function FolderRow({
  title,
  Icon,
  muted,
  columns,
  status,
  onOpen,
  dragProps,
  badge,
}: {
  title: string;
  Icon?: LucideIcon;
  muted?: boolean;
  columns: ReactNode[];
  status?: { label: string; tone: FolderTone };
  onOpen: () => void;
  dragProps?: Record<string, unknown>;
  badge?: number;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cc-plum sm:px-5"
      {...dragProps}
    >
      <span className="relative">
        <FolderIcon size={34} Icon={Icon} muted={muted} />
        {!!badge && badge > 0 && (
          <span
            className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-semibold"
            style={{ background: "var(--cc-amber)", color: "var(--cc-surface)" }}
          >
            {badge}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold" style={{ color: muted ? MUTED : TEXT }}>{title}</span>
        {status && (
          <span className="block text-xs font-semibold" style={{ color: toneColor(status.tone) }}>{status.label}</span>
        )}
      </span>
      {columns.map((column, index) => (
        <span key={index} className="hidden w-28 shrink-0 text-right text-xs tabular-nums sm:block" style={{ color: MUTED }}>
          {column}
        </span>
      ))}
    </button>
  );
}
