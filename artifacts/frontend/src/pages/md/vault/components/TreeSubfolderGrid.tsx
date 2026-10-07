import { Link } from "wouter";
import { ChevronDown, Folder } from "lucide-react";
import type { VaultFolderState } from "@/services/vaultService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";
const DANGER = "var(--cc-status-danger)";
const DANGER_BG = "var(--cc-status-danger-bg)";
const WARNING_TEXT = "#9A5B0A";
const WARNING_BG = "var(--cc-status-warning-bg)";

export interface TreeGridItem {
  key: string;
  label: string;
  count: number;
  state: VaultFolderState;
  href: string;
  /** Overrides the pill text, e.g. "3 missing" across everyone. */
  gapLabel?: string;
  /** The required credentials missing or lapsed. */
  missing?: string[];
}

export function StatePill({ state, label }: { state: VaultFolderState; label?: string }) {
  if (state !== "missing" && state !== "expired") return null;
  const expired = state === "expired";
  return (
    <span
      className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold"
      style={{ background: expired ? WARNING_BG : DANGER_BG, color: expired ? WARNING_TEXT : DANGER }}
    >
      {label ?? (expired ? "Expired" : "Missing")}
    </span>
  );
}

function Tile({ item, muted }: { item: TreeGridItem; muted?: boolean }) {
  const gap = item.state === "missing" || item.state === "expired";
  return (
    <Link
      href={item.href}
      className="flex flex-col gap-1.5 rounded-2xl border p-4 transition-colors hover:bg-black/5"
      style={{ borderColor: gap ? DANGER : BORDER, background: SURFACE, opacity: muted ? 0.6 : 1 }}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-3">
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
            style={muted ? { background: "var(--cc-border)", color: MUTED } : { background: "var(--cc-plum-soft)", color: PLUM }}
          >
            <Folder size={16} />
          </span>
          <span className="truncate text-[13px] font-bold" style={{ color: TEXT }}>{item.label}</span>
        </span>
        {gap ? (
          <StatePill state={item.state} label={item.gapLabel} />
        ) : (
          !muted && <span className="shrink-0 text-[12px] font-semibold" style={{ color: MUTED }}>{item.count}</span>
        )}
      </span>
      {item.missing && item.missing.length > 0 && (
        <span className="pl-12 text-[12px]" style={{ color: MUTED }}>
          Not on file: {item.missing.join(", ")}
        </span>
      )}
    </Link>
  );
}

/** Every subfolder, with gaps outlined. Folders not required here are
 * greyed and tucked under a toggle so they don't read as missing. */
export function TreeSubfolderGrid({ items }: { items: TreeGridItem[] }) {
  const shown = items.filter((i) => i.state !== "not_applicable");
  const notRequired = items.filter((i) => i.state === "not_applicable");
  return (
    <div className="space-y-3">
      {shown.length > 0 && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((item) => <Tile key={item.key} item={item} />)}
        </div>
      )}
      {notRequired.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-semibold" style={{ color: MUTED }}>
            <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
            Not required here · {notRequired.length} {notRequired.length === 1 ? "folder" : "folders"}
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {notRequired.map((item) => <Tile key={item.key} item={item} muted />)}
          </div>
        </details>
      )}
    </div>
  );
}
