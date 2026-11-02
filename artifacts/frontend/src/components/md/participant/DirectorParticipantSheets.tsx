import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import { getCoordinatorWorkerStats } from "@/services/coordinatorService";
import {
  DOCUMENT_KINDS,
  archiveParticipantDocument,
  changeCareTeam,
  changeServices,
  getAuditTrail,
  uploadParticipantDocument,
  type DirectorOverview,
  type ParticipantDocument,
} from "@/services/directorParticipantService";
import { AuditList, BAD, MUTED, PLUM, SOFT, TEXT, formatDate } from "./DirectorParticipantSections";

// The director-only actions on a participant, each in a right-side panel.

function Panel({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className={`flex w-full flex-col gap-0 p-0 ${wide ? "sm:max-w-2xl" : "sm:max-w-lg"}`}>
        <SheetHeader className="border-b border-cc-border p-5 pr-12">
          <SheetTitle>{title}</SheetTitle>
          {description && <SheetDescription>{description}</SheetDescription>}
        </SheetHeader>
        <div className="flex-1 space-y-5 overflow-y-auto p-5">{children}</div>
        {footer && <SheetFooter className="border-t border-cc-border p-4">{footer}</SheetFooter>}
      </SheetContent>
    </Sheet>
  );
}

const NONE = "__none__";

// ── Change the care team ─────────────────────────────────────────────────────

