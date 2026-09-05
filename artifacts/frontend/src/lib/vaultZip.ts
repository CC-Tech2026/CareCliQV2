import JSZip from "jszip";
import { fetchDocumentFile, planPack, type DocRef } from "@/services/vaultService";

export interface VaultZipProgress {
  done: number;
  total: number;
}

/** Builds a ZIP of the selected vault documents entirely client-side, with
 * real per-file progress (not a fake timer) — mirrors the same (done,total)
 * callback shape pdf-export.ts's exportBulkSessionsPDF already uses. Each
 * file's real bytes are fetched one at a time from the vault API before
 * being added to the archive, so the progress bar reflects actual network
 * activity rather than a simulated interval. */
export async function buildVaultZip(
  refs: DocRef[],
  onProgress?: (progress: VaultZipProgress) => void
): Promise<{ blob: Blob; documentCount: number }> {
  const plan = await planPack(refs);
  const zip = new JSZip();
  const usedNames = new Set<string>();

  for (let i = 0; i < plan.length; i++) {
    const item = plan[i];
    const { filename, blob } = await fetchDocumentFile(item.category, item.id);
    zip.file(dedupeFilename(filename, usedNames), blob);
    onProgress?.({ done: i + 1, total: plan.length });
  }

  const zipBlob = await zip.generateAsync({ type: "blob" });
  return { blob: zipBlob, documentCount: plan.length };
}

function dedupeFilename(name: string, used: Set<string>): string {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  let n = 2;
  let candidate = `${base} (${n})${ext}`;
  while (used.has(candidate)) {
    n += 1;
    candidate = `${base} (${n})${ext}`;
  }
  used.add(candidate);
  return candidate;
}

/** Same manual createObjectURL + <a>.click() pattern audit-pack.tsx's
 * handleExport already uses — no need for a file-saver dependency. */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
