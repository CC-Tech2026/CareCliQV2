/**
 * Everything a folder's "⋮" menu can do, shared by every folder card in the
 * vault: share with an auditor, download as ZIP, copy a link or the path,
 * show the folder's details, and rename or delete a folder you created.
 *
 * Call the hook once per page, spread `menuFor(target)` into a FolderCard's
 * menu, and render `dialogs` once.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import {
  AlertTriangle,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  Info,
  Link2,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { buildVaultZip, triggerBlobDownload } from "@/lib/vaultZip";
import { deleteCustomFolder, renameCustomFolder } from "@/services/vaultService";
import type { SharedDoc } from "@/lib/vault-share";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ShareAuditorDialog } from "./ShareAuditorDialog";
import { FolderIcon, type FolderMenuItem } from "./FileManager";
import { Field, PanelFooter, PanelHeader, PrimaryButton, SecondaryButton, inputClass } from "./PanelKit";

export interface FolderTarget {
  title: string;
  /** In-app path, e.g. /md/vault/session_notes. */
  href: string;
  /** "Vault › Staff Folder › Amara Worker", for Copy path and Details. */
  path: string;
  /** How many files are in it, when known. */
  files?: number;
  /** Loads the folder's documents, for sharing and ZIP download. */
  loadDocuments?: () => Promise<SharedDoc[]>;
  folderKeys?: string[];
  /** Rows for the Details panel, e.g. ["Size", "2.4 MB"]. */
  details?: [string, ReactNode][];
  /** Set for a folder someone created, which can be renamed and deleted. */
  customFolderId?: string;
}

export interface MenuExtras {
  /** Folder-specific shortcuts shown after Open, e.g. "Show 3 flagged". */
  shortcuts?: FolderMenuItem[];
  /** Arrange items, e.g. "Move to start". */
  arrange?: FolderMenuItem[];
}

function absoluteUrl(href: string) {
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
  return `${window.location.origin}${base}${href}`;
}

/** Typed confirmation matches the folder name, ignoring case and extra spaces. */
export function confirmsName(typed: string, name: string) {
  const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
  return norm(typed).length > 0 && norm(typed) === norm(name);
}