export function TeamSheet({
  open,
  onOpenChange,
  participantId,
  overview,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantId: string;
  overview: DirectorOverview;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const staff = useOrgQuery(["coordinator-worker-stats"], { queryFn: getCoordinatorWorkerStats, enabled: open });
  const [coordinator, setCoordinator] = useState<string>(NONE);
  const [main, setMain] = useState<string>(NONE);
  const [backups, setBackups] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCoordinator(overview.team.coordinator?.id ?? NONE);
    setMain(overview.team.main_worker?.id ?? NONE);
    setBackups(overview.team.backups.map((b) => b.id));
  }, [open, overview]);

  const people = (staff.data ?? []).filter((p) => p.is_active !== false);
  const coordinators = people.filter((p) => p.role === "support_coordinator" || p.role === "managing_director");
  const workers = people.filter((p) => p.role === "support_worker");

  async function save() {
    setSaving(true);
    try {
      await changeCareTeam(participantId, {
        coordinator_id: coordinator === NONE ? null : coordinator,
        main_worker_id: main === NONE ? null : main,
        backup_worker_ids: backups.filter((b) => b !== main),
      });
      toast({ title: "Care team updated", description: "Workers who were taken off keep their history." });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Couldn't change the team", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      title="Change the care team"
      description={`Who looks after ${overview.participant.full_name.split(" ")[0]}. The roster isn't changed; future shifts keep their worker until you reassign them.`}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving || staff.isLoading} style={{ background: PLUM }} className="text-white">
            {saving && <Loader2 size={14} className="mr-1.5 animate-spin" />}Save team
          </Button>
        </>
      }
    >
      {staff.isLoading ? (
        <Skeleton className="h-48 w-full rounded-2xl" />
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="team-coordinator">Coordinator</Label>
            <Select value={coordinator} onValueChange={setCoordinator}>
              <SelectTrigger id="team-coordinator"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No coordinator</SelectItem>
                {coordinators.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.full_name}{c.role === "managing_director" ? " (director)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="team-main">Main support worker</Label>
            <Select value={main} onValueChange={(v) => { setMain(v); setBackups((b) => b.filter((id) => id !== v)); }}>
              <SelectTrigger id="team-main"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>No main worker</SelectItem>
                {workers.map((w) => <SelectItem key={w.id} value={w.id}>{w.full_name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium" style={{ color: TEXT }}>Backup workers</legend>
            <p className="text-xs" style={{ color: MUTED }}>People who know this participant and can cover when the main worker is away.</p>
            <ul className="mt-2 divide-y rounded-2xl border border-cc-border">
              {workers.filter((w) => w.id !== main).map((w) => {
                const checked = backups.includes(w.id);
                return (
                  <li key={w.id} className="border-cc-border">
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 px-4">
                      <Checkbox
                        checked={checked}
                        onCheckedChange={(v) => setBackups((b) => (v ? [...b, w.id] : b.filter((id) => id !== w.id)))}
                      />
                      <span className="text-sm" style={{ color: TEXT }}>{w.full_name}</span>
                    </label>
                  </li>
                );
              })}
              {workers.length === 0 && <li className="p-4 text-sm" style={{ color: MUTED }}>No active support workers.</li>}
            </ul>
          </fieldset>
        </>
      )}
    </Panel>
  );
}

// ── Suspend, resume or end services ──────────────────────────────────────────

export type ServicesMode = "suspend" | "resume" | "end";

export function ServicesSheet({
  open,
  onOpenChange,
  mode,
  participantId,
  overview,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: ServicesMode;
  participantId: string;
  overview: DirectorOverview;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const first = overview.participant.full_name.split(" ")[0];
  const [reason, setReason] = useState("");
  const [lastDay, setLastDay] = useState("");
  const [cancelShifts, setCancelShifts] = useState(true);
  const [revokePortal, setRevokePortal] = useState(true);
  const [confirmName, setConfirmName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setReason("");
    const now = new Date();
    setLastDay(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`);
    setCancelShifts(true);
    setRevokePortal(overview.portal.people.length > 0);
    setConfirmName("");
  }, [open, overview.portal.people.length]);

  const copy = {
    suspend: {
      title: `Suspend services for ${first}`,
      description: "A temporary pause, for example a hospital stay or a break the participant asked for. Their record stays as it is and you can resume at any time.",
      button: "Suspend services",
    },
    resume: {
      title: `Resume services for ${first}`,
      description: "Services start again under the current service agreement. Re-roster any shifts that were cancelled while paused.",
      button: "Resume services",
    },
    end: {
      title: `End services for ${first}`,
      description: "For when support finishes for good: they've moved provider, moved away, no longer need support, or have passed away. Their records are kept for the retention period and stay in this profile.",
      button: "End services",
    },
  }[mode];

  const needsReason = mode !== "resume";
  const confirmOk = mode !== "end" || confirmName.trim().toLowerCase() === overview.participant.full_name.trim().toLowerCase();
  const canSave = !saving && (!needsReason || reason.trim().length > 0) && confirmOk;

  async function save() {
    setSaving(true);
    try {
      const result = await changeServices(participantId, {
        action: mode,
        reason: reason.trim() || undefined,
        last_service_date: mode === "end" ? lastDay : undefined,
        cancel_future_shifts: mode === "end" ? cancelShifts : undefined,
        revoke_portal_access: mode === "end" ? revokePortal : undefined,
      });
      toast({
        title: mode === "end" ? "Services ended" : mode === "suspend" ? "Services suspended" : "Services resumed",
        description:
          mode === "end"
            ? `${result.cancelled_shifts} future shift${result.cancelled_shifts === 1 ? "" : "s"} cancelled.${result.portal_access_removed ? ` Portal access removed for ${result.portal_access_removed}.` : ""}`
            : undefined,
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "That didn't go through", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      title={copy.title}
      description={copy.description}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            onClick={save}
            disabled={!canSave}
            className="text-white"
            style={{ background: mode === "resume" ? "var(--cc-green)" : mode === "end" ? BAD : PLUM }}
          >
            {saving && <Loader2 size={14} className="mr-1.5 animate-spin" />}{copy.button}
          </Button>
        </>
      }
    >
      {needsReason && (
        <div className="space-y-2">
          <Label htmlFor="services-reason">Reason</Label>
          <Textarea
            id="services-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={mode === "end" ? "For example: moved to a provider closer to family" : "For example: in hospital until further notice"}
          />
          <p className="text-xs" style={{ color: MUTED }}>Kept on the record and shown in the audit trail.</p>
        </div>
      )}
      {mode === "end" && (
        <>
          <div className="space-y-2">
            <Label htmlFor="services-last-day">Last day of service</Label>
            <Input id="services-last-day" type="date" value={lastDay} onChange={(e) => setLastDay(e.target.value)} />
          </div>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl p-4" style={{ background: SOFT }}>
            <Checkbox checked={cancelShifts} onCheckedChange={(v) => setCancelShifts(!!v)} className="mt-0.5" />
            <span>
              <span className="block text-sm font-medium" style={{ color: TEXT }}>Cancel shifts after the last day</span>
              <span className="block text-xs" style={{ color: MUTED }}>
                {overview.delivery.upcoming_14d} rostered in the next 14 days. Workers see them as cancelled.
              </span>
            </span>
          </label>
          {overview.portal.people.length > 0 && (
            <label className="flex cursor-pointer items-start gap-3 rounded-2xl p-4" style={{ background: SOFT }}>
              <Checkbox checked={revokePortal} onCheckedChange={(v) => setRevokePortal(!!v)} className="mt-0.5" />
              <span>
                <span className="block text-sm font-medium" style={{ color: TEXT }}>Remove portal access</span>
                <span className="block text-xs" style={{ color: MUTED }}>
                  {overview.portal.people.map((p) => p.name).filter(Boolean).join(", ")} will no longer be able to sign in.
                </span>
              </span>
            </label>
          )}
          <div className="space-y-2">
            <Label htmlFor="services-confirm">Type {overview.participant.full_name} to confirm</Label>
            <Input id="services-confirm" value={confirmName} onChange={(e) => setConfirmName(e.target.value)} autoComplete="off" />
            <p className="text-xs" style={{ color: MUTED }}>This can't be undone from here. A new referral would be needed to start services again.</p>
          </div>
        </>
      )}
    </Panel>
  );
}

// ── Import a document ────────────────────────────────────────────────────────

export function UploadSheet({
  open,
  onOpenChange,
  participantId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  participantId: string;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState("gp_letter");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [docDate, setDocDate] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFile(null); setKind("gp_letter"); setTitle(""); setAuthor(""); setDocDate(""); setNotes("");
  }, [open]);

  const isMedication = DOCUMENT_KINDS.find((k) => k.value === kind)?.group === "medication";
  const groups = useMemo(() => ([
    ["clinical", "Clinical"],
    ["medication", "Medication"],
    ["admin", "Plans and consent"],
  ] as const), []);

  async function save() {
    if (!file) return;
    setSaving(true);
    try {
      await uploadParticipantDocument(participantId, {
        file, category: kind, title: title.trim() || undefined, author: author.trim() || undefined,
        document_date: docDate || undefined, notes: notes.trim() || undefined,
      });
      toast({
        title: "Document filed",
        description: isMedication ? "It's being read into the medication chart. Check the details in the care record before workers rely on them." : undefined,
      });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Couldn't import the document", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      title="Import a document"
      description="PDF, Word or a photo of the page, up to 20 MB."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!file || saving} className="text-white" style={{ background: PLUM }}>
            {saving && <Loader2 size={14} className="mr-1.5 animate-spin" />}File document
          </Button>
        </>
      }
    >
      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        accept=".pdf,.doc,.docx,image/jpeg,image/png,image/webp"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          setFile(f);
          if (f && !title) setTitle(f.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));
        }}
      />
      {file ? (
        <div className="flex items-center gap-3 rounded-2xl p-4" style={{ background: SOFT }}>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium" style={{ color: TEXT }}>{file.name}</p>
            <p className="text-xs" style={{ color: MUTED }}>{(file.size / 1_000_000).toFixed(1)} MB</p>
          </div>
          <button type="button" aria-label="Choose a different file" onClick={() => { setFile(null); if (inputRef.current) inputRef.current.value = ""; }} className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-cc-surface">
            <X size={15} style={{ color: MUTED }} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-cc-border px-4 py-8 text-center transition hover:bg-cc-soft"
        >
          <Upload size={20} style={{ color: MUTED }} />
          <span className="text-sm font-medium" style={{ color: TEXT }}>Choose a file</span>
          <span className="text-xs" style={{ color: MUTED }}>GP letter, assessment, report, prescription or plan</span>
        </button>
      )}

      <div className="space-y-2">
        <Label htmlFor="doc-kind">What is it?</Label>
        <Select value={kind} onValueChange={setKind}>
          <SelectTrigger id="doc-kind"><SelectValue /></SelectTrigger>
          <SelectContent>
            {groups.map(([group, label]) => (
              <SelectGroup key={group}>
                <SelectLabel>{label}</SelectLabel>
                {DOCUMENT_KINDS.filter((k) => k.group === group).map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        {isMedication && (
          <p className="text-xs" style={{ color: MUTED }}>
            Read into the medication chart as a proposal. Nothing changes for workers until a coordinator or you verify it.
          </p>
        )}
      </div>

      {!isMedication && (
        <>
          <div className="space-y-2">
            <Label htmlFor="doc-title">Title</Label>
            <Input id="doc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="For example: OT functional assessment" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="doc-author">Written by</Label>
              <Input id="doc-author" value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Dr Helen Park" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="doc-date">Date on the document</Label>
              <Input id="doc-date" type="date" value={docDate} onChange={(e) => setDocDate(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="doc-notes">Notes</Label>
            <Textarea id="doc-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Anything the team should know about it" />
          </div>
        </>
      )}
    </Panel>
  );
}

export function ArchiveSheet({
  doc,
  onOpenChange,
  participantId,
  onSaved,
}: {
  doc: ParticipantDocument | null;
  onOpenChange: (open: boolean) => void;
  participantId: string;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (doc) setReason(""); }, [doc]);

  async function save() {
    if (!doc) return;
    setSaving(true);
    try {
      await archiveParticipantDocument(participantId, doc.id, reason.trim());
      toast({ title: "Document archived" });
      onSaved();
      onOpenChange(false);
    } catch (err) {
      toast({ title: "Couldn't archive it", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Panel
      open={!!doc}
      onOpenChange={onOpenChange}
      title="Archive this document"
      description={doc ? `${doc.title}. It leaves this list but is kept for the retention period, with the reason, in the audit trail.` : undefined}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={!reason.trim() || saving} className="text-white" style={{ background: PLUM }}>Archive</Button>
        </>
      }
    >
      <div className="space-y-2">
        <Label htmlFor="archive-reason">Reason</Label>
        <Input id="archive-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="For example: uploaded to the wrong participant" />
      </div>
    </Panel>
  );
}

// ── Full audit history ───────────────────────────────────────────────────────

export function AuditSheet({ open, onOpenChange, participantId }: { open: boolean; onOpenChange: (open: boolean) => void; participantId: string }) {
  const trail = useOrgQuery(["director-participant", participantId, "audit"], { queryFn: () => getAuditTrail(participantId), enabled: open });
  const [show, setShow] = useState<"all" | "change" | "view">("all");
  const entries = (trail.data?.entries ?? []).filter((e) => show === "all" || e.kind === show);
  return (
    <Panel open={open} onOpenChange={onOpenChange} title="Audit trail" description="Every change to this record and every time it was opened, newest first. Kept as NDIS audit evidence and can't be edited." wide>
      <div className="flex gap-2" role="group" aria-label="Filter the audit trail">
        {([["all", "Everything"], ["change", "Changes"], ["view", "Views"]] as const).map(([value, label]) => (
          <button
            key={value}
            type="button"
            aria-pressed={show === value}
            onClick={() => setShow(value)}
            className="min-h-10 rounded-full px-4 text-sm font-medium transition"
            style={show === value ? { background: TEXT, color: "var(--cc-bg)" } : { color: TEXT, boxShadow: "inset 0 0 0 1px var(--cc-border)" }}
          >
            {label}
          </button>
        ))}
      </div>
      {trail.isLoading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : entries.length === 0 ? (
        <p className="text-sm" style={{ color: MUTED }}>Nothing recorded yet.</p>
      ) : (
        <>
          <AuditList entries={entries} />
          <p className="text-xs" style={{ color: MUTED }}>Showing {entries.length} entries. Oldest shown: {formatDate(entries[entries.length - 1]?.when)}.</p>
        </>
      )}
    </Panel>
  );
}
