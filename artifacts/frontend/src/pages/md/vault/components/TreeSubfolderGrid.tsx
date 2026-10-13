import { useLocation } from "wouter";
import { ChevronDown } from "lucide-react";
import { FolderCard, type FolderMenuItem, type FolderTone } from "./FileManager";
import type { VaultFolderState } from "@/services/vaultService";

const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
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
  /** Folder size, e.g. "2.4 MB" or "Measuring…". */
  size?: string;
  /** The folder's ⋮ menu. */
  menu?: FolderMenuItem[];
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
  const [, navigate] = useLocation();
  const gap = item.state === "missing" || item.state === "expired";
  const status = gap
    ? {
        label: item.missing && item.missing.length > 0
          ? `Not on file: ${item.missing.join(", ")}`
          : item.gapLabel ?? (item.state === "expired" ? "Expired" : "Missing"),
        tone: (item.state === "expired" ? "warning" : "danger") as FolderTone,
      }
    : muted
      ? { label: "Not required here", tone: "neutral" as FolderTone }
      : undefined;
  return (
    <FolderCard
      compact
      title={item.label}
      muted={muted || (!gap && item.count === 0)}
      meta={[`${item.count} ${item.count === 1 ? "file" : "files"}`, item.size]}
      status={status}
      onOpen={() => navigate(item.href)}
      menu={item.menu}
    />
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
          {shown.map((item) => <Tile key={item.key} item={item} />)}
        </div>
      )}
      {notRequired.length > 0 && (
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-semibold" style={{ color: MUTED }}>
            <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
            Not required here · {notRequired.length} {notRequired.length === 1 ? "folder" : "folders"}
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
            {notRequired.map((item) => <Tile key={item.key} item={item} muted />)}
          </div>
        </details>
      )}
    </div>
  );
}
