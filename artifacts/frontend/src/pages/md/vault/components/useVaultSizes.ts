import { useEffect, useState } from "react";
import { fetchVaultSizes, type VaultSizeTally, type VaultSizes } from "@/services/vaultService";

const POLL_MS = 4000;
/** Stop asking after ~5 minutes; whatever's measured by then is shown. */
const MAX_POLLS = 75;

/**
 * Folder sizes for the vault. Documents are measured in the background the
 * first time they're seen, so while any are pending this re-asks every few
 * seconds and the sizes fill in.
 */
export function useVaultSizes(): VaultSizes | null {
  const [sizes, setSizes] = useState<VaultSizes | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let polls = 0;

    const load = () => {
      fetchVaultSizes()
        .then((next) => {
          if (cancelled) return;
          setSizes(next);
          polls += 1;
          if (next.pending > 0 && polls < MAX_POLLS) timer = window.setTimeout(load, POLL_MS);
        })
        .catch(() => {
          // Sizes are a nicety: the vault works without them.
        });
    };
    load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return sizes;
}

/** "856 KB", "24.3 MB", "1.12 GB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1).replace(/\.0$/, "")} MB`;
  return `${(mb / 1024).toFixed(2).replace(/\.?0+$/, "")} GB`;
}

/** Details-panel rows for a folder's size, and any files that can't be opened. */
export function sizeDetails(
  tally: VaultSizeTally | undefined,
  sizesLoaded: boolean,
  files: number,
): [string, string][] {
  const rows: [string, string][] = [
    ["Size", sizeLabel(tally, sizesLoaded) ?? (!sizesLoaded || !files ? (files ? "Not measured yet" : "Empty") : "Unknown")],
  ];
  if (tally?.unavailable) {
    rows.push(["Files that won't open", `${tally.unavailable} (stored file missing)`]);
  }
  return rows;
}

/**
 * The size line for a folder: the total once every document in it is
 * measured, "Measuring…" until then, nothing for an empty folder or before
 * sizes have loaded.
 */
export function sizeLabel(tally: VaultSizeTally | undefined, sizesLoaded: boolean): string | undefined {
  if (!sizesLoaded) return undefined;
  if (!tally || tally.files === 0) return undefined;
  if (tally.pending > 0) return "Measuring…";
  // Files listed but none could be opened: a size of "0 B" would mislead.
  if (tally.bytes === 0) return undefined;
  return formatBytes(tally.bytes);
}
