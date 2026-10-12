import { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  EyeOff,
  FileText,
  FolderPlus,
  Loader2,
  Mail,
  Maximize2,
  Search,
  Settings2,
  Share2,
  X,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { buildVaultZip, triggerBlobDownload } from "@/lib/vaultZip";
import {
  PERIOD_PRESETS,
  buildCoverNote,
  buildRegisterCsv,
  inPeriod,
  resolvePeriod,
  type PeriodPreset,
  type SharedDoc,
} from "@/lib/vault-share";
import {
  fetchCustomizableFields,
  fetchDocumentFile,
  fetchFolderDocuments,
  fetchVaultFolders,
  logShareEvent,
  type DocRef,
} from "@/services/vaultService";
import { FolderMark } from "./FileManager";
import { Field, PrimaryButton, SecondaryButton, inputClass, textareaClass } from "./PanelKit";

/** Somewhere documents can be shared from: a folder, a person, a subfolder. */
export interface ShareSource {
  key: string;
  label: string;
  /** Files in it, when known. */
  count: number;
  load: () => Promise<SharedDoc[]>;
}

/** @deprecated name kept for existing callers. */
export type ShareFolderOption = ShareSource;

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const PURPLE = "var(--cc-brand-purple)";
const PURPLE_SOFT = "var(--cc-brand-purple-soft)";

const keyOf = (d: { category: string; id: string }) => `${d.category}:${d.id}`;

function plural(n: number, noun: string) {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function roleLabel(role: string): string {
  return role
    .split("_")
    .map((w) => w[0]?.toUpperCase() + w.slice(1))
    .join(" ");
}

function shortDate(iso?: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

/** A large, live preview of one document, with any hidden fields left out. */
function DocumentViewer({ doc, hidden }: { doc: SharedDoc; hidden: string[] }) {
  const [state, setState] = useState<{ url?: string; kind: "loading" | "pdf" | "image" | "other" | "missing" }>({ kind: "loading" });
  const frame = useRef<HTMLDivElement>(null);
  const hiddenKey = [...hidden].sort().join("|");

  useEffect(() => {
    let cancelled = false;
    let url: string | undefined;
    setState({ kind: "loading" });
    fetchDocumentFile(doc.category, doc.id, hidden)
      .then(({ blob }) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setState({
          url,
          kind: blob.type === "application/pdf" ? "pdf" : blob.type.startsWith("image/") ? "image" : "other",
        });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ kind: err instanceof Error && err.message === "not_found" ? "missing" : "other" });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.category, doc.id, hiddenKey]);

  return (
    <div ref={frame} className="relative h-full min-h-[50vh] overflow-hidden rounded-2xl border lg:min-h-0" style={{ borderColor: BORDER, background: "var(--cc-soft)" }}>
      {state.kind === "loading" ? (
        <div className="flex h-full items-center justify-center gap-2 text-sm" style={{ color: MUTED }}>
          <Loader2 size={16} className="animate-spin" /> Loading the document…
        </div>
      ) : state.kind === "pdf" && state.url ? (
        <iframe title={doc.title ?? "Document preview"} src={`${state.url}#view=FitH`} className="h-full w-full border-0 bg-white" />
      ) : state.kind === "image" && state.url ? (
        <img src={state.url} alt={doc.title ?? "Document"} className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
          <FileText size={28} style={{ color: MUTED }} />
          <p className="max-w-xs text-sm" style={{ color: MUTED }}>
            {state.kind === "missing"
              ? "This record's stored file is missing, so it can't be previewed or packed."
              : "There's no preview for this file type, but it will still go in the pack."}
          </p>
          {state.url && (
            <SecondaryButton onClick={() => window.open(state.url, "_blank", "noopener,noreferrer")}>Open in new tab</SecondaryButton>
          )}
        </div>
      )}
      {(state.kind === "pdf" || state.kind === "image") && (
        <button
          type="button"
          onClick={() => void frame.current?.requestFullscreen?.()}
          className="absolute right-3 top-3 inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-cc-surface px-3 text-xs font-semibold transition hover:bg-cc-soft"
          style={{ borderColor: BORDER, color: TEXT }}
        >
          <Maximize2 size={13} /> Full screen
        </button>
      )}
    </div>
  );
}

/**
 * Share vault documents with an auditor: one large window to choose the
 * documents (and add whole folders), read each one in a big preview, hide
 * fields across many files at once, and download the pack or email it.
 * Everything starts ticked, so the quickest share is open, then Download.
 */
export function ShareAuditorDialog({
  open,
  onOpenChange,
  targetDescription,
  documents = [],
  folderKeys = [],
  preselect = [],
  folderOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetDescription: string;
  /** Files already chosen; listed first and ticked. */
  documents?: SharedDoc[];
  folderKeys?: string[];
  /** Where this share started (a folder, a person): loaded and ticked. */
  preselect?: ShareSource[];
  /** Folders offered under "Add a folder". Defaults to every vault folder. */
  folderOptions?: ShareSource[];
}) {
  const { user } = useAuth();
  const { toast } = useToast();
  const preparedBy = `${user?.full_name || "CareCliQ"}${user?.role ? `, ${roleLabel(user.role)}` : ""}`;

  const [items, setItems] = useState<SharedDoc[]>([]);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [hidden, setHidden] = useState<Record<string, string[]>>({});
  const [focus, setFocus] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  // Mirrors `added` synchronously, so a source is never loaded twice even
  // when several are added in the same tick (e.g. on open).
  const addedRef = useRef<Set<string>>(new Set());
  const [loadingSources, setLoadingSources] = useState<Set<string>>(new Set());
  const [vaultFolders, setVaultFolders] = useState<ShareSource[] | null>(null);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [query, setQuery] = useState("");
  const [folderQuery, setFolderQuery] = useState("");
  const [preset, setPreset] = useState<PeriodPreset>("all");
  const [custom, setCustom] = useState<{ from?: string; to?: string }>({});
  const [withRegister, setWithRegister] = useState(true);
  const [withCover, setWithCover] = useState(true);
  const [groupByFolder, setGroupByFolder] = useState(true);
  const [coverNote, setCoverNote] = useState("");
  const [stage, setStage] = useState<"idle" | "generating" | "done">("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  function addDocs(docs: SharedDoc[], label?: string) {
    setItems((prev) => {
      const have = new Set(prev.map(keyOf));
      const fresh = docs.filter((d) => !have.has(keyOf(d))).map((d) => ({ ...d, folder_label: d.folder_label ?? label }));
      if (fresh.length) {
        setChecked((c) => new Set([...c, ...fresh.map(keyOf)]));
        setFocus((f) => f ?? keyOf(fresh[0]));
      }
      return [...prev, ...fresh];
    });
  }

  function addSource(source: ShareSource) {
    if (addedRef.current.has(source.key)) return;
    addedRef.current.add(source.key);
    setAdded(new Set(addedRef.current));
    setLoadingSources((l) => new Set(l).add(source.key));
    source
      .load()
      .then((docs) => addDocs(docs, source.label))
      .catch(() => toast({ title: `Couldn't load ${source.label}`, variant: "destructive" }))
      .finally(() =>
        setLoadingSources((l) => {
          const next = new Set(l);
          next.delete(source.key);
          return next;
        }),
      );
  }

  // Fresh start each time it opens: what was passed in, all ticked.
  const startKey = `${targetDescription}|${documents.map(keyOf).join(",")}|${preselect.map((s) => s.key).join(",")}`;
  useEffect(() => {
    if (!open) return;
    setItems(documents);
    setChecked(new Set(documents.map(keyOf)));
    setHidden(Object.fromEntries(documents.filter((d) => d.exclude_fields?.length).map((d) => [keyOf(d), d.exclude_fields!])));
    setFocus(documents[0] ? keyOf(documents[0]) : null);
    addedRef.current = new Set();
    setAdded(new Set());
    setLoadingSources(new Set());
    setQuery("");
    setPreset("all");
    setCustom({});
    setStage("idle");
    setSubject(`CareCliQ audit records: ${targetDescription}`);
    setMessage(`Hi,\n\nPlease find the requested CareCliQ audit records attached, covering ${targetDescription}.\n\nRegards,\n${preparedBy}`);
    for (const source of preselect) addSource(source);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, startKey]);

  useEffect(() => {
    if (!open) return;
    fetchCustomizableFields().then(setFields).catch(() => setFields({}));
    if (!folderOptions && !vaultFolders) {
      fetchVaultFolders()
        .then((folders) =>
          setVaultFolders(folders.map((f) => ({ key: f.category, label: f.label, count: f.count, load: () => fetchFolderDocuments(f.category) }))),
        )
        .catch(() => setVaultFolders([]));
    }
  }, [open, folderOptions, vaultFolders]);

  const period = resolvePeriod(preset, custom);
  const q = query.trim().toLowerCase();
  const visible = items.filter(
    (d) =>
      inPeriod(d, period) &&
      (!q || [d.title, d.person_name, d.doc_id, d.reference, d.folder_label].some((v) => v?.toLowerCase().includes(q))),
  );
  const included = visible.filter((d) => checked.has(keyOf(d)));
  const focused = items.find((d) => keyOf(d) === focus) ?? null;
  const focusedFields = focused ? fields[focused.category] ?? [] : [];
  const focusedHidden = focused ? hidden[keyOf(focused)] ?? [] : [];
  const loading = loadingSources.size > 0;

  const groups = useMemo(() => {
    const map = new Map<string, SharedDoc[]>();
    for (const d of visible) {
      const label = d.folder_label ?? d.category;
      map.set(label, [...(map.get(label) ?? []), d]);
    }
    return [...map];
  }, [visible]);

  const addable = (folderOptions ?? vaultFolders ?? []).filter(
    (s) => !added.has(s.key) && s.count > 0 && (!folderQuery.trim() || s.label.toLowerCase().includes(folderQuery.trim().toLowerCase())),
  );

  function toggle(key: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setStage("idle");
  }

  function setAll(on: boolean) {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const d of visible) {
        if (on) next.add(keyOf(d));
        else next.delete(keyOf(d));
      }
      return next;
    });
  }

  function toggleField(field: string) {
    if (!focused) return;
    const key = keyOf(focused);
    setHidden((prev) => {
      const current = new Set(prev[key] ?? []);
      if (current.has(field)) current.delete(field);
      else current.add(field);
      return { ...prev, [key]: [...current] };
    });
  }

  /** Copy this document's hidden fields to every ticked document of the same kind. */
  const sameKind = focused ? included.filter((d) => d.category === focused.category) : [];
  function applyHiddenToAll() {
    if (!focused) return;
    setHidden((prev) => {
      const next = { ...prev };
      for (const d of sameKind) next[keyOf(d)] = [...focusedHidden];
      return next;
    });
    toast({ title: `Applied to ${plural(sameKind.length, "document")}`, description: focusedHidden.length ? `Hidden: ${focusedHidden.join(", ")}` : "Nothing hidden" });
  }

  const order = included.length ? included : visible;
  const position = focused ? order.findIndex((d) => keyOf(d) === keyOf(focused)) : -1;
  function step(by: number) {
    if (!order.length) return;
    const next = order[(position + by + order.length) % order.length];
    setFocus(keyOf(next));
  }

  const refs: DocRef[] = included.map((d) => ({ category: d.category, id: d.id, exclude_fields: hidden[keyOf(d)] ?? [] }));
  const scopeKeys = [...new Set([...folderKeys, ...included.map((d) => d.category)])];
  const folderCounts = groups
    .map(([label, docs]) => ({ label, count: docs.filter((d) => checked.has(keyOf(d))).length }))
    .filter((f) => f.count > 0);

  async function handleDownload() {
    if (!included.length) return;
    try {
      setStage("generating");
      setProgress({ done: 0, total: included.length });
      const extras: { name: string; content: string }[] = [];
      if (withCover) {
        extras.push({
          name: "00 Cover note.html",
          content: buildCoverNote({ preparedBy, period, folders: folderCounts, total: included.length, note: coverNote.trim() || undefined, includesRegister: withRegister }),
        });
      }
      if (withRegister) extras.push({ name: "Document register.csv", content: buildRegisterCsv(included) });
      const folderOf = new Map(included.map((d) => [keyOf(d), d.folder_label ?? d.category]));
      const { blob } = await buildVaultZip(refs, setProgress, {
        extras,
        folderFor: groupByFolder ? (ref) => folderOf.get(keyOf(ref)) : undefined,
      });
      triggerBlobDownload(blob, `carecliq-audit-pack-${new Date().toISOString().slice(0, 10)}.zip`);
      setStage("done");
      await logShareEvent({ method: "download_zip", folder_keys: scopeKeys, documents: refs }).catch(() => undefined);
    } catch (err) {
      toast({ title: "Couldn't build the pack", description: err instanceof Error ? err.message : "Please try again.", variant: "destructive" });
      setStage("idle");
    }
  }

  async function handleEmail(provider: "email_gmail" | "email_outlook" | "email_mailto") {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      toast({ title: "Enter the auditor's email address first", variant: "destructive" });
      return;
    }
    const to = encodeURIComponent(email.trim());
    const su = encodeURIComponent(subject);
    const body = encodeURIComponent(message);
    const url =
      provider === "email_gmail"
        ? `https://mail.google.com/mail/?view=cm&fs=1&to=${to}&su=${su}&body=${body}`
        : provider === "email_outlook"
          ? `https://outlook.office.com/mail/deeplink/compose?to=${to}&subject=${su}&body=${body}`
          : `mailto:${to}?subject=${su}&body=${body}`;
    if (provider === "email_mailto") window.location.href = url;
    else window.open(url, "_blank", "noopener,noreferrer");
    await logShareEvent({ method: provider, folder_keys: scopeKeys, documents: refs, recipient_hint: email.trim() }).catch(() => undefined);
    toast({ title: "Draft opened", description: "Attach the pack you downloaded, then send it." });
  }

  const busy = stage === "generating";
  const percent = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const fieldStyle = { borderColor: BORDER, color: TEXT };
  const allVisibleChecked = visible.length > 0 && visible.every((d) => checked.has(keyOf(d)));

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <DialogContent className="flex h-[100dvh] w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none p-0 sm:h-[92vh] sm:w-[96vw] sm:max-w-[1400px] sm:rounded-3xl [&>button:last-child]:hidden">
        <DialogTitle className="sr-only">Share with auditor</DialogTitle>
        <DialogDescription className="sr-only">{targetDescription}</DialogDescription>

        {/* Header: what's going, and the actions, always in view */}
        <header className="flex flex-wrap items-center gap-3 border-b px-4 py-3 sm:px-6" style={{ borderColor: BORDER }}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl" style={{ background: PURPLE_SOFT, color: PURPLE }} aria-hidden="true">
            <Share2 size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold tracking-tight" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>
              Share with auditor
            </h2>
            <p className="truncate text-xs" style={{ color: MUTED }} aria-live="polite">
              {loading
                ? "Loading documents…"
                : `${plural(included.length, "document")} ticked${folderCounts.length > 1 ? ` from ${plural(folderCounts.length, "folder")}` : ""} · ${period.label.toLowerCase()}`}
            </p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition hover:bg-cc-soft" style={fieldStyle}>
                  <Settings2 size={15} /> Pack options
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 space-y-3 rounded-2xl p-4 shadow-none">
                <p className="text-sm font-semibold" style={{ color: TEXT }}>In the pack</p>
                {[
                  [withRegister, setWithRegister, "Document register", "A spreadsheet listing every file."] as const,
                  [withCover, setWithCover, "Cover note", "Who prepared it, the period, what's inside."] as const,
                  [groupByFolder, setGroupByFolder, "Keep files in their folders", "One folder per vault folder."] as const,
                ].map(([value, set, title, hint]) => (
                  <label key={title} className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} className="mt-1 h-4 w-4 accent-[color:var(--cc-brand-purple)]" />
                    <span>
                      <span className="block text-sm font-medium" style={{ color: TEXT }}>{title}</span>
                      <span className="block text-xs" style={{ color: MUTED }}>{hint}</span>
                    </span>
                  </label>
                ))}
                {withCover && (
                  <Field label="Note for the auditor" htmlFor="share-cover" optional>
                    <textarea id="share-cover" rows={3} value={coverNote} onChange={(e) => setCoverNote(e.target.value)} placeholder="e.g. For the October verification audit." className={textareaClass} style={fieldStyle} />
                  </Field>
                )}
              </PopoverContent>
            </Popover>

            <Popover>
              <PopoverTrigger asChild>
                <button type="button" className="inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition hover:bg-cc-soft" style={fieldStyle}>
                  <Mail size={15} /> Email
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-96 space-y-3 rounded-2xl p-4 shadow-none">
                <Field label="Auditor's email" htmlFor="share-email">
                  <input id="share-email" type="email" autoComplete="email" placeholder="auditor@example.com.au" value={email} onChange={(e) => setEmail(e.target.value)} className={inputClass} style={fieldStyle} />
                </Field>
                <Field label="Subject" htmlFor="share-subject">
                  <input id="share-subject" value={subject} onChange={(e) => setSubject(e.target.value)} className={inputClass} style={fieldStyle} />
                </Field>
                <Field label="Message" htmlFor="share-message" hint="Opens in your own email. Attach the pack before sending.">
                  <textarea id="share-message" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} className={textareaClass} style={fieldStyle} />
                </Field>
                <div className="flex flex-wrap justify-end gap-2">
                  <SecondaryButton onClick={() => void handleEmail("email_mailto")}>Mail app</SecondaryButton>
                  <SecondaryButton onClick={() => void handleEmail("email_outlook")}>Outlook</SecondaryButton>
                  <PrimaryButton onClick={() => void handleEmail("email_gmail")}>Gmail</PrimaryButton>
                </div>
              </PopoverContent>
            </Popover>

            <PrimaryButton onClick={() => void handleDownload()} disabled={!included.length || loading} busy={busy} className="flex-1 sm:flex-none">
              {stage === "done" ? <CheckCircle2 size={16} /> : <Download size={16} />}
              {busy ? `Packing ${progress.done} of ${progress.total}` : stage === "done" ? "Downloaded · again" : `Download pack (${included.length})`}
            </PrimaryButton>

            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={busy}
              aria-label="Close"
              className="flex h-11 w-11 items-center justify-center rounded-full transition hover:bg-cc-soft disabled:opacity-50"
              style={{ color: MUTED }}
            >
              <X size={18} />
            </button>
          </div>
          {busy && (
            <div className="h-1 w-full overflow-hidden rounded-full" style={{ background: "var(--cc-soft)" }} role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
              <div className="h-full rounded-full transition-all" style={{ width: `${percent}%`, background: PURPLE }} />
            </div>
          )}
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          {/* Left: the documents */}
          <aside className="flex shrink-0 flex-col border-b lg:w-[380px] lg:border-b-0 lg:border-r" style={{ borderColor: BORDER }}>
            <div className="space-y-2.5 border-b p-4" style={{ borderColor: BORDER }}>
              <div className="relative">
                <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
                <input aria-label="Search documents" placeholder="Search by title, person or ID" value={query} onChange={(e) => setQuery(e.target.value)} className={`${inputClass} h-10 pl-10`} style={fieldStyle} />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Time period"
                  value={preset}
                  onChange={(e) => setPreset(e.target.value as PeriodPreset)}
                  className="h-10 rounded-full border bg-cc-surface px-3 text-sm outline-none"
                  style={fieldStyle}
                >
                  {PERIOD_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
                </select>
                <Popover>
                  <PopoverTrigger asChild>
                    <button type="button" className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-sm font-semibold transition hover:bg-cc-soft" style={{ color: PURPLE }}>
                      <FolderPlus size={15} /> Add a folder
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-80 rounded-2xl p-2 shadow-none">
                    <input aria-label="Find a folder" placeholder="Find a folder" value={folderQuery} onChange={(e) => setFolderQuery(e.target.value)} className={`${inputClass} mb-2 h-10`} style={fieldStyle} />
                    <ul className="max-h-72 overflow-y-auto">
                      {!folderOptions && vaultFolders === null ? (
                        <li className="flex items-center gap-2 px-2 py-2 text-sm" style={{ color: MUTED }}><Loader2 size={14} className="animate-spin" /> Loading folders…</li>
                      ) : addable.length === 0 ? (
                        <li className="px-2 py-2 text-sm" style={{ color: MUTED }}>Every folder with files is already in.</li>
                      ) : (
                        addable.map((source) => (
                          <li key={source.key}>
                            <button type="button" onClick={() => addSource(source)} className="flex min-h-10 w-full items-center gap-2.5 rounded-lg px-2 text-left text-sm transition hover:bg-cc-soft" style={{ color: TEXT }}>
                              <FolderMark />
                              <span className="min-w-0 flex-1 truncate">{source.label}</span>
                              <span className="text-xs tabular-nums" style={{ color: MUTED }}>{source.count}</span>
                            </button>
                          </li>
                        ))
                      )}
                    </ul>
                  </PopoverContent>
                </Popover>
                {visible.length > 0 && (
                  <button type="button" onClick={() => setAll(!allVisibleChecked)} className="ml-auto text-xs font-semibold underline-offset-4 hover:underline" style={{ color: PURPLE }}>
                    {allVisibleChecked ? "Untick all" : "Tick all"}
                  </button>
                )}
              </div>
              {preset === "custom" && (
                <div className="grid grid-cols-2 gap-2">
                  <input aria-label="From" type="date" value={custom.from ?? ""} max={custom.to} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className={`${inputClass} h-10`} style={fieldStyle} />
                  <input aria-label="To" type="date" value={custom.to ?? ""} min={custom.from} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className={`${inputClass} h-10`} style={fieldStyle} />
                </div>
              )}
            </div>

            <div className="max-h-[45vh] flex-1 overflow-y-auto lg:max-h-none">
              {loading && items.length === 0 ? (
                <div className="space-y-2 p-4">
                  {[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl" style={{ background: "var(--cc-soft)" }} />)}
                </div>
              ) : visible.length === 0 ? (
                <p className="p-6 text-center text-sm" style={{ color: MUTED }}>
                  {items.length ? "Nothing matches. Try another period or search." : "Add a folder to choose documents."}
                </p>
              ) : (
                groups.map(([label, docs]) => (
                  <div key={label}>
                    <p className="sticky top-0 z-10 flex items-center gap-2 border-b bg-cc-surface px-4 py-2 text-xs font-semibold" style={{ borderColor: BORDER, color: MUTED }}>
                      <FolderMark /> {label}
                      <span className="ml-auto tabular-nums">{docs.filter((d) => checked.has(keyOf(d))).length}/{docs.length}</span>
                    </p>
                    <ul>
                      {docs.map((d) => {
                        const key = keyOf(d);
                        const isFocus = key === focus;
                        const hiddenCount = hidden[key]?.length ?? 0;
                        return (
                          <li key={key} className="flex items-center gap-1 border-b pl-4 pr-2 last:border-b-0" style={{ borderColor: BORDER, background: isFocus ? PURPLE_SOFT : undefined }}>
                            <input
                              type="checkbox"
                              aria-label={`Include ${d.title ?? d.id}`}
                              checked={checked.has(key)}
                              onChange={() => toggle(key)}
                              className="h-4 w-4 shrink-0 accent-[color:var(--cc-brand-purple)]"
                            />
                            <button type="button" onClick={() => setFocus(key)} className="min-w-0 flex-1 px-2.5 py-2.5 text-left">
                              <span className="block truncate text-sm font-medium" style={{ color: TEXT }}>
                                {d.person_type !== "Organisation" && d.person_name ? `${d.person_name} · ${d.title ?? ""}` : d.title}
                              </span>
                              <span className="flex items-center gap-2 text-xs" style={{ color: MUTED }}>
                                <span className="truncate">{[d.doc_id || d.reference, shortDate(d.date)].filter(Boolean).join(" · ")}</span>
                                {hiddenCount > 0 && (
                                  <span className="inline-flex shrink-0 items-center gap-1 font-semibold" style={{ color: PURPLE }}>
                                    <EyeOff size={11} /> {hiddenCount} hidden
                                  </span>
                                )}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))
              )}
            </div>
          </aside>

          {/* Right: the document, big enough to read */}
          <section className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 p-4 sm:p-5">
            {focused ? (
              <>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-base font-semibold" style={{ color: TEXT }}>{focused.title}</p>
                    <p className="truncate text-xs" style={{ color: MUTED }}>
                      {[focused.doc_id || focused.reference, focused.person_name, shortDate(focused.date), focused.folder_label].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="mr-1 text-xs tabular-nums" style={{ color: MUTED }}>{position >= 0 ? `${position + 1} of ${order.length}` : ""}</span>
                    <button type="button" onClick={() => step(-1)} aria-label="Previous document" className="flex h-10 w-10 items-center justify-center rounded-full border transition hover:bg-cc-soft" style={fieldStyle}><ChevronLeft size={17} /></button>
                    <button type="button" onClick={() => step(1)} aria-label="Next document" className="flex h-10 w-10 items-center justify-center rounded-full border transition hover:bg-cc-soft" style={fieldStyle}><ChevronRight size={17} /></button>
                  </div>
                </div>

                {focusedFields.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 rounded-2xl border px-3 py-2.5" style={{ borderColor: BORDER }}>
                    <span className="inline-flex items-center gap-1.5 text-xs font-semibold" style={{ color: MUTED }}>
                      <EyeOff size={13} /> Hide in this document
                    </span>
                    {focusedFields.map((field) => {
                      const off = focusedHidden.includes(field);
                      return (
                        <button
                          key={field}
                          type="button"
                          aria-pressed={off}
                          onClick={() => toggleField(field)}
                          className="min-h-8 rounded-full px-3 text-xs font-medium transition"
                          style={off
                            ? { background: "var(--cc-status-danger-bg)", color: "var(--cc-danger-text)", textDecoration: "line-through", boxShadow: "inset 0 0 0 1px var(--cc-danger-text)" }
                            : { color: TEXT, boxShadow: `inset 0 0 0 1px ${BORDER}` }}
                        >
                          {field}
                        </button>
                      );
                    })}
                    {sameKind.length > 1 && (
                      <button type="button" onClick={applyHiddenToAll} className="ml-auto text-xs font-semibold underline-offset-4 hover:underline" style={{ color: PURPLE }}>
                        Apply to all {sameKind.length} ticked {focused.folder_label ?? "documents"}
                      </button>
                    )}
                  </div>
                )}

                <div className="min-h-0 flex-1">
                  <DocumentViewer doc={focused} hidden={focusedHidden} />
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-2xl text-center" style={{ background: "var(--cc-soft)" }}>
                <FileText size={26} style={{ color: MUTED }} />
                <p className="text-sm" style={{ color: MUTED }}>{loading ? "Loading documents…" : "Choose a document to preview it here."}</p>
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