export function useFolderActions({ onChanged }: { onChanged?: () => void } = {}) {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [share, setShare] = useState<FolderTarget | null>(null);
  const [details, setDetails] = useState<FolderTarget | null>(null);
  const [renaming, setRenaming] = useState<{ target: FolderTarget; name: string } | null>(null);
  const [deleting, setDeleting] = useState<FolderTarget | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setConfirmText("");
  }, [deleting]);

  async function copy(text: string, what: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${what} copied`, description: text });
    } catch {
      toast({ title: `Couldn't copy the ${what.toLowerCase()}`, description: text, variant: "destructive" });
    }
  }

  async function documentsOf(target: FolderTarget): Promise<SharedDoc[] | null> {
    if (!target.loadDocuments) return [];
    try {
      return await target.loadDocuments();
    } catch {
      toast({ title: `Couldn't load ${target.title}`, description: "Try again in a moment.", variant: "destructive" });
      return null;
    }
  }

  function openShare(target: FolderTarget) {
    setShare(target);
  }

  async function downloadZip(target: FolderTarget) {
    const documents = await documentsOf(target);
    if (!documents) return;
    if (documents.length === 0) {
      toast({ title: `${target.title} is empty`, description: "There's nothing to download yet." });
      return;
    }
    const progress = toast({ title: `Preparing ${target.title}`, description: `0 of ${documents.length} files` });
    try {
      const refs = documents.map((d) => ({ category: d.category, id: d.id, exclude_fields: d.exclude_fields }));
      const { blob, documentCount } = await buildVaultZip(refs, ({ done, total }) =>
        progress.update({ id: progress.id, title: `Preparing ${target.title}`, description: `${done} of ${total} files` }),
      );
      const safeName = target.title.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "folder";
      triggerBlobDownload(blob, `${safeName}-${new Date().toISOString().slice(0, 10)}.zip`);
      progress.update({ id: progress.id, title: `${target.title} downloaded`, description: `${documentCount} files in one ZIP` });
    } catch (err) {
      progress.update({
        id: progress.id,
        title: "Couldn't build the ZIP",
        description: err instanceof Error ? err.message : "Try again in a moment.",
        variant: "destructive",
      });
    }
  }

  async function confirmRename() {
    if (!renaming?.target.customFolderId || !renaming.name.trim()) return;
    setBusy(true);
    try {
      await renameCustomFolder(renaming.target.customFolderId, renaming.name.trim());
      toast({ title: "Folder renamed", description: renaming.name.trim() });
      setRenaming(null);
      onChanged?.();
    } catch (err) {
      toast({ title: "Couldn't rename the folder", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete() {
    if (!deleting?.customFolderId || !confirmsName(confirmText, deleting.title)) return;
    setBusy(true);
    try {
      const { removed_files } = await deleteCustomFolder(deleting.customFolderId);
      toast({
        title: `${deleting.title} deleted`,
        description: removed_files
          ? `${removed_files} ${removed_files === 1 ? "file was" : "files were"} removed from the vault with it.`
          : undefined,
      });
      setDeleting(null);
      onChanged?.();
    } catch (err) {
      toast({ title: "Couldn't delete the folder", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  /** The full ⋮ menu for a folder. */
  function menuFor(target: FolderTarget, extras: MenuExtras = {}): FolderMenuItem[] {
    const empty = target.files === 0;
    const items: FolderMenuItem[] = [
      { label: "Open", icon: FolderOpen, onSelect: () => navigate(target.href) },
      { label: "Open in new tab", icon: ExternalLink, onSelect: () => window.open(absoluteUrl(target.href), "_blank", "noopener") },
      ...(extras.shortcuts ?? []),
    ];
    if (target.loadDocuments) {
      items.push(
        { label: "Share with auditor", icon: Share2, onSelect: () => openShare(target), separatorBefore: true },
        { label: "Download as ZIP", icon: Download, onSelect: () => void downloadZip(target), disabled: empty },
      );
    }
    items.push(
      { label: "Copy link", icon: Link2, onSelect: () => void copy(absoluteUrl(target.href), "Link"), separatorBefore: !target.loadDocuments },
      { label: "Copy folder path", icon: Copy, onSelect: () => void copy(target.path, "Path") },
    );
    if (extras.arrange?.length) {
      items.push(...extras.arrange.map((item, index) => ({ ...item, separatorBefore: index === 0 })));
    }
    items.push({ label: "Details", icon: Info, onSelect: () => setDetails(target), separatorBefore: !extras.arrange?.length });
    if (target.customFolderId) {
      items.push(
        { label: "Rename", icon: Pencil, onSelect: () => setRenaming({ target, name: target.title }), separatorBefore: true },
        { label: "Delete folder", icon: Trash2, onSelect: () => setDeleting(target), destructive: true },
      );
    } else {
      // Shown, not hidden, so it's clear this is protected rather than missing.
      items.push({
        label: "Delete folder",
        icon: Trash2,
        onSelect: () => undefined,
        disabled: true,
        separatorBefore: true,
        hint: "Built-in folders hold care records and can't be deleted.",
      });
    }
    return items;
  }

  const borderStyle = { borderColor: "var(--cc-border)", color: "var(--cc-text)" };

  const dialogs = (
    <>
      <ShareAuditorDialog
        open={share !== null}
        onOpenChange={(open) => { if (!open) setShare(null); }}
        folderKeys={share?.folderKeys ?? []}
        targetDescription={share ? share.path : ""}
        preselect={
          share?.loadDocuments
            ? [{
                // A flat folder's key matches the vault folder list, so it isn't listed twice.
                key: share.folderKeys?.[0] ?? share.href,
                label: share.title,
                count: share.files ?? 0,
                load: share.loadDocuments,
              }]
            : []
        }
      />

      {/* Details: the folder's "Get info" panel */}
      <Sheet open={details !== null} onOpenChange={(open) => { if (!open) setDetails(null); }}>
        <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-md">
          {details && (
            <>
              <SheetTitle className="sr-only">{details.title}</SheetTitle>
              <SheetDescription className="sr-only">{details.path}</SheetDescription>
              <div className="flex flex-col items-center rounded-3xl px-6 py-8 text-center" style={{ background: "var(--cc-brand-purple-soft)" }}>
                <FolderIcon size={88} />
                <h2 className="mt-4 text-xl font-semibold tracking-tight" style={{ color: "var(--cc-text)", fontFamily: "var(--app-font-display)" }}>
                  {details.title}
                </h2>
                <p className="mt-1 text-sm" style={{ color: "var(--cc-muted)" }}>{details.path}</p>
                {details.files !== undefined && (
                  <p className="mt-3 rounded-full px-3 py-1 text-xs font-semibold" style={{ background: "var(--cc-surface)", color: "var(--cc-brand-purple)" }}>
                    {details.files} {details.files === 1 ? "file" : "files"}
                  </p>
                )}
              </div>

              <dl className="mt-6 flex-1">
                {[
                  ...(details.details ?? []),
                  ["Type", details.customFolderId ? "Folder you created" : "Built-in folder"] as [string, ReactNode],
                ].map(([label, value]) => (
                  <div key={label} className="flex items-baseline justify-between gap-4 border-b py-3 last:border-b-0" style={{ borderColor: "var(--cc-border)" }}>
                    <dt className="text-sm" style={{ color: "var(--cc-muted)" }}>{label}</dt>
                    <dd className="text-right text-sm font-medium" style={{ color: "var(--cc-text)" }}>{value}</dd>
                  </div>
                ))}
              </dl>

              <PanelFooter>
                <SecondaryButton onClick={() => void copy(absoluteUrl(details.href), "Link")}>
                  <Link2 size={15} /> Copy link
                </SecondaryButton>
                {details.loadDocuments && (
                  <SecondaryButton onClick={() => { const target = details; setDetails(null); openShare(target); }}>
                    <Share2 size={15} /> Share
                  </SecondaryButton>
                )}
                <PrimaryButton onClick={() => { setDetails(null); navigate(details.href); }}>
                  <FolderOpen size={16} /> Open folder
                </PrimaryButton>
              </PanelFooter>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* Rename */}
      <Dialog open={renaming !== null} onOpenChange={(open) => { if (!open && !busy) setRenaming(null); }}>
        <DialogContent className="max-w-md rounded-3xl p-6">
          <DialogTitle className="sr-only">Rename folder</DialogTitle>
          <DialogDescription className="sr-only">Give {renaming?.target.title} a new name.</DialogDescription>
          <PanelHeader icon={Pencil} title="Rename folder" description={renaming?.target.path} />
          <form onSubmit={(e) => { e.preventDefault(); void confirmRename(); }} className="mt-5 space-y-5">
            <Field label="Folder name" htmlFor="rename-folder">
              <input
                id="rename-folder"
                autoFocus
                value={renaming?.name ?? ""}
                onChange={(e) => setRenaming((r) => (r ? { ...r, name: e.target.value } : r))}
                className={inputClass}
                style={borderStyle}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <SecondaryButton onClick={() => setRenaming(null)} disabled={busy}>Cancel</SecondaryButton>
              <PrimaryButton
                type="submit"
                busy={busy}
                disabled={!renaming?.name.trim() || renaming.name.trim() === renaming.target.title}
              >
                Save name
              </PrimaryButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete: type the folder name to confirm */}
      <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open && !busy) setDeleting(null); }}>
        <DialogContent className="max-w-md rounded-3xl p-6">
          <DialogTitle className="sr-only">Delete folder</DialogTitle>
          <DialogDescription className="sr-only">Confirm deleting {deleting?.title}.</DialogDescription>
          <PanelHeader icon={Trash2} tone="danger" title="Delete this folder?" description={deleting?.path} />
          <div className="mt-5 space-y-3 rounded-2xl border p-4 text-sm leading-6" style={{ borderColor: "var(--cc-border)" }}>
            <p className="flex items-start gap-2" style={{ color: "var(--cc-text)" }}>
              <AlertTriangle size={16} className="mt-1 shrink-0" style={{ color: "var(--cc-danger-text)" }} />
              <span>
                {deleting?.files
                  ? <>The folder and its <strong>{deleting.files} {deleting.files === 1 ? "file" : "files"}</strong> will be removed from the vault for everyone.</>
                  : "The folder will be removed from the vault for everyone."}
              </span>
            </p>
            <p style={{ color: "var(--cc-muted)" }}>
              Nothing is erased. CareCliQ support can restore it if it was deleted by mistake.
            </p>
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void confirmDelete(); }} className="mt-5 space-y-5">
            <Field
              label="Type the folder name to confirm"
              htmlFor="delete-confirm"
              hint={<>Enter <strong style={{ color: "var(--cc-text)" }}>{deleting?.title}</strong></>}
            >
              <input
                id="delete-confirm"
                autoFocus
                autoComplete="off"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder={deleting?.title}
                className={inputClass}
                style={borderStyle}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <SecondaryButton onClick={() => setDeleting(null)} disabled={busy}>Keep folder</SecondaryButton>
              <PrimaryButton
                type="submit"
                tone="danger"
                busy={busy}
                disabled={!deleting || !confirmsName(confirmText, deleting.title)}
              >
                <Trash2 size={15} /> Delete folder
              </PrimaryButton>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );

  return { menuFor, dialogs };
}
