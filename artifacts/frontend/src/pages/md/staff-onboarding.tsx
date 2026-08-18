/**
 * Staff Onboarding — the single page for onboarding staff, start
 * to finish: Applicants (Applied/Interview/Offer extended/Hired/Rejected,
 * drag-and-drop), Hires (documents, e-signature, login invite — opened
 * inline when an offer is extended or an existing hire is clicked), and a
 * read-only oversight strip for Credentials/Training/Active once someone
 * has an account. This used to be two separate pages (Employee Onboarding
 * at /onboard-employee and this Staff Onboarding board) — merged into one
 * so there's a single onboarding surface, not two.
 *
 * Drag mechanics modeled on RosterBoard.tsx (raw useDraggable/useDroppable +
 * DragOverlay). Coordinators can move applicants between Applied and
 * Interview only; Offer extended / Rejected is MD-only, enforced both here
 * (disabled drop zones) and server-side (applicant_service.move_applicant_stage).
 * Hired is never a manual drop target — it happens automatically when the
 * candidate signs their offer (employee_onboarding_service.sign_as_worker).
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent, type DragStartEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertCircle, ArrowLeft, ArrowRight, Briefcase, CalendarDays, ChevronDown, ChevronUp, Clock, Clock3, CheckCircle2,
  Copy, FileSignature, FileText, ClipboardCheck, Gauge, GripVertical, LayoutGrid, Loader2, Mail, PenLine, Phone,
  Rows3, Search, Send, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Trash2, Upload, UserPlus, X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useReAuth } from "@/hooks/useReAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  getHire, addHireDocument, uploadHireDocumentFile,
  deleteHireDocument, sendForSignature, sendHireInvite,
  type EmployeeHire, type OnboardingDocument, type CandidateDocument,
} from "@/services/employeeOnboardingService";
import {
  listApplicants, createApplicant, moveApplicantStage, updateApplicantNotes,
  listApplicantDocuments, uploadApplicantDocument, deleteApplicantDocument,
  type Applicant, type ApplicantStage, type ApplicantDocument, type ApplicantDocumentType,
} from "@/services/applicantsService";
import {
  getWorkerPipelineOverview,
  type PipelinePerson,
} from "@/services/coordinatorService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const SURFACE = "var(--cc-surface)";
const SUCCESS = "var(--cc-status-success)";
const SUCCESS_BG = "var(--cc-status-success-bg)";
const WARNING = "var(--cc-status-warning)";
const WARNING_BG = "var(--cc-status-warning-bg)";
const INFO = "var(--cc-status-info)";
const INFO_BG = "var(--cc-status-info-bg)";
const DANGER_BG = "var(--cc-status-danger-bg)";
const DANGER = "var(--cc-status-danger)";
const GREEN = "#0F7B57";
const AMBER = "#9A5B0A";

// Shared stage identity — one accent color per pipeline stage, reused across
// column headers, card accents, avatars, and the list view so both views
// read as the same board rather than two disconnected UIs.
const STAGE_COLOR: Record<string, string> = {
  interview: "#8A78D6",
  offer_extended: "#D39B42",
  credentials: "#C77D3E",
  training: "#5C9C72",
  active: "#0F7B57",
};

function initials(name: string) {
  return (name || "?").split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

function Avatar({ name, size = 40, color = PLUM }: { name: string; size?: number; color?: string }) {
  return (
    <div
      className="rounded-full shrink-0 flex items-center justify-center font-black text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: color }}
    >
      {initials(name)}
    </div>
  );
}

// ── Hire detail (documents, signatures, invite) ──────────────────────────

const STATUS_META: Record<EmployeeHire["status"], { label: string; bg: string; color: string }> = {
  draft: { label: "Draft", bg: SOFT, color: MUTED },
  awaiting_signatures: { label: "Awaiting signatures", bg: WARNING_BG, color: WARNING },
  signed: { label: "Ready to invite", bg: INFO_BG, color: INFO },
  invited: { label: "Invite sent", bg: SUCCESS_BG, color: SUCCESS },
  completed: { label: "Onboarded", bg: SUCCESS_BG, color: SUCCESS },
  expired: { label: "Offer expired", bg: DANGER_BG, color: DANGER },
};

const DOC_TYPE_META: Record<string, { label: string; icon: typeof FileText }> = {
  offer_letter: { label: "Offer letter", icon: Briefcase },
  service_agreement: { label: "Service agreement", icon: ClipboardCheck },
  other: { label: "Other", icon: FileText },
};

const STEPS = [
  { key: "details", label: "Details", icon: UserPlus },
  { key: "documents", label: "Documents", icon: FileSignature },
  { key: "signatures", label: "Signatures", icon: PenLine },
  { key: "invite", label: "Invite sent", icon: Mail },
] as const;

function stepIndexForStatus(status: EmployeeHire["status"]): number {
  switch (status) {
    case "draft": return 1;
    case "awaiting_signatures": return 2;
    case "signed": return 2;
    case "invited": return 3;
    case "completed": return 3;
    default: return 0;
  }
}

function StatusBadge({ status }: { status: EmployeeHire["status"] }) {
  const meta = STATUS_META[status];
  return (
    <span className="text-[10px] font-black px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  );
}

function HireProgressTracker({ status }: { status: EmployeeHire["status"] }) {
  const active = stepIndexForStatus(status);
  return (
    <div className="flex items-start">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = i < active;
        const current = i === active;
        const last = i === STEPS.length - 1;
        return (
          <div key={s.key} className={`flex items-center ${last ? "shrink-0" : "flex-1"}`}>
            <div className="flex shrink-0 flex-col items-center gap-1.5">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full"
                style={{ background: done ? SUCCESS : current ? PLUM : SOFT, color: done || current ? "#fff" : MUTED }}
              >
                {done ? <CheckCircle2 size={14} /> : <Icon size={13} />}
              </div>
              <p className="whitespace-nowrap text-[10px] font-bold" style={{ color: current ? TEXT : MUTED }}>{s.label}</p>
            </div>
            {!last && <div className="mx-2 mb-4 h-[2px] flex-1" style={{ background: i < active ? SUCCESS : BORDER }} />}
          </div>
        );
      })}
    </div>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: typeof Mail; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg" style={{ background: SOFT, color: MUTED }}>
        <Icon size={13} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[9px] font-black uppercase tracking-wide" style={{ color: MUTED }}>{label}</p>
        <p className="mt-0.5 truncate text-[12px] font-bold" style={{ color: TEXT }}>{value}</p>
      </div>
    </div>
  );
}

type ReadinessCategory = { label: string; achieved: number; max: number };

function ReadinessCard({ categories }: { categories: ReadinessCategory[] }) {
  const totalAchieved = categories.reduce((s, c) => s + c.achieved, 0);
  const totalMax = categories.reduce((s, c) => s + c.max, 0);
  const score = totalMax > 0 ? (totalAchieved / totalMax) * 5 : 0;
  return (
    <div className="rounded-lg border" style={{ background: SURFACE, borderColor: BORDER }}>
      <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
        <Gauge size={16} style={{ color: PLUM }} />
        <p className="text-sm font-black" style={{ color: TEXT }}>Readiness</p>
      </div>
      <div className="p-5">
        <div className="flex items-end gap-1.5">
          <p className="text-[30px] font-black leading-none" style={{ color: PLUM }}>{score.toFixed(1)}</p>
          <p className="pb-1 text-xs font-semibold" style={{ color: MUTED }}>/ 5.0</p>
        </div>
        <div className="mt-4 space-y-3">
          {categories.map((c) => (
            <div key={c.label}>
              <div className="flex items-center justify-between gap-2 text-[11px] font-semibold" style={{ color: TEXT }}>
                <span>{c.label}</span>
                <span className="shrink-0" style={{ color: MUTED }}>{c.achieved} / {c.max}</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: SOFT }}>
                <div className="h-full rounded-full transition-all" style={{ width: `${c.max > 0 ? (c.achieved / c.max) * 100 : 0}%`, background: PLUM }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

type ProfileSidebarPerson = {
  email: string;
  phone?: string | null;
  role: string;
  dateLabel: string;
  dateValue: string;
  resumeSummary?: string | null;
  resumeExperienceYears?: string | null;
  resumeSkills?: string[] | null;
};

function ProfileSidebar({
  person, documents, notesSlot,
}: {
  person: ProfileSidebarPerson;
  documents?: CandidateDocument[];
  notesSlot?: React.ReactNode;
}) {
  const hasSkills = !!(person.resumeSkills && person.resumeSkills.length > 0);
  const hasDocuments = !!(documents && documents.length > 0);

  const tabs: { key: string; label: string }[] = [{ key: "profile", label: "Profile" }];
  if (hasSkills) tabs.push({ key: "skills", label: `Skills (${person.resumeSkills!.length})` });
  if (hasDocuments) tabs.push({ key: "documents", label: "Application" });
  if (notesSlot) tabs.push({ key: "notes", label: "Notes" });

  const [tab, setTab] = useState(tabs[0].key);

  return (
    <div className="rounded-lg border" style={{ background: SURFACE, borderColor: BORDER }}>
      {tabs.length > 1 && (
        <div className="p-3 pb-0">
          <div className="flex items-center gap-1 rounded-lg p-1" style={{ background: SOFT }}>
            {tabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className="flex-1 truncate rounded-md px-2 py-1.5 text-[10px] font-black transition-all"
                style={{
                  background: tab === t.key ? "white" : "transparent",
                  color: tab === t.key ? PLUM : MUTED,
                  boxShadow: tab === t.key ? "var(--cc-shadow-sm)" : "none",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="p-5">
        {tab === "profile" && (
          <div className="space-y-4">
            {person.resumeSummary && (
              <div className="flex items-start gap-2">
                <Sparkles size={12} className="mt-0.5 shrink-0" style={{ color: PLUM }} />
                <p className="text-[13px] leading-relaxed" style={{ color: TEXT }}>{person.resumeSummary}</p>
              </div>
            )}

            {person.resumeExperienceYears && (
              <div className="flex items-center gap-2.5">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ background: SOFT, color: PLUM }}>
                  <Clock3 size={14} />
                </div>
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Experience</p>
                  <p className="text-[12px] font-bold" style={{ color: TEXT }}>{person.resumeExperienceYears}</p>
                </div>
              </div>
            )}

            {(person.resumeSummary || person.resumeExperienceYears) && <div className="border-t" style={{ borderColor: BORDER }} />}

            <div className="space-y-3">
              <InfoRow icon={Mail} label="Email" value={person.email} />
              {person.phone && <InfoRow icon={Phone} label="Phone" value={person.phone} />}
              <InfoRow icon={Briefcase} label="Role" value={person.role} />
              <InfoRow icon={CalendarDays} label={person.dateLabel} value={person.dateValue} />
            </div>
          </div>
        )}

        {tab === "skills" && hasSkills && (
          <div className="flex flex-wrap gap-1.5">
            {person.resumeSkills!.map((skill) => (
              <span key={skill} className="rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: SOFT, color: TEXT }}>{skill}</span>
            ))}
          </div>
        )}

        {tab === "documents" && hasDocuments && (
          <div className="space-y-2.5">
            {documents!.map((d) => {
              const meta = APPLICANT_DOC_TYPE_META[d.document_type] ?? APPLICANT_DOC_TYPE_META.other;
              const Icon = meta.icon;
              return (
                <div key={d.id} className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <Icon size={13} style={{ color: MUTED }} className="shrink-0" />
                    <span className="truncate text-xs font-semibold" style={{ color: TEXT }}>{meta.label}</span>
                  </div>
                  {d.file_url && (
                    <a href={d.file_url} target="_blank" rel="noreferrer" className="shrink-0 text-[11px] font-bold underline" style={{ color: PLUM }}>View</a>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {tab === "notes" && notesSlot}
      </div>
    </div>
  );
}

function SignatureCard({
  label, signedName, signedAt, pendingLabel,
}: { label: string; signedName?: string | null; signedAt?: string | null; pendingLabel: string }) {
  const signed = !!signedAt;
  return (
    <div className="rounded-lg p-3.5 border" style={{ background: signed ? SUCCESS_BG : SOFT, borderColor: signed ? "transparent" : BORDER }}>
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: signed ? SUCCESS : MUTED }}>{label}</p>
      {signed ? (
        <div className="mt-1.5">
          <p className="text-sm font-black flex items-center gap-1.5" style={{ color: TEXT }}>
            <CheckCircle2 size={14} style={{ color: SUCCESS }} /> {signedName}
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: MUTED }}>
            Signed {new Date(signedAt!).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
      ) : (
        <p className="text-xs mt-1.5 flex items-center gap-1.5" style={{ color: MUTED }}><Clock3 size={13} /> {pendingLabel}</p>
      )}
    </div>
  );
}

function HireDetail({
  hireId, hires, onNavigate, requireReAuth,
}: {
  hireId: string;
  hires: PipelinePerson[];
  onNavigate: (id: string) => void;
  requireReAuth: <T>(fn: () => Promise<T>) => Promise<T | undefined>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addDocOpen, setAddDocOpen] = useState(false);
  const [docType, setDocType] = useState("offer_letter");
  const [docTitle, setDocTitle] = useState("");
  const [docNotes, setDocNotes] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);

  const hireQuery = useQuery({ queryKey: ["employee-hire", hireId], queryFn: () => getHire(hireId) });
  const hire = hireQuery.data;
  const documents = hire?.documents ?? [];

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["employee-hire", hireId] });
    qc.invalidateQueries({ queryKey: ["worker-pipeline"] });
  }

  const addDocMut = useMutation({
    mutationFn: async () => {
      const doc = await addHireDocument(hireId, { document_type: docType, title: docTitle.trim(), notes: docNotes.trim() || undefined });
      if (docFile) await uploadHireDocumentFile(doc.id, docFile);
      return doc;
    },
    onSuccess: () => {
      invalidate();
      toast({ title: "Document added" });
      setAddDocOpen(false);
      setDocTitle(""); setDocNotes(""); setDocFile(null); setDocType("offer_letter");
    },
    onError: (e: Error) => toast({ title: "Could not add document", description: e.message, variant: "destructive" }),
  });

  const removeDocMut = useMutation({
    mutationFn: (id: string) => deleteHireDocument(id),
    onSuccess: () => { invalidate(); toast({ title: "Document removed" }); },
  });

  const sendSignatureMut = useMutation({
    mutationFn: () => sendForSignature(hireId),
    onSuccess: (updated) => {
      invalidate();
      const delivered = updated.email_delivery?.status === "queued";
      toast({
        title: "Sent for signature",
        description: delivered
          ? "The applicant has been emailed a link to review and sign."
          : "Sign link created — email delivery isn't configured yet, so copy the link below and send it manually.",
      });
    },
    onError: (e: Error) => toast({ title: "Could not send for signature", description: e.message, variant: "destructive" }),
  });

  const sendInviteMut = useMutation({
    mutationFn: async () => {
      if (!hire) throw new Error("Hire not loaded");
      return requireReAuth(() => sendHireInvite(hire));
    },
    onSuccess: (result) => {
      if (!result) return;
      invalidate();
      toast({ title: "Invite sent", description: `Login invite sent to ${result.email}.` });
    },
    onError: (e: Error) => toast({ title: "Could not send invite", description: e.message, variant: "destructive" }),
  });

  if (hireQuery.isLoading || !hire) {
    return (
      <div className="space-y-4 p-6">
        <div className="h-16 rounded-lg animate-pulse" style={{ background: SOFT }} />
        <div className="grid gap-5 lg:grid-cols-[1fr_260px]">
          <div className="h-64 rounded-lg animate-pulse" style={{ background: SOFT }} />
          <div className="h-64 rounded-lg animate-pulse" style={{ background: SOFT }} />
        </div>
      </div>
    );
  }

  const signLink = hire.sign_token ? `${window.location.origin}/onboarding-sign?token=${hire.sign_token}` : null;
  const index = hires.findIndex((h) => h.id === hireId);
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < hires.length - 1;

  const presentDocTypes = new Set(documents.map((d) => d.document_type));
  const readinessCategories: ReadinessCategory[] = [
    {
      label: "Documents",
      achieved: (["offer_letter", "service_agreement"] as const).filter((t) => presentDocTypes.has(t)).length,
      max: 2,
    },
    {
      label: "Signatures",
      achieved: (hire.employer_signed_at ? 1 : 0) + (hire.worker_signed_at ? 1 : 0),
      max: 2,
    },
    {
      label: "Invite sent",
      achieved: hire.status === "invited" || hire.status === "completed" ? 1 : 0,
      max: 1,
    },
  ];

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b px-6 py-5" style={{ background: SURFACE, borderColor: BORDER }}>
        {hires.length > 1 && (
          <div className="mb-3 flex items-center gap-1 pr-6">
            <button
              onClick={() => hasPrev && onNavigate(hires[index - 1].id)}
              disabled={!hasPrev}
              aria-label="Previous candidate"
              className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/5 disabled:opacity-30"
            >
              <ArrowLeft size={14} style={{ color: MUTED }} />
            </button>
            {index >= 0 && (
              <span className="px-1 text-[11px] font-semibold" style={{ color: MUTED }}>{index + 1} of {hires.length}</span>
            )}
            <button
              onClick={() => hasNext && onNavigate(hires[index + 1].id)}
              disabled={!hasNext}
              aria-label="Next candidate"
              className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/5 disabled:opacity-30"
            >
              <ArrowRight size={14} style={{ color: MUTED }} />
            </button>
          </div>
        )}
        <div className="flex items-start gap-3 pr-6">
          <Avatar name={hire.full_name} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-black truncate" style={{ color: TEXT }}>{hire.full_name}</h2>
              <StatusBadge status={hire.status} />
            </div>
            <p className="mt-1 truncate text-xs" style={{ color: MUTED }}>
              {hire.email}{hire.phone ? ` · ${hire.phone}` : ""} · <span className="capitalize">{hire.role.replace(/_/g, " ")}</span>
            </p>
          </div>
        </div>
        <div className="mt-5">
          <HireProgressTracker status={hire.status} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-6">
        <div className="grid gap-5 lg:grid-cols-[1fr_240px] items-start">
          <div className="space-y-5 min-w-0">
          <ReadinessCard categories={readinessCategories} />

          <div className="rounded-lg border" style={{ background: SURFACE, borderColor: BORDER }}>
            <div className="flex items-center justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
              <div className="flex items-center gap-2">
                <FileSignature size={16} style={{ color: PLUM }} />
                <p className="text-sm font-black" style={{ color: TEXT }}>Documents</p>
              </div>
              {hire.status === "draft" && (
                <Button variant="outline" size="sm" className="gap-1.5 rounded-md" onClick={() => setAddDocOpen(true)}>
                  <FileText size={13} /> Add document
                </Button>
              )}
            </div>
            <div className="p-5">
              {documents.length === 0 ? (
                <div className="rounded-lg p-5 text-center" style={{ background: SOFT }}>
                  <p className="text-xs font-medium" style={{ color: MUTED }}>
                    No documents attached yet. Add the offer letter and service agreement before sending for signature.
                  </p>
                </div>
              ) : (
                <div className="divide-y" style={{ borderColor: BORDER }}>
                  {documents.map((d: OnboardingDocument) => {
                    const meta = DOC_TYPE_META[d.document_type] ?? DOC_TYPE_META.other;
                    const Icon = meta.icon;
                    return (
                      <div key={d.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-9 w-9 rounded-lg shrink-0 flex items-center justify-center" style={{ background: SOFT, color: PLUM }}>
                            <Icon size={16} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-bold truncate" style={{ color: TEXT }}>{d.title}</p>
                            <p className="text-xs" style={{ color: MUTED }}>{meta.label}{d.file_url ? " · file attached" : ""}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {d.file_url && (
                            <a href={d.file_url} target="_blank" rel="noreferrer" className="text-xs font-bold underline px-1.5" style={{ color: PLUM }}>View</a>
                          )}
                          {hire.status === "draft" && (
                            <button onClick={() => removeDocMut.mutate(d.id)} className="rounded-lg p-1.5 hover:bg-black/5" aria-label="Remove document">
                              <Trash2 size={13} style={{ color: MUTED }} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border" style={{ background: SURFACE, borderColor: BORDER }}>
            <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
              <PenLine size={16} style={{ color: PLUM }} />
              <p className="text-sm font-black" style={{ color: TEXT }}>Signatures</p>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <SignatureCard label="Employer" signedName={hire.employer_signed_name} signedAt={hire.employer_signed_at} pendingLabel="Not yet sent" />
                <SignatureCard label="New hire" signedName={hire.worker_signed_name} signedAt={hire.worker_signed_at} pendingLabel="Awaiting signature" />
              </div>

              {hire.status === "draft" && (
                <Button variant="navy" className="w-full gap-2 rounded-lg" onClick={() => sendSignatureMut.mutate()} disabled={sendSignatureMut.isPending || documents.length === 0}>
                  {sendSignatureMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send for signature
                </Button>
              )}

              {hire.status === "awaiting_signatures" && signLink && (
                <div className="flex items-center gap-2 rounded-lg p-3" style={{ background: WARNING_BG }}>
                  <Mail size={14} style={{ color: WARNING }} className="shrink-0" />
                  <p className="text-xs flex-1" style={{ color: TEXT }}>Emailed to {hire.email}. Waiting for their signature.</p>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(signLink)
                        .then(() => toast({ title: "Sign link copied" }))
                        .catch(() => toast({ title: "Could not copy link", description: "Copy it manually instead.", variant: "destructive" }));
                    }}
                    className="rounded-lg p-1.5 hover:bg-black/5 shrink-0"
                    aria-label="Copy sign link"
                    title="Copy sign link"
                  >
                    <Copy size={13} style={{ color: MUTED }} />
                  </button>
                </div>
              )}

              {hire.status === "signed" && (
                <Button variant="navy" className="w-full gap-2 rounded-lg" onClick={() => sendInviteMut.mutate()} disabled={sendInviteMut.isPending}>
                  {sendInviteMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send login invite
                </Button>
              )}

              {(hire.status === "invited" || hire.status === "completed") && (
                <div className="flex items-center gap-2 rounded-lg p-3" style={{ background: SUCCESS_BG }}>
                  <CheckCircle2 size={16} style={{ color: SUCCESS }} className="shrink-0" />
                  <p className="text-xs font-bold" style={{ color: SUCCESS }}>
                    Login invite sent — {hire.status === "completed" ? "account activated." : "waiting for them to set up their account."}
                  </p>
                </div>
              )}
            </div>
          </div>

          {(hire.status === "invited" || hire.status === "completed") && (
            <div className="flex items-center gap-2.5 rounded-lg p-4 border" style={{ background: INFO_BG, borderColor: BORDER }}>
              <ShieldCheck size={16} style={{ color: INFO }} className="shrink-0" />
              <p className="text-xs" style={{ color: TEXT }}>
                {hire.full_name.split(" ")[0]} will appear in the Credentials/Training columns below once they finish setting up their account, and can't be rostered until onboarding is complete.
              </p>
            </div>
          )}
          </div>

          <div className="space-y-5">
            <ProfileSidebar
              person={{
                email: hire.email,
                phone: hire.phone,
                role: hire.role.replace(/_/g, " "),
                dateLabel: "Added",
                dateValue: new Date(hire.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }),
                resumeSummary: hire.resume_summary,
                resumeExperienceYears: hire.resume_experience_years,
                resumeSkills: hire.resume_skills,
              }}
              documents={hire.candidate_documents}
            />
          </div>
        </div>
      </div>

      <Sheet open={addDocOpen} onOpenChange={setAddDocOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" style={{ background: SURFACE }}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2" style={{ color: TEXT }}>
              <FileText size={18} style={{ color: PLUM }} /> Add document
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Document type</label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="offer_letter">Offer letter</SelectItem>
                  <SelectItem value="service_agreement">Service agreement</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Title</label>
              <Input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="e.g. Offer of Employment" autoFocus />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Notes (optional)</label>
              <Input value={docNotes} onChange={(e) => setDocNotes(e.target.value)} placeholder="Any context for this document" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>File (PDF or image, optional)</label>
              <label className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-sm cursor-pointer transition-colors hover:bg-black/[0.02]" style={{ borderColor: BORDER, color: docFile ? TEXT : MUTED }}>
                <Upload size={14} />
                {docFile ? docFile.name : "Choose file"}
                <input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          </div>
          <SheetFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setAddDocOpen(false)}>Cancel</Button>
            <Button variant="navy" onClick={() => addDocMut.mutate()} disabled={!docTitle.trim() || addDocMut.isPending}>
              {addDocMut.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null} Save document
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}

// ── Applicants pipeline (Kanban) ─────────────────────────────────────────

function applicantDaysInStage(applicant: Applicant): number {
  const ms = Date.now() - new Date(applicant.stage_entered_at).getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

function applicantMeta(applicant: Applicant): string {
  const days = applicantDaysInStage(applicant);
  switch (applicant.stage) {
    case "applied": return days === 0 ? "Applied today" : `Applied ${days}d ago`;
    case "interview": return days === 0 ? "Interview scheduled" : `In interview ${days}d`;
    case "offer_extended": return days === 0 ? "Offer sent today" : `Offer sent ${days}d ago`;
    case "hired": return "Signed — setting up account";
    case "rejected": return applicant.rejected_reason || "Not proceeding";
    default: return "";
  }
}

function ApplicantCard({ applicant, onReject, onOpen }: { applicant: Applicant; onReject?: () => void; onOpen?: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: applicant.id, data: { applicant } });
  const isNew = applicantDaysInStage(applicant) <= 1;
  const roleLabel = applicant.role === "support_coordinator" ? "Support Coordinator" : "Support Worker";
  const accent = STAGE_COLOR.interview;
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: isDragging ? `${CSS.Translate.toString(transform)} scale(0.97) rotate(-1deg)` : CSS.Translate.toString(transform),
        opacity: isDragging ? 0.4 : 1,
        borderColor: BORDER,
        borderLeft: `3px solid ${accent}`,
      }}
      className="group relative select-none rounded-2xl border bg-white p-4 shadow-sm transition-[transform,box-shadow,opacity] duration-150 hover:-translate-y-0.5 hover:shadow-md"
    >
      <div className="cursor-grab active:cursor-grabbing" {...listeners} {...attributes}>
        <div className="flex items-start gap-3 pr-5">
          <Avatar name={applicant.full_name} size={36} color={accent} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[12px] font-black" style={{ color: TEXT }}>{applicant.full_name}</p>
            <p className="mt-0.5 truncate text-[10px] font-medium" style={{ color: MUTED }}>{roleLabel}</p>
          </div>
          <GripVertical size={13} className="mt-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-40" style={{ color: MUTED }} />
        </div>
        <div className="mt-3 flex items-center gap-1.5 text-[10px] font-medium" style={{ color: MUTED }}>
          <CalendarDays size={11} />
          <span className="truncate">{applicantMeta(applicant)}</span>
        </div>
        {isNew && (
          <span className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black" style={{ background: "#EEF1F5", color: "#3D5A6C" }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: CORAL }} /> New
          </span>
        )}
      </div>
      <div className="absolute right-2.5 top-2.5 flex items-center gap-1 opacity-0 transition-all group-hover:opacity-100">
        {onOpen && (
          <button
            onClick={onOpen}
            aria-label={`View ${applicant.full_name}`}
            title="View details"
            className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/5"
          >
            <FileText size={13} style={{ color: MUTED }} />
          </button>
        )}
        {onReject && (
          <button
            onClick={onReject}
            aria-label={`Reject ${applicant.full_name}`}
            title="Reject"
            className="flex h-6 w-6 items-center justify-center rounded-full hover:bg-black/5"
          >
            <X size={13} style={{ color: MUTED }} />
          </button>
        )}
      </div>
    </div>
  );
}

function ApplicantDragClone({ applicant }: { applicant: Applicant }) {
  const roleLabel = applicant.role === "support_coordinator" ? "Support Coordinator" : "Support Worker";
  return (
    <div className="w-[248px] rotate-2 cursor-grabbing rounded-2xl border-2 bg-white p-4 shadow-2xl" style={{ borderColor: PLUM }}>
      <div className="flex items-start gap-3">
        <Avatar name={applicant.full_name} size={36} color={STAGE_COLOR.interview} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-black" style={{ color: TEXT }}>{applicant.full_name}</p>
          <p className="mt-0.5 truncate text-[10px] font-medium" style={{ color: MUTED }}>{roleLabel}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-1.5 text-[10px] font-medium" style={{ color: MUTED }}>
        <CalendarDays size={11} />
        <span className="truncate">{applicantMeta(applicant)}</span>
      </div>
    </div>
  );
}

function ColumnCountPill({ count, color }: { count: number; color?: string }) {
  return (
    <span
      className="flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[10px] font-black"
      style={{ background: color ? `${color}1F` : BORDER, color: color ?? MUTED }}
    >
      {count}
    </span>
  );
}

function ColumnHeading({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="flex items-center justify-between px-0.5 pb-0.5">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
        <p className="text-[13px] font-black" style={{ color: TEXT }}>{label}</p>
      </div>
      <ColumnCountPill count={count} color={color} />
    </div>
  );
}

function DroppableColumn({
  id, label, count, color, disabled, isOver, children,
}: { id: string; label: string; count: number; color: string; disabled: boolean; isOver: boolean; children: React.ReactNode }) {
  const { setNodeRef } = useDroppable({ id, disabled });
  const active = isOver && !disabled;
  return (
    <div
      ref={setNodeRef}
      className="flex min-h-[410px] w-[270px] shrink-0 scale-100 flex-col gap-3 rounded-[1.25rem] border-t-[3px] p-4 transition-all duration-150 lg:min-h-[430px] lg:flex-1 lg:w-auto"
      style={{
        background: active ? "var(--cc-plum-soft)" : SOFT,
        opacity: disabled ? 0.5 : 1,
        borderTopColor: color,
        outline: active ? `2px dashed ${PLUM}` : "2px dashed transparent",
        outlineOffset: -6,
        transform: active ? "scale(1.012)" : "scale(1)",
      }}
    >
      <ColumnHeading label={label} count={count} color={color} />
      <div className="flex min-h-[120px] flex-1 flex-col gap-2.5">
        {children}
        {count === 0 && (
          <p className="rounded-xl border border-dashed py-8 text-center text-[10px] font-medium" style={{ color: MUTED }}>
            {active ? "Drop here" : "Nobody here"}
          </p>
        )}
      </div>
    </div>
  );
}

function StaticColumn({ label, count, color, children }: { label: string; count: number; color: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[410px] w-[270px] shrink-0 flex-col gap-3 rounded-[1.25rem] border-t-[3px] p-4 lg:min-h-[430px] lg:flex-1 lg:w-auto" style={{ background: SOFT, borderTopColor: color }}>
      <ColumnHeading label={label} count={count} color={color} />
      <div className="flex min-h-[120px] flex-1 flex-col gap-2.5">
        {children}
        {count === 0 && (
          <p className="rounded-xl border border-dashed py-8 text-center text-[10px] font-medium" style={{ color: MUTED }}>Nobody here</p>
        )}
      </div>
    </div>
  );
}

function offerLetterMeta(hire: PipelinePerson): { meta: string; attention: boolean } {
  const meta = hire.status === "awaiting_signatures" ? "Awaiting signature"
    : hire.status === "signed" ? "Signed, ready to invite"
    : "Offer drafted";
  return { meta, attention: hire.status === "awaiting_signatures" };
}

function OfferLetterCard({ hire, onOpen }: { hire: PipelinePerson; onOpen: () => void }) {
  const { meta, attention } = offerLetterMeta(hire);
  const accent = STAGE_COLOR.offer_extended;
  return (
    <button onClick={onOpen} className="group w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md" style={{ borderColor: BORDER, borderLeft: `3px solid ${accent}` }}>
      <div className="flex items-start gap-3">
        <Avatar name={hire.full_name} size={36} color={accent} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-black" style={{ color: TEXT }}>{hire.full_name}</p>
          <p className="mt-0.5 truncate text-[10px] font-medium" style={{ color: MUTED }}>Offer letter</p>
        </div>
        <ArrowRight size={14} className="mt-1 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" style={{ color: MUTED }} />
      </div>
      <p className="mt-3 truncate text-[10px] font-medium" style={{ color: MUTED }}>{meta}</p>
      <span className="mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black" style={{ background: attention ? WARNING_BG : SOFT, color: attention ? WARNING : MUTED }}>
        {attention ? <><AlertCircle size={9} /> Action needed</> : "In progress"}
      </span>
    </button>
  );
}

function NewApplicantSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (a: Applicant) => void }) {
  const { toast } = useToast();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"support_worker" | "support_coordinator">("support_worker");
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [otherFiles, setOtherFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!fullName.trim() || !email.trim()) return;
    setSaving(true);
    try {
      const created = await createApplicant({ full_name: fullName.trim(), email: email.trim(), phone: phone.trim() || undefined, role });
      const uploads: Promise<unknown>[] = [];
      if (resumeFile) {
        uploads.push(uploadApplicantDocument(created.id, { document_type: "resume", title: resumeFile.name, file: resumeFile }));
      }
      for (const f of otherFiles) {
        uploads.push(uploadApplicantDocument(created.id, { document_type: "other", title: f.name, file: f }));
      }
      if (uploads.length) {
        const results = await Promise.allSettled(uploads);
        const failed = results.filter((r) => r.status === "rejected").length;
        if (failed) {
          toast({ title: "Applicant added", description: `${failed} file(s) failed to upload — you can retry from their profile.`, variant: "destructive" });
        } else {
          toast({ title: "Applicant added with files attached" });
        }
      } else {
        toast({ title: "Applicant added" });
      }
      onCreated(created);
    } catch (e) {
      toast({ title: "Failed to add applicant", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" style={{ background: SURFACE }}>
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2" style={{ color: TEXT }}>
            <UserPlus size={18} style={{ color: PLUM }} /> New Applicant
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Full name</label>
            <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Jordan Smith" autoFocus />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Email</label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@example.com" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Phone (optional)</label>
              <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0412 345 678" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Role</label>
              <Select value={role} onValueChange={(v) => setRole(v as "support_worker" | "support_coordinator")}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="support_worker">Support Worker</SelectItem>
                  <SelectItem value="support_coordinator">Support Coordinator</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Resume / CV (optional)</label>
            <label className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-sm cursor-pointer transition-colors hover:bg-black/[0.02]" style={{ borderColor: BORDER, color: resumeFile ? TEXT : MUTED }}>
              <Upload size={14} />
              {resumeFile ? resumeFile.name : "Choose file (PDF or image)"}
              <input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => setResumeFile(e.target.files?.[0] ?? null)} />
            </label>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Other files (optional)</label>
            <label className="flex items-center gap-2 rounded-lg border border-dashed px-3 py-3 text-sm cursor-pointer transition-colors hover:bg-black/[0.02]" style={{ borderColor: BORDER, color: MUTED }}>
              <Upload size={14} />
              Add cover letter, ID, or other files
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                multiple
                className="hidden"
                onChange={(e) => setOtherFiles((prev) => [...prev, ...Array.from(e.target.files ?? [])])}
              />
            </label>
            {otherFiles.length > 0 && (
              <div className="space-y-1">
                {otherFiles.map((f, i) => (
                  <div key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5" style={{ background: SOFT }}>
                    <span className="truncate text-xs font-medium" style={{ color: TEXT }}>{f.name}</span>
                    <button type="button" onClick={() => setOtherFiles((prev) => prev.filter((_, idx) => idx !== i))} className="shrink-0 rounded p-0.5 hover:bg-black/5" aria-label={`Remove ${f.name}`}>
                      <X size={12} style={{ color: MUTED }} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <SheetFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="navy" onClick={handleSave} disabled={!fullName.trim() || !email.trim() || saving}>
            {saving ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null} Add Applicant
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

// ── Applicant detail (documents) ─────────────────────────────────────────

const APPLICANT_DOC_TYPE_META: Record<ApplicantDocumentType, { label: string; icon: typeof FileText }> = {
  resume: { label: "Resume / CV", icon: FileText },
  cover_letter: { label: "Cover letter", icon: FileText },
  id_document: { label: "ID document", icon: ShieldCheck },
  other: { label: "Other", icon: FileText },
};

const APPLICANT_STAGE_STEPS = [
  { key: "applied", label: "Applied" },
  { key: "interview", label: "Interview" },
  { key: "offer_extended", label: "Offer extended" },
] as const;

function ApplicantStageTracker({ stage }: { stage: ApplicantStage }) {
  const active = APPLICANT_STAGE_STEPS.findIndex((s) => s.key === stage);
  return (
    <div className="flex items-start">
      {APPLICANT_STAGE_STEPS.map((s, i) => {
        const done = i < active;
        const current = i === active;
        const last = i === APPLICANT_STAGE_STEPS.length - 1;
        return (
          <div key={s.key} className={`flex items-center ${last ? "shrink-0" : "flex-1"}`}>
            <div className="flex shrink-0 flex-col items-center gap-1.5">
              <div
                className="flex h-7 w-7 items-center justify-center rounded-full"
                style={{ background: done ? SUCCESS : current ? PLUM : SOFT, color: done || current ? "#fff" : MUTED }}
              >
                {done ? <CheckCircle2 size={14} /> : <span className="text-[10px] font-black">{i + 1}</span>}
              </div>
              <p className="whitespace-nowrap text-[10px] font-bold" style={{ color: current ? TEXT : MUTED }}>{s.label}</p>
            </div>
            {!last && <div className="mx-2 mb-4 h-[2px] flex-1" style={{ background: i < active ? SUCCESS : BORDER }} />}
          </div>
        );
      })}
    </div>
  );
}

function ApplicantDetailSheet({
  applicant, applicants, onClose, onNavigate, isHireManager, movePending, onMoveStage, onReject,
}: {
  applicant: Applicant;
  applicants: Applicant[];
  onClose: () => void;
  onNavigate: (id: string) => void;
  isHireManager: boolean;
  movePending: boolean;
  onMoveStage: (stage: ApplicantStage) => void;
  onReject: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [addOpen, setAddOpen] = useState(false);
  const [docType, setDocType] = useState<ApplicantDocumentType>("resume");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notes, setNotes] = useState(applicant.notes ?? "");

  useEffect(() => {
    setNotes(applicant.notes ?? "");
  }, [applicant.id, applicant.notes]);

  const index = applicants.findIndex((a) => a.id === applicant.id);
  const hasPrev = index > 0;
  const hasNext = index >= 0 && index < applicants.length - 1;

  const docsQuery = useQuery({
    queryKey: ["applicant-documents", applicant.id],
    queryFn: () => listApplicantDocuments(applicant.id),
  });
  const documents = docsQuery.data ?? [];

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["applicant-documents", applicant.id] });
    qc.invalidateQueries({ queryKey: ["applicants"] });
  }

  const notesMut = useMutation({
    mutationFn: (value: string) => updateApplicantNotes(applicant.id, value),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["applicants"] });
      toast({ title: "Note saved" });
    },
    onError: (e: Error) => toast({ title: "Could not save note", description: e.message, variant: "destructive" }),
  });

  const addDocMut = useMutation({
    mutationFn: () => {
      if (!docFile) throw new Error("Choose a file first.");
      const isResume = docType === "resume";
      return uploadApplicantDocument(applicant.id, { document_type: docType, title: docFile.name, file: docFile }).then((doc) => ({ doc, isResume }));
    },
    onSuccess: ({ isResume }) => {
      invalidate();
      toast({
        title: "Document added",
        description: isResume ? "Building a profile from their resume…" : undefined,
      });
      setAddOpen(false);
      setDocFile(null);
      setDocType("resume");
    },
    onError: (e: Error) => toast({ title: "Could not add document", description: e.message, variant: "destructive" }),
  });

  const removeDocMut = useMutation({
    mutationFn: (id: string) => deleteApplicantDocument(id),
    onSuccess: () => { invalidate(); toast({ title: "Document removed" }); },
  });

  const stageOptions: { value: ApplicantStage; label: string }[] = [];
  if (applicant.stage === "applied") stageOptions.push({ value: "interview", label: "Move to Interview" });
  if (applicant.stage === "interview") stageOptions.push({ value: "applied", label: "Move back to Applied" });
  if (isHireManager) stageOptions.push({ value: "offer_extended", label: "Extend Offer" });
  const [stageMenuOpen, setStageMenuOpen] = useState(false);

  const presentApplicantDocTypes = new Set(documents.map((d) => d.document_type));
  const readinessCategories: ReadinessCategory[] = [
    {
      label: "Documents",
      achieved: (["resume", "cover_letter", "id_document"] as const).filter((t) => presentApplicantDocTypes.has(t)).length,
      max: 3,
    },
    {
      label: "Profile extracted",
      achieved: applicant.resume_summary ? 1 : 0,
      max: 1,
    },
  ];

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-hidden p-0 sm:max-w-3xl" style={{ background: SURFACE }}>
        <div className="flex h-full flex-col">
          <div className="shrink-0 border-b px-6 py-5" style={{ background: SURFACE, borderColor: BORDER }}>
            <div className="flex items-center justify-between gap-3 pr-6">
              <div className="flex items-center gap-1">
                <button
                  onClick={() => hasPrev && onNavigate(applicants[index - 1].id)}
                  disabled={!hasPrev}
                  aria-label="Previous candidate"
                  className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/5 disabled:opacity-30"
                >
                  <ArrowLeft size={14} style={{ color: MUTED }} />
                </button>
                {index >= 0 && (
                  <span className="px-1 text-[11px] font-semibold" style={{ color: MUTED }}>{index + 1} of {applicants.length}</span>
                )}
                <button
                  onClick={() => hasNext && onNavigate(applicants[index + 1].id)}
                  disabled={!hasNext}
                  aria-label="Next candidate"
                  className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/5 disabled:opacity-30"
                >
                  <ArrowRight size={14} style={{ color: MUTED }} />
                </button>
              </div>

              <div className="relative">
                <button
                  onClick={() => setMenuOpen((v) => !v)}
                  aria-label="More actions"
                  className="flex h-7 w-7 items-center justify-center rounded-full transition-colors hover:bg-black/5"
                >
                  <Settings2 size={14} style={{ color: MUTED }} />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-[calc(100%+6px)] z-10 w-40 overflow-hidden rounded-lg border bg-white py-1 shadow-lg" style={{ borderColor: BORDER }}>
                    <button
                      onClick={() => { setMenuOpen(false); onReject(); }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] font-semibold hover:bg-black/[0.03]"
                      style={{ color: DANGER }}
                    >
                      <X size={13} /> Reject
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="mt-4 flex items-start gap-3">
              <Avatar name={applicant.full_name} size={44} color={STAGE_COLOR.interview} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-black truncate" style={{ color: TEXT }}>{applicant.full_name}</h2>
                  <span className="rounded-full px-2.5 py-1 text-[10px] font-black capitalize" style={{ background: "var(--cc-plum-soft)", color: PLUM }}>
                    {applicant.stage === "applied" ? "Applied" : "Interview"}
                  </span>
                </div>
                <p className="mt-1 truncate text-xs" style={{ color: MUTED }}>
                  {applicant.email}{applicant.phone ? ` · ${applicant.phone}` : ""} · <span className="capitalize">{applicant.role.replace(/_/g, " ")}</span>
                </p>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <p className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Hiring Process</p>
              {stageOptions.length > 0 && (
                <div className="relative">
                  <button
                    onClick={() => setStageMenuOpen((v) => !v)}
                    disabled={movePending}
                    className="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black text-white disabled:opacity-60"
                    style={{ background: PLUM }}
                  >
                    {movePending ? <Loader2 size={12} className="animate-spin" /> : null} Move Stage <ChevronDown size={12} />
                  </button>
                  {stageMenuOpen && (
                    <div className="absolute right-0 top-[calc(100%+6px)] z-10 w-48 overflow-hidden rounded-lg border bg-white py-1 shadow-lg" style={{ borderColor: BORDER }}>
                      {stageOptions.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => { setStageMenuOpen(false); onMoveStage(opt.value); }}
                          className="flex w-full items-center px-3 py-2 text-left text-[12px] font-semibold hover:bg-black/[0.03]"
                          style={{ color: TEXT }}
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3">
              <ApplicantStageTracker stage={applicant.stage} />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-6">
            <div className="grid gap-5 lg:grid-cols-[1fr_260px] items-start">
              <div className="space-y-5 min-w-0">
                <ReadinessCard categories={readinessCategories} />

                <div className="rounded-lg border" style={{ borderColor: BORDER }}>
                  <div className="flex items-center justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                    <div className="flex items-center gap-2">
                      <FileText size={16} style={{ color: PLUM }} />
                      <p className="text-sm font-black" style={{ color: TEXT }}>Documents</p>
                    </div>
                    <Button variant="outline" size="sm" className="gap-1.5 rounded-md" onClick={() => setAddOpen((v) => !v)}>
                      <Upload size={13} /> Add file
                    </Button>
                  </div>

                  {addOpen && (
                    <div className="space-y-3 px-5 py-4 border-b" style={{ borderColor: BORDER, background: SOFT }}>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Document type</label>
                        <Select value={docType} onValueChange={(v) => setDocType(v as ApplicantDocumentType)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="resume">Resume / CV</SelectItem>
                            <SelectItem value="cover_letter">Cover letter</SelectItem>
                            <SelectItem value="id_document">ID document</SelectItem>
                            <SelectItem value="other">Other</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <label className="flex items-center gap-2 rounded-lg border border-dashed bg-white px-3 py-3 text-sm cursor-pointer transition-colors hover:bg-black/[0.02]" style={{ borderColor: BORDER, color: docFile ? TEXT : MUTED }}>
                        <Upload size={14} />
                        {docFile ? docFile.name : "Choose file (PDF or image)"}
                        <input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
                      </label>
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" onClick={() => { setAddOpen(false); setDocFile(null); }}>Cancel</Button>
                        <Button variant="navy" size="sm" onClick={() => addDocMut.mutate()} disabled={!docFile || addDocMut.isPending}>
                          {addDocMut.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null} Upload
                        </Button>
                      </div>
                    </div>
                  )}

                  <div className="p-5">
                    {documents.length === 0 ? (
                      <div className="rounded-lg p-5 text-center" style={{ background: SOFT }}>
                        <p className="text-xs font-medium" style={{ color: MUTED }}>
                          No files uploaded yet — add a resume/CV or other supporting documents.
                        </p>
                      </div>
                    ) : (
                      <div className="divide-y" style={{ borderColor: BORDER }}>
                        {documents.map((d: ApplicantDocument) => {
                          const meta = APPLICANT_DOC_TYPE_META[d.document_type] ?? APPLICANT_DOC_TYPE_META.other;
                          const Icon = meta.icon;
                          return (
                            <div key={d.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                              <div className="flex items-center gap-3 min-w-0">
                                <div className="h-9 w-9 rounded-lg shrink-0 flex items-center justify-center" style={{ background: SOFT, color: PLUM }}>
                                  <Icon size={16} />
                                </div>
                                <div className="min-w-0">
                                  <p className="text-sm font-bold truncate" style={{ color: TEXT }}>{d.title}</p>
                                  <p className="text-xs" style={{ color: MUTED }}>{meta.label}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                {d.file_url && (
                                  <a href={d.file_url} target="_blank" rel="noreferrer" className="text-xs font-bold underline px-1.5" style={{ color: PLUM }}>View</a>
                                )}
                                <button onClick={() => removeDocMut.mutate(d.id)} className="rounded-lg p-1.5 hover:bg-black/5" aria-label={`Remove ${d.title}`}>
                                  <Trash2 size={13} style={{ color: MUTED }} />
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="space-y-5">
                <ProfileSidebar
                  person={{
                    email: applicant.email,
                    phone: applicant.phone,
                    role: applicant.role.replace(/_/g, " "),
                    dateLabel: "Applied",
                    dateValue: new Date(applicant.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }),
                    resumeSummary: applicant.resume_summary,
                    resumeExperienceYears: applicant.resume_experience_years,
                    resumeSkills: applicant.resume_skills,
                  }}
                  notesSlot={
                    <div>
                      <textarea
                        value={notes}
                        onChange={(e) => setNotes(e.target.value)}
                        onBlur={() => { if (notes !== (applicant.notes ?? "")) notesMut.mutate(notes); }}
                        rows={5}
                        placeholder="Write a note about this candidate…"
                        className="w-full resize-none rounded-lg border px-3 py-2 text-[12px] outline-none focus:ring-1"
                        style={{ borderColor: BORDER, color: TEXT }}
                      />
                      {notesMut.isPending && <p className="mt-1.5 text-[10px]" style={{ color: MUTED }}>Saving…</p>}
                    </div>
                  }
                />
              </div>
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ConfirmOfferModal({
  applicant, onConfirm, onCancel, confirming,
}: { applicant: Applicant; onConfirm: () => void; onCancel: () => void; confirming: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-white shadow-2xl" style={{ borderColor: BORDER }}>
        <div className="px-5 pt-5 pb-4 border-b" style={{ borderColor: BORDER }}>
          <h2 className="text-[15px] font-black" style={{ color: TEXT }}>Extend an offer?</h2>
          <p className="mt-1 text-[12px]" style={{ color: MUTED }}>
            This creates a real hire record for {applicant.full_name} — you'll attach the offer letter and send it for signature next.
          </p>
        </div>
        <div className="flex justify-end gap-2 px-5 py-4">
          <button onClick={onCancel} className="rounded-full px-4 py-1.5 text-[12px] font-bold" style={{ background: SOFT, color: MUTED }}>Cancel</button>
          <button onClick={onConfirm} disabled={confirming} className="rounded-full px-4 py-1.5 text-[12px] font-bold text-white disabled:opacity-60" style={{ background: PLUM }}>
            {confirming ? "Creating…" : "Extend offer"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RejectModal({
  applicant, onConfirm, onCancel, confirming,
}: { applicant: Applicant; onConfirm: (reason: string) => void; onCancel: () => void; confirming: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-2xl border bg-white shadow-2xl" style={{ borderColor: BORDER }}>
        <div className="px-5 pt-5 pb-4 border-b" style={{ borderColor: BORDER }}>
          <h2 className="text-[15px] font-black" style={{ color: TEXT }}>Reject {applicant.full_name}?</h2>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Reason (optional)"
            className="mt-3 w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
            style={{ borderColor: BORDER }}
          />
        </div>
        <div className="flex justify-end gap-2 px-5 py-4">
          <button onClick={onCancel} className="rounded-full px-4 py-1.5 text-[12px] font-bold" style={{ background: SOFT, color: MUTED }}>Cancel</button>
          <button onClick={() => onConfirm(reason)} disabled={confirming} className="rounded-full px-4 py-1.5 text-[12px] font-bold text-white disabled:opacity-60" style={{ background: CORAL }}>
            {confirming ? "Rejecting…" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}


// ── Read-only oversight: Credentials / Training / Active ─────────────────

type OversightColumnKey = "credentials" | "training" | "active";

function daysAgo(iso?: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24)));
}

function FlagBadge({ flag }: { flag?: PipelinePerson["flag"] }) {
  if (flag === "warn") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-black" style={{ background: WARNING_BG, color: WARNING }}>
        <Clock size={9} /> Action needed
      </span>
    );
  }
  if (flag === "complete") {
    return <span className="rounded-full px-2 py-0.5 text-[9px] font-black" style={{ background: SUCCESS_BG, color: SUCCESS }}>Active</span>;
  }
  return <span className="rounded-full px-2 py-0.5 text-[9px] font-black" style={{ background: SOFT, color: MUTED }}>In progress</span>;
}

const OVERSIGHT_LABEL: Record<OversightColumnKey, string> = { credentials: "Credentials", training: "Training", active: "Active" };

function oversightMeta(columnKey: OversightColumnKey, person: PipelinePerson): string {
  if (columnKey === "credentials") return "Mandatory credentials incomplete";
  if (columnKey === "training") return "Training or induction incomplete";
  const days = daysAgo(person.joined_at);
  return days != null ? `Sent to coordinator for rostering, ${days}d ago` : "Rostering ready";
}

function OversightCard({ columnKey, person, onOpen }: { columnKey: OversightColumnKey; person: PipelinePerson; onOpen: () => void }) {
  const isAttention = person.flag === "warn";
  const accent = STAGE_COLOR[columnKey];
  return (
    <button onClick={onOpen} className="group w-full rounded-2xl border bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md" style={{ borderColor: BORDER, borderLeft: `3px solid ${accent}` }}>
      <div className="flex items-start gap-3">
        <Avatar name={person.full_name} size={36} color={accent} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-black" style={{ color: TEXT }}>{person.full_name}</p>
          <p className="mt-0.5 truncate text-[10px] font-medium" style={{ color: MUTED }}>{OVERSIGHT_LABEL[columnKey]}</p>
        </div>
        <ArrowRight size={14} className="mt-1 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" style={{ color: MUTED }} />
      </div>
      <p className="mt-3 truncate text-[10px] font-medium" style={{ color: MUTED }}>{oversightMeta(columnKey, person)}</p>
      <div className="mt-2"><FlagBadge flag={person.flag} /></div>
      {isAttention && <div className="mt-2 flex items-center gap-1 text-[9px] font-bold" style={{ color: WARNING }}><AlertCircle size={10} /> Requires attention</div>}
    </button>
  );
}

function KpiTile({ label, value, color, bg, active, onClick, icon: Icon }: { label: string; value: number; color: string; bg: string; active?: boolean; onClick?: () => void; icon?: typeof CheckCircle2 }) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[30px] font-black leading-none" style={{ color }}>{value}</p>
        {Icon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "rgba(255,255,255,0.65)", color }}>
            <Icon size={15} />
          </div>
        )}
      </div>
      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>{label}</p>
      {active && <div className="mt-3 h-1 w-8 rounded-full" style={{ background: color }} />}
    </>
  );
  if (!onClick) return <div className="rounded-[1.25rem] px-5 py-4.5" style={{ background: bg }}>{content}</div>;
  return <button onClick={onClick} className="w-full rounded-[1.25rem] px-5 py-4.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm" style={{ background: bg, outline: active ? `2px solid ${color}` : undefined, outlineOffset: active ? 2 : undefined }}>{content}</button>;
}

// ── List view ─────────────────────────────────────────────────────────

type PipelineRow = {
  id: string;
  name: string;
  roleLabel: string;
  stageKey: "interview" | "offer_extended" | "credentials" | "training" | "active";
  stageLabel: string;
  color: string;
  meta: string;
  attention: boolean;
  onOpen?: () => void;
  onReject?: () => void;
};

type SortKey = "name" | "stage";

function PipelineListView({
  rows, sortKey, sortAsc, onSort,
}: { rows: PipelineRow[]; sortKey: SortKey; sortAsc: boolean; onSort: (key: SortKey) => void }) {
  function SortHeader({ label, k, className }: { label: string; k: SortKey; className?: string }) {
    const active = sortKey === k;
    return (
      <button onClick={() => onSort(k)} className={`flex items-center gap-1 text-left ${className ?? ""}`}>
        {label}
        {active && (sortAsc ? <ChevronUp size={11} /> : <ChevronDown size={11} />)}
      </button>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <div className="grid grid-cols-[1fr_140px_140px_1fr_40px] gap-3 border-b px-5 py-2.5 text-[10px] font-black uppercase tracking-[0.1em]" style={{ borderColor: BORDER, color: MUTED }}>
        <SortHeader label="Candidate" k="name" />
        <SortHeader label="Role" k="name" className="hidden sm:flex" />
        <SortHeader label="Stage" k="stage" />
        <span className="hidden md:inline">Status</span>
        <span />
      </div>
      {rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-[12px] font-medium" style={{ color: MUTED }}>Nobody matches the current filters.</p>
      ) : (
        <div className="divide-y" style={{ borderColor: BORDER }}>
          {rows.map((row) => (
            <div
              key={row.id}
              onClick={row.onOpen}
              className={`grid grid-cols-[1fr_140px_140px_1fr_40px] items-center gap-3 px-5 py-3 transition-colors ${row.onOpen ? "cursor-pointer hover:bg-black/[0.02]" : ""}`}
            >
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={row.name} size={30} color={row.color} />
                <p className="truncate text-[12px] font-black" style={{ color: TEXT }}>{row.name}</p>
              </div>
              <p className="hidden truncate text-[11px] font-medium sm:block" style={{ color: MUTED }}>{row.roleLabel}</p>
              <span className="inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-black" style={{ background: `${row.color}1F`, color: row.color }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: row.color }} />
                {row.stageLabel}
              </span>
              <p className="hidden truncate text-[11px] font-medium md:flex md:items-center md:gap-1" style={{ color: row.attention ? WARNING : MUTED }}>
                {row.attention && <AlertCircle size={11} />} {row.meta}
              </p>
              <div className="flex justify-end">
                {row.onReject && (
                  <button
                    onClick={(e) => { e.stopPropagation(); row.onReject?.(); }}
                    aria-label={`Reject ${row.name}`}
                    title="Reject"
                    className="flex h-7 w-7 items-center justify-center rounded-full hover:bg-black/5"
                  >
                    <X size={13} style={{ color: MUTED }} />
                  </button>
                )}
                {row.onOpen && <ArrowRight size={14} style={{ color: "#B8B4B0" }} />}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────

export default function StaffOnboardingBoard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { requireReAuth, modal: reauthModal } = useReAuth();
  const isHireManager = user?.role === "managing_director";

  const [openHireId, setOpenHireId] = useState<string | null>(null);
  const [openApplicantId, setOpenApplicantId] = useState<string | null>(null);
  const [notProceedingOpen, setNotProceedingOpen] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [activeApplicant, setActiveApplicant] = useState<Applicant | null>(null);
  const [overStage, setOverStage] = useState<ApplicantStage | null>(null);
  const [pendingOffer, setPendingOffer] = useState<Applicant | null>(null);
  const [pendingReject, setPendingReject] = useState<Applicant | null>(null);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [activeKpi, setActiveKpi] = useState<string | null>(null);
  const [view, setView] = useState<"kanban" | "list">("kanban");
  const [sortKey, setSortKey] = useState<SortKey>("stage");
  const [sortAsc, setSortAsc] = useState(true);

  const pipelineQuery = useQuery({ queryKey: ["worker-pipeline"], queryFn: getWorkerPipelineOverview });
  const data = pipelineQuery.data;

  const applicantsQuery = useQuery({ queryKey: ["applicants"], queryFn: listApplicants });
  const applicants = applicantsQuery.data ?? [];
  const openApplicant = applicants.find((a) => a.id === openApplicantId) ?? null;
  const interviewApplicants = applicants.filter((a) => a.stage === "applied" || a.stage === "interview");

  const normalizedSearch = search.trim().toLowerCase();
  const matchesSearch = (name: string) => !normalizedSearch || name.toLowerCase().includes(normalizedSearch);
  const filteredInterviewApplicants = interviewApplicants.filter((a) => {
    if (!matchesSearch(a.full_name)) return false;
    if (stageFilter !== "all" && stageFilter !== a.stage) return false;
    return !attentionOnly;
  });
  const filteredOfferLetters = (data?.columns.offer_letter ?? []).filter((p) => {
    if (!matchesSearch(p.full_name)) return false;
    if (stageFilter !== "all" && stageFilter !== "offer_extended") return false;
    if (attentionOnly) return p.status === "awaiting_signatures";
    return true;
  });
  const filteredCredentials = (stageFilter === "all" || stageFilter === "credentials")
    ? (data?.columns.credentials ?? []).filter((p) => matchesSearch(p.full_name) && (!attentionOnly || p.flag === "warn"))
    : [];
  const filteredTraining = (stageFilter === "all" || stageFilter === "training")
    ? (data?.columns.training ?? []).filter((p) => matchesSearch(p.full_name) && (!attentionOnly || p.flag === "warn"))
    : [];
  const filteredActive = (stageFilter === "all" || stageFilter === "active")
    ? (data?.columns.active ?? []).filter((p) => matchesSearch(p.full_name) && !attentionOnly)
    : [];

  const STAGE_ORDER: Record<PipelineRow["stageKey"], number> = { interview: 0, offer_extended: 1, credentials: 2, training: 3, active: 4 };
  const listRows: PipelineRow[] = [
    ...filteredInterviewApplicants.map((a): PipelineRow => ({
      id: a.id,
      name: a.full_name,
      roleLabel: a.role === "support_coordinator" ? "Support Coordinator" : "Support Worker",
      stageKey: "interview",
      stageLabel: a.stage === "applied" ? "Applied" : "Interview",
      color: STAGE_COLOR.interview,
      meta: applicantMeta(a),
      attention: false,
      onReject: () => setPendingReject(a),
      onOpen: () => setOpenApplicantId(a.id),
    })),
    ...filteredOfferLetters.map((h): PipelineRow => {
      const { meta, attention } = offerLetterMeta(h);
      return { id: h.id, name: h.full_name, roleLabel: "—", stageKey: "offer_extended", stageLabel: "Offer letter", color: STAGE_COLOR.offer_extended, meta, attention, onOpen: () => setOpenHireId(h.id) };
    }),
    ...filteredCredentials.map((p): PipelineRow => ({ id: p.id, name: p.full_name, roleLabel: "—", stageKey: "credentials", stageLabel: "Credentials", color: STAGE_COLOR.credentials, meta: oversightMeta("credentials", p), attention: p.flag === "warn", onOpen: () => openWorker(p.id, "credentials") })),
    ...filteredTraining.map((p): PipelineRow => ({ id: p.id, name: p.full_name, roleLabel: "—", stageKey: "training", stageLabel: "Training", color: STAGE_COLOR.training, meta: oversightMeta("training", p), attention: p.flag === "warn", onOpen: () => openWorker(p.id, "training") })),
    ...filteredActive.map((p): PipelineRow => ({ id: p.id, name: p.full_name, roleLabel: "—", stageKey: "active", stageLabel: "Active", color: STAGE_COLOR.active, meta: oversightMeta("active", p), attention: false, onOpen: () => openWorker(p.id, "overview") })),
  ].sort((a, b) => {
    const dir = sortAsc ? 1 : -1;
    if (sortKey === "name") return a.name.localeCompare(b.name) * dir;
    return (STAGE_ORDER[a.stageKey] - STAGE_ORDER[b.stageKey]) * dir;
  });

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortAsc((v) => !v);
    else { setSortKey(key); setSortAsc(true); }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const stageMut = useMutation({
    mutationFn: ({ id, stage, reason }: { id: string; stage: ApplicantStage; reason?: string }) => moveApplicantStage(id, stage, reason),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: ["applicants"] });
      qc.invalidateQueries({ queryKey: ["worker-pipeline"] });
      if (updated.stage === "offer_extended" && updated.employee_onboarding_id) {
        toast({ title: "Offer extended — opening hire record" });
        setOpenHireId(updated.employee_onboarding_id);
      }
    },
    onError: (e: Error) => toast({ title: "Couldn't move applicant", description: e.message, variant: "destructive" }),
  });

  function handleMoveStage(applicantToMove: Applicant, stage: ApplicantStage) {
    if (stage === "offer_extended") { setPendingOffer(applicantToMove); return; }
    stageMut.mutate({ id: applicantToMove.id, stage });
  }

  function openWorker(workerId: string, tab: string) {
    navigate(`/team?workerId=${encodeURIComponent(workerId)}&tab=${encodeURIComponent(tab)}`);
  }

  function handleDragStart(event: DragStartEvent) {
    const applicant = applicants.find((a) => a.id === event.active.id);
    setActiveApplicant(applicant ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveApplicant(null);
    setOverStage(null);
    const { active, over } = event;
    if (!over) return;
    const applicant = applicants.find((a) => a.id === active.id);
    const targetStage = over.id as ApplicantStage;
    if (!applicant || applicant.stage === targetStage) return;
    if (targetStage === "offer_extended") { setPendingOffer(applicant); return; }
    stageMut.mutate({ id: applicant.id, stage: targetStage });
  }

  const notProceedingCount = data
    ? data.not_proceeding.rejected_applicants.length + data.not_proceeding.expired_offers.length + data.not_proceeding.auto_deactivated_workers.length
    : 0;
  const inPipelineCount = interviewApplicants.length + (data?.columns.offer_letter.length ?? 0);

  function setKpiFilter(filter: string) {
    setActiveKpi(filter);
    setSearch("");
    if (filter === "attention") {
      setAttentionOnly(true);
      setStageFilter("all");
      return;
    }
    setAttentionOnly(false);
    if (filter === "pipeline") setStageFilter("all");
    else if (filter === "credentials") setStageFilter("credentials");
    else setStageFilter("all");
  }

  function clearFilters() {
    setSearch("");
    setStageFilter("all");
    setAttentionOnly(false);
    setActiveKpi(null);
  }

  return (
    <>
      <div className="space-y-5 pb-10">
        <div className="flex flex-wrap items-center gap-4 border-b pb-4">
          <div>
            <h1 className="text-[22px] font-black tracking-tight" style={{ color: TEXT }}>Staff Onboarding</h1>
            <p className="mt-0.5 text-[11px] font-medium" style={{ color: MUTED }}>Manage candidates from interview through activation.</p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {pipelineQuery.dataUpdatedAt > 0 && (
              <span className="hidden items-center gap-1.5 text-[10px] font-medium sm:flex" style={{ color: MUTED }}>
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: SUCCESS }} />
                Updated {new Date(pipelineQuery.dataUpdatedAt).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}
              </span>
            )}
            <button
              onClick={() => setShowNew(true)}
              className="rounded-full px-5 py-2.5 text-[12px] font-black text-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
              style={{ background: PLUM }}
            >
              <span className="inline-flex items-center gap-1.5"><UserPlus size={14} /> New candidate</span>
            </button>
          </div>
        </div>

        {pipelineQuery.isLoading ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[1, 2, 3, 4].map((i) => <div key={i} className="h-28 animate-pulse rounded-[1.25rem]" style={{ background: SOFT }} />)}
            </div>
            <div className="flex gap-3 overflow-hidden">
              {[1, 2, 3, 4, 5].map((i) => <div key={i} className="h-[420px] min-w-[250px] flex-1 animate-pulse rounded-[1.25rem]" style={{ background: SOFT }} />)}
            </div>
          </div>
        ) : !data ? (
          <div className="rounded-2xl border p-8 text-center" style={{ borderColor: BORDER }}>
            <p className="font-black" style={{ color: TEXT }}>Could not load Staff Onboarding</p>
            <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>Reload the page to try again.</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <KpiTile label="In Progress" value={inPipelineCount} color={PLUM} bg="var(--cc-plum-soft)" active={activeKpi === "pipeline"} onClick={() => setKpiFilter("pipeline")} icon={Briefcase} />
              <KpiTile label="Credentials Overdue" value={data.kpis.credentials_overdue} color={AMBER} bg="#FFF3E0" active={activeKpi === "credentials"} onClick={() => setKpiFilter("credentials")} icon={AlertCircle} />
              <KpiTile label="Starting This Week" value={data.kpis.starting_this_week} color={GREEN} bg="#EAF3DE" active={activeKpi === "starting"} onClick={() => { setActiveKpi("starting"); setAttentionOnly(false); setStageFilter("all"); }} icon={CalendarDays} />
              <KpiTile label="Auto-Deactivated / Month" value={data.kpis.auto_deactivated_month} color={TEXT} bg={SOFT} active={activeKpi === "deactivated"} onClick={() => { setActiveKpi("deactivated"); setAttentionOnly(false); setStageFilter("all"); setNotProceedingOpen(true); }} icon={Clock} />
            </div>

            <div className="flex flex-col gap-3 rounded-[1.25rem] border bg-white p-3 sm:flex-row sm:items-center" style={{ borderColor: BORDER }}>
              <div className="relative min-w-0 flex-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
                <Input value={search} onChange={(e) => { setSearch(e.target.value); setActiveKpi(null); }} placeholder="Search candidates..." className="h-10 rounded-xl border-0 bg-[#F8F7F4] pl-9 text-[12px] shadow-none focus-visible:ring-1" />
                {search && <button onClick={() => setSearch("")} className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-1 hover:bg-black/5"><X size={13} style={{ color: MUTED }} /></button>}
              </div>
              <Select value={stageFilter} onValueChange={(value) => { setStageFilter(value); setActiveKpi(null); }}>
                <SelectTrigger className="h-10 w-full rounded-xl border-0 bg-[#F8F7F4] text-[12px] shadow-none sm:w-[150px]"><SlidersHorizontal size={14} className="mr-1.5" /><SelectValue placeholder="All stages" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All stages</SelectItem>
                  <SelectItem value="applied">Applied</SelectItem>
                  <SelectItem value="interview">Interview</SelectItem>
                  <SelectItem value="offer_extended">Offer letter</SelectItem>
                  <SelectItem value="credentials">Credentials</SelectItem>
                  <SelectItem value="training">Training</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                </SelectContent>
              </Select>
              <button onClick={() => { setAttentionOnly((v) => !v); setActiveKpi(attentionOnly ? null : "attention"); }} className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3.5 text-[11px] font-black transition-all" style={{ background: attentionOnly ? WARNING_BG : SOFT, color: attentionOnly ? WARNING : MUTED }}>
                <AlertCircle size={13} /> Needs attention
              </button>
              {(search || stageFilter !== "all" || attentionOnly || activeKpi) && (
                <button onClick={clearFilters} className="flex h-10 shrink-0 items-center justify-center gap-1 rounded-xl px-3 text-[11px] font-bold hover:bg-black/5" style={{ color: MUTED }}>
                  <X size={13} /> Clear
                </button>
              )}
              <div className="flex h-10 shrink-0 items-center gap-0.5 rounded-xl p-1" style={{ background: "#F8F7F4" }}>
                <button
                  onClick={() => setView("kanban")}
                  aria-pressed={view === "kanban"}
                  title="Board view"
                  className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-black transition-all"
                  style={{ background: view === "kanban" ? "white" : "transparent", color: view === "kanban" ? PLUM : MUTED, boxShadow: view === "kanban" ? "var(--cc-shadow-sm)" : "none" }}
                >
                  <LayoutGrid size={13} /> Board
                </button>
                <button
                  onClick={() => setView("list")}
                  aria-pressed={view === "list"}
                  title="List view"
                  className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-black transition-all"
                  style={{ background: view === "list" ? "white" : "transparent", color: view === "list" ? PLUM : MUTED, boxShadow: view === "list" ? "var(--cc-shadow-sm)" : "none" }}
                >
                  <Rows3 size={13} /> List
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-4 px-1">
              <div className="flex min-w-0 items-center gap-2">
                <p className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>Onboarding flow</p>
                <div className="hidden items-center gap-1 md:flex">
                  {[["Interview", STAGE_COLOR.interview], ["Offer", STAGE_COLOR.offer_extended], ["Credentials", STAGE_COLOR.credentials], ["Training", STAGE_COLOR.training], ["Active", STAGE_COLOR.active]].map(([label, color], i) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
                      <span className="text-[9px] font-bold" style={{ color: MUTED }}>{label}</span>
                      {i < 4 && <ArrowRight size={10} style={{ color: BORDER }} />}
                    </div>
                  ))}
                </div>
              </div>
              <span className="text-[10px] font-medium" style={{ color: MUTED }}>{listRows.length} visible</span>
            </div>

            <div className="flex items-start gap-2.5 rounded-2xl border px-4 py-3" style={{ background: "var(--cc-plum-soft)", borderColor: "#D9D2F8" }}>
              <Settings2 size={14} style={{ color: PLUM }} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <button onClick={() => setRulesOpen((v) => !v)} className="flex w-full items-center gap-2 text-left">
                  <p className="text-[12px] font-medium" style={{ color: TEXT }}><span className="font-black">System rules</span> <span className="hidden sm:inline">· reminders and inactivity controls</span></p>
                  {rulesOpen ? <ChevronUp size={14} className="ml-auto shrink-0" style={{ color: PLUM }} /> : <ChevronDown size={14} className="ml-auto shrink-0" style={{ color: PLUM }} />}
                </button>
                {rulesOpen && <p className="mt-2 border-t pt-2 text-[11px] leading-5" style={{ color: MUTED, borderColor: "#D9D2F8" }}>Reminders sent automatically at 3 days if credentials or training are incomplete · accounts auto-deactivated after 14 days of inactivity.</p>}
              </div>
            </div>

            {view === "kanban" ? (
              <DndContext
                sensors={sensors}
                onDragStart={handleDragStart}
                onDragEnd={handleDragEnd}
                onDragOver={(e) => setOverStage((e.over?.id as ApplicantStage) ?? null)}
              >
                <div className="flex gap-3 overflow-x-auto pb-3 [scrollbar-width:thin] snap-x snap-mandatory">
                  <DroppableColumn id="interview" label="Interview" count={filteredInterviewApplicants.length} color={STAGE_COLOR.interview} disabled={false} isOver={overStage === "interview"}>
                    {filteredInterviewApplicants.map((a) => (
                      <ApplicantCard key={a.id} applicant={a} onReject={() => setPendingReject(a)} onOpen={() => setOpenApplicantId(a.id)} />
                    ))}
                  </DroppableColumn>

                  <DroppableColumn
                    id="offer_extended"
                    label="Offer letter"
                    count={filteredOfferLetters.length}
                    color={STAGE_COLOR.offer_extended}
                    disabled={!isHireManager}
                    isOver={overStage === "offer_extended"}
                  >
                    {filteredOfferLetters.map((h) => (
                      <OfferLetterCard key={h.id} hire={h} onOpen={() => setOpenHireId(h.id)} />
                    ))}
                  </DroppableColumn>

                  <StaticColumn label="Credentials" count={filteredCredentials.length} color={STAGE_COLOR.credentials}>
                    {filteredCredentials.map((p) => (
                      <OversightCard key={p.id} columnKey="credentials" person={p} onOpen={() => openWorker(p.id, "credentials")} />
                    ))}
                  </StaticColumn>

                  <StaticColumn label="Training" count={filteredTraining.length} color={STAGE_COLOR.training}>
                    {filteredTraining.map((p) => (
                      <OversightCard key={p.id} columnKey="training" person={p} onOpen={() => openWorker(p.id, "training")} />
                    ))}
                  </StaticColumn>

                  <StaticColumn label="Active" count={filteredActive.length} color={STAGE_COLOR.active}>
                    {filteredActive.map((p) => (
                      <OversightCard key={p.id} columnKey="active" person={p} onOpen={() => openWorker(p.id, "overview")} />
                    ))}
                  </StaticColumn>
                </div>
                <DragOverlay dropAnimation={null}>
                  {activeApplicant ? <ApplicantDragClone applicant={activeApplicant} /> : null}
                </DragOverlay>
              </DndContext>
            ) : (
              <PipelineListView rows={listRows} sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
            )}

            <div className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
              <button onClick={() => setNotProceedingOpen((v) => !v)} className="flex w-full items-center gap-2 px-5 py-4 transition-colors hover:bg-black/[0.015]">
                <p className="text-[12px] font-black" style={{ color: MUTED }}>Not proceeding</p>
                <span className="rounded-full px-2 py-0.5 text-[10px] font-black" style={{ background: SOFT, color: MUTED }}>{notProceedingCount}</span>
                {notProceedingOpen ? <ChevronUp size={14} className="ml-auto" style={{ color: MUTED }} /> : <ChevronDown size={14} className="ml-auto" style={{ color: MUTED }} />}
              </button>
              {notProceedingOpen && (
                <div className="grid gap-2 border-t px-5 py-4 sm:grid-cols-2 lg:grid-cols-3" style={{ borderColor: BORDER }}>
                  {notProceedingCount === 0 && (
                    <p className="text-[12px] font-medium" style={{ color: MUTED }}>Nobody has dropped out of onboarding.</p>
                  )}
                  {data.not_proceeding.rejected_applicants.map((p) => (
                    <div key={p.id} className="rounded-2xl border-l-[3px] p-3 opacity-70" style={{ borderColor: BORDER, borderLeftColor: "#C8C4BC", background: SOFT }}>
                      <p className="text-[11px] font-bold" style={{ color: TEXT }}>{p.full_name}</p>
                      <p className="text-[10px] font-medium" style={{ color: MUTED }}>Rejected</p>
                    </div>
                  ))}
                  {data.not_proceeding.expired_offers.map((p) => (
                    <div key={p.id} className="rounded-2xl border-l-[3px] p-3 opacity-70" style={{ borderColor: BORDER, borderLeftColor: "#C8C4BC", background: SOFT }}>
                      <p className="text-[11px] font-bold" style={{ color: TEXT }}>{p.full_name}</p>
                      <p className="text-[10px] font-medium" style={{ color: MUTED }}>Offer expired</p>
                    </div>
                  ))}
                  {data.not_proceeding.auto_deactivated_workers.map((p) => (
                    <div key={p.id} className="rounded-2xl border-l-[3px] p-3 opacity-70" style={{ borderColor: BORDER, borderLeftColor: "#C8C4BC", background: SOFT }}>
                      <p className="text-[11px] font-bold" style={{ color: TEXT }}>{p.full_name}</p>
                      <p className="text-[10px] font-medium" style={{ color: MUTED }}>Auto-deactivated</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {showNew && (
        <NewApplicantSheet
          onClose={() => setShowNew(false)}
          onCreated={() => { setShowNew(false); qc.invalidateQueries({ queryKey: ["applicants"] }); }}
        />
      )}

      {openApplicant && (
        <ApplicantDetailSheet
          applicant={openApplicant}
          applicants={interviewApplicants}
          onClose={() => setOpenApplicantId(null)}
          onNavigate={setOpenApplicantId}
          isHireManager={isHireManager}
          movePending={stageMut.isPending}
          onMoveStage={(stage) => handleMoveStage(openApplicant, stage)}
          onReject={() => setPendingReject(openApplicant)}
        />
      )}

      {pendingOffer && (
        <ConfirmOfferModal
          applicant={pendingOffer}
          confirming={stageMut.isPending}
          onCancel={() => setPendingOffer(null)}
          onConfirm={() => { stageMut.mutate({ id: pendingOffer.id, stage: "offer_extended" }); setPendingOffer(null); }}
        />
      )}

      {pendingReject && (
        <RejectModal
          applicant={pendingReject}
          confirming={stageMut.isPending}
          onCancel={() => setPendingReject(null)}
          onConfirm={(reason) => { stageMut.mutate({ id: pendingReject.id, stage: "rejected", reason }); setPendingReject(null); }}
        />
      )}

      <Sheet open={!!openHireId} onOpenChange={(open) => { if (!open) setOpenHireId(null); }}>
        <SheetContent side="right" className="w-full overflow-hidden p-0 sm:max-w-3xl" style={{ background: SURFACE }}>
          {openHireId && (
            <HireDetail
              hireId={openHireId}
              hires={data?.columns.offer_letter ?? []}
              onNavigate={setOpenHireId}
              requireReAuth={requireReAuth}
            />
          )}
        </SheetContent>
      </Sheet>
      {reauthModal}
    </>
  );
}