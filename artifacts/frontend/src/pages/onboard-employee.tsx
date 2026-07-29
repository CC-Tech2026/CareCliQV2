import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, UserPlus, FileText, FileSignature, Send, CheckCircle2, Clock3,
  Copy, Trash2, Upload, Loader2, ChevronRight, Mail, Briefcase,
  ClipboardCheck, PenLine, MailCheck, Search, ShieldCheck,
} from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { useReAuth } from "@/hooks/useReAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  listHires, createHire, getHire, addHireDocument, uploadHireDocumentFile,
  deleteHireDocument, sendForSignature, sendHireInvite,
  type EmployeeHire, type OnboardingDocument,
} from "@/services/employeeOnboardingService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const SURFACE = "var(--cc-surface)";
const CARD_SHADOW = "var(--cc-card-shadow)";
const SUCCESS = "var(--cc-status-success)";
const SUCCESS_BG = "var(--cc-status-success-bg)";
const WARNING = "var(--cc-status-warning)";
const WARNING_BG = "var(--cc-status-warning-bg)";
const INFO = "var(--cc-status-info)";
const INFO_BG = "var(--cc-status-info-bg)";

const STATUS_META: Record<EmployeeHire["status"], { label: string; bg: string; color: string }> = {
  draft: { label: "Draft", bg: SOFT, color: MUTED },
  awaiting_signatures: { label: "Awaiting signatures", bg: WARNING_BG, color: WARNING },
  signed: { label: "Ready to invite", bg: INFO_BG, color: INFO },
  invited: { label: "Invite sent", bg: SUCCESS_BG, color: SUCCESS },
  completed: { label: "Onboarded", bg: SUCCESS_BG, color: SUCCESS },
};

const DOC_TYPE_META: Record<string, { label: string; icon: typeof FileText }> = {
  offer_letter: { label: "Offer letter", icon: Briefcase },
  service_agreement: { label: "Service agreement", icon: ClipboardCheck },
  other: { label: "Other", icon: FileText },
};

// Four-stage journey shown as a stepper everywhere in this flow.
const STEPS = [
  { key: "details", label: "Details", icon: UserPlus },
  { key: "documents", label: "Documents", icon: FileSignature },
  { key: "signatures", label: "Signatures", icon: PenLine },
  { key: "invite", label: "Invite sent", icon: MailCheck },
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

function initials(name: string) {
  return (name || "?")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <div
      className="rounded-full shrink-0 flex items-center justify-center font-black text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: PLUM }}
    >
      {initials(name)}
    </div>
  );
}

function StatTile({
  icon: Icon, label, count, color,
}: {
  icon: typeof UserPlus;
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div
      className="rounded-xl p-4 flex items-center gap-3.5"
      style={{ background: SURFACE, boxShadow: CARD_SHADOW, borderLeft: `3px solid ${color}` }}
    >
      <div className="h-9 w-9 rounded-lg shrink-0 flex items-center justify-center" style={{ background: SOFT, color }}>
        <Icon size={16} />
      </div>
      <div className="min-w-0">
        <p className="text-xl font-black leading-none" style={{ color: TEXT }}>{count}</p>
        <p className="text-[11px] font-bold mt-1" style={{ color: MUTED }}>{label}</p>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: EmployeeHire["status"] }) {
  const meta = STATUS_META[status];
  return (
    <span className="text-[10px] font-black px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  );
}

/** Compact dot-progress used on list rows. */
function MiniProgress({ status }: { status: EmployeeHire["status"] }) {
  const active = stepIndexForStatus(status);
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((s, i) => (
        <span
          key={s.key}
          className="h-1.5 rounded-full transition-all"
          style={{
            width: i === active ? 16 : 6,
            background: i <= active ? PLUM : BORDER,
          }}
        />
      ))}
    </div>
  );
}

/** Full labeled stepper used at the top of the detail view. */
function HireStepper({ status }: { status: EmployeeHire["status"] }) {
  const active = stepIndexForStatus(status);
  return (
    <div className="flex items-center">
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = i < active;
        const current = i === active;
        return (
          <div key={s.key} className="flex items-center flex-1 last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <div
                className="h-9 w-9 rounded-full flex items-center justify-center transition-colors"
                style={{
                  background: done ? SUCCESS_BG : current ? "var(--cc-active-bg)" : SOFT,
                  color: done ? SUCCESS : current ? PLUM : MUTED,
                  boxShadow: current ? `0 0 0 3px color-mix(in srgb, ${PLUM} 18%, transparent)` : "none",
                }}
              >
                {done ? <CheckCircle2 size={16} /> : <Icon size={15} />}
              </div>
              <span className="text-[10px] font-bold whitespace-nowrap" style={{ color: current ? TEXT : MUTED }}>
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className="flex-1 h-[2px] mx-1.5 mb-4" style={{ background: i < active ? SUCCESS : BORDER }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function OnboardEmployeePage() {
  const { translate } = useAccessibility();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { requireReAuth, modal: reauthModal } = useReAuth();

  const [selectedHireId, setSelectedHireId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newHireOpen, setNewHireOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("support_worker");

  const hiresQuery = useQuery({ queryKey: ["employee-hires"], queryFn: listHires });
  const hires = hiresQuery.data ?? [];
  const filteredHires = hires.filter((h) => {
    const q = search.trim().toLowerCase();
    return !q || h.full_name.toLowerCase().includes(q) || h.email.toLowerCase().includes(q);
  });

  const createMut = useMutation({
    mutationFn: () => createHire({ full_name: fullName.trim(), email: email.trim(), phone: phone.trim() || undefined, role }),
    onSuccess: (hire) => {
      qc.invalidateQueries({ queryKey: ["employee-hires"] });
      toast({ title: "New hire created", description: `${hire.full_name} is ready for their offer documents.` });
      setNewHireOpen(false);
      setFullName(""); setEmail(""); setPhone(""); setRole("support_worker");
      setSelectedHireId(hire.id);
    },
    onError: (e: Error) => toast({ title: "Could not create hire", description: e.message, variant: "destructive" }),
  });

  const selected = selectedHireId ? hires.find((h) => h.id === selectedHireId) ?? null : null;

  if (selected) {
    return (
      <HubLayout>
        <HireDetail
          hireId={selected.id}
          onBack={() => setSelectedHireId(null)}
          requireReAuth={requireReAuth}
        />
        {reauthModal}
      </HubLayout>
    );
  }

  const draftCount = hires.filter((h) => h.status === "draft").length;
  const awaitingCount = hires.filter((h) => h.status === "awaiting_signatures").length;
  const readyCount = hires.filter((h) => h.status === "signed").length;

  return (
    <HubLayout>
      <div className="space-y-6 pb-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <button
              onClick={() => navigate("/hub")}
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11px] font-black transition-colors hover:bg-black/5 -ml-2.5"
              style={{ color: MUTED }}
            >
              <ArrowLeft size={13} strokeWidth={2.5} /> {translate("md.backToHub")}
            </button>
            <h1 className="text-2xl font-black tracking-tight mt-1" style={{ color: TEXT }}>Onboard Employee</h1>
            <p className="text-[13px] font-medium mt-0.5" style={{ color: MUTED }}>
              Send the offer letter and service agreement for signature, then activate their CareCliQ login.
            </p>
          </div>
          <Button variant="navy" className="gap-2 rounded-lg" onClick={() => setNewHireOpen(true)}>
            <UserPlus size={15} /> New Hire
          </Button>
        </div>

        {hires.length > 0 && (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <StatTile icon={UserPlus} label="Draft" count={draftCount} color={MUTED} />
              <StatTile icon={PenLine} label="Awaiting signatures" count={awaitingCount} color={WARNING} />
              <StatTile icon={MailCheck} label="Ready to invite" count={readyCount} color={INFO} />
            </div>

            <div className="relative max-w-sm">
              <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search new hires…" className="pl-9 rounded-lg" />
            </div>
          </>
        )}

        {hiresQuery.isLoading && (
          <div className="space-y-3">
            {[1, 2].map((i) => <div key={i} className="h-20 rounded-2xl animate-pulse" style={{ background: SOFT }} />)}
          </div>
        )}

        {!hiresQuery.isLoading && hires.length === 0 && (
          <div className="rounded-2xl p-12 text-center" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
            <div className="mx-auto mb-4 h-14 w-14 rounded-2xl flex items-center justify-center" style={{ background: "var(--cc-active-bg)" }}>
              <UserPlus size={26} style={{ color: PLUM }} />
            </div>
            <p className="text-base font-black" style={{ color: TEXT }}>No new hires yet</p>
            <p className="text-sm mt-1 max-w-sm mx-auto" style={{ color: MUTED }}>
              Create your first hire to send an offer letter and service agreement for signature.
            </p>
            <Button variant="navy" className="mt-5 gap-2 rounded-full" onClick={() => setNewHireOpen(true)}>
              <UserPlus size={15} /> New Hire
            </Button>
          </div>
        )}

        {!hiresQuery.isLoading && hires.length > 0 && filteredHires.length === 0 && (
          <div className="rounded-2xl p-10 text-center" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
            <Search size={26} className="mx-auto mb-2" style={{ color: MUTED }} />
            <p className="text-sm font-bold" style={{ color: MUTED }}>No hires match "{search}".</p>
          </div>
        )}

        {filteredHires.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2">
            {filteredHires.map((h) => (
              <button
                key={h.id}
                onClick={() => setSelectedHireId(h.id)}
                className="text-left rounded-2xl p-4 transition-all hover:shadow-md hover:-translate-y-0.5"
                style={{ background: SURFACE, boxShadow: CARD_SHADOW }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar name={h.full_name} />
                    <div className="min-w-0">
                      <p className="font-bold text-sm truncate" style={{ color: TEXT }}>{h.full_name}</p>
                      <p className="text-xs truncate" style={{ color: MUTED }}>{h.email}</p>
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: MUTED }} className="shrink-0 mt-1" />
                </div>
                <div className="mt-3.5 flex items-center justify-between gap-2">
                  <MiniProgress status={h.status} />
                  <StatusBadge status={h.status} />
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      <Dialog open={newHireOpen} onOpenChange={setNewHireOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl" style={{ background: SURFACE }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" style={{ color: TEXT }}>
              <UserPlus size={18} style={{ color: PLUM }} /> New Hire
            </DialogTitle>
          </DialogHeader>
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
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="support_worker">Support Worker</SelectItem>
                    <SelectItem value="support_coordinator">Support Coordinator</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setNewHireOpen(false)}>Cancel</Button>
            <Button
              variant="navy"
              onClick={() => createMut.mutate()}
              disabled={!fullName.trim() || !email.trim() || createMut.isPending}
            >
              {createMut.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null} Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </HubLayout>
  );
}

function HireDetail({
  hireId, onBack, requireReAuth,
}: {
  hireId: string;
  onBack: () => void;
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
    qc.invalidateQueries({ queryKey: ["employee-hires"] });
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
      <div className="space-y-4 pb-10 max-w-2xl mx-auto">
        <div className="h-32 rounded-2xl animate-pulse" style={{ background: SOFT }} />
        <div className="h-40 rounded-2xl animate-pulse" style={{ background: SOFT }} />
      </div>
    );
  }

  const signLink = hire.sign_token ? `${window.location.origin}/onboarding-sign?token=${hire.sign_token}` : null;

  return (
    <div className="space-y-4 pb-10 max-w-2xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-bold" style={{ color: PLUM }}>
        <ArrowLeft size={15} /> Back to hires
      </button>

      {/* Hero + stepper */}
      <div className="rounded-2xl p-5 space-y-5" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar name={hire.full_name} size={48} />
            <div className="min-w-0">
              <h2 className="text-lg font-black truncate" style={{ color: TEXT }}>{hire.full_name}</h2>
              <p className="text-xs truncate" style={{ color: MUTED }}>
                {hire.email} · {hire.role.replace(/_/g, " ")}{hire.phone ? ` · ${hire.phone}` : ""}
              </p>
            </div>
          </div>
          <StatusBadge status={hire.status} />
        </div>
        <HireStepper status={hire.status} />
      </div>

      {/* Documents */}
      <div className="rounded-2xl p-5 space-y-3" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSignature size={16} style={{ color: PLUM }} />
            <p className="text-sm font-black" style={{ color: TEXT }}>Documents</p>
          </div>
          {hire.status === "draft" && (
            <Button variant="outline" size="sm" className="gap-1.5 rounded-lg" onClick={() => setAddDocOpen(true)}>
              <FileText size={13} /> Add document
            </Button>
          )}
        </div>
        {documents.length === 0 ? (
          <div className="rounded-xl p-5 text-center" style={{ background: SOFT }}>
            <p className="text-xs font-medium" style={{ color: MUTED }}>
              No documents attached yet. Add the offer letter and service agreement before sending for signature.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((d: OnboardingDocument) => {
              const meta = DOC_TYPE_META[d.document_type] ?? DOC_TYPE_META.other;
              const Icon = meta.icon;
              return (
                <div key={d.id} className="flex items-center justify-between gap-3 rounded-xl p-3" style={{ background: SOFT }}>
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-9 w-9 rounded-lg shrink-0 flex items-center justify-center" style={{ background: "var(--cc-active-bg)", color: PLUM }}>
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

      {/* Signatures */}
      <div className="rounded-2xl p-5 space-y-3" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
        <div className="flex items-center gap-2">
          <PenLine size={16} style={{ color: PLUM }} />
          <p className="text-sm font-black" style={{ color: TEXT }}>Signatures</p>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <SignatureCard label="Employer" signedName={hire.employer_signed_name} signedAt={hire.employer_signed_at} pendingLabel="Not yet sent" />
          <SignatureCard label="New hire" signedName={hire.worker_signed_name} signedAt={hire.worker_signed_at} pendingLabel="Awaiting signature" />
        </div>

        {hire.status === "draft" && (
          <Button variant="navy" className="w-full gap-2 rounded-xl" onClick={() => sendSignatureMut.mutate()} disabled={sendSignatureMut.isPending || documents.length === 0}>
            {sendSignatureMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send for signature
          </Button>
        )}

        {hire.status === "awaiting_signatures" && signLink && (
          <div className="flex items-center gap-2 rounded-xl p-3" style={{ background: WARNING_BG }}>
            <Mail size={14} style={{ color: WARNING }} className="shrink-0" />
            <p className="text-xs flex-1" style={{ color: TEXT }}>Emailed to {hire.email}. Waiting for their signature.</p>
            <button
              onClick={() => { navigator.clipboard.writeText(signLink); toast({ title: "Sign link copied" }); }}
              className="rounded-lg p-1.5 hover:bg-black/5 shrink-0"
              aria-label="Copy sign link"
              title="Copy sign link"
            >
              <Copy size={13} style={{ color: MUTED }} />
            </button>
          </div>
        )}

        {hire.status === "signed" && (
          <Button variant="navy" className="w-full gap-2 rounded-xl" onClick={() => sendInviteMut.mutate()} disabled={sendInviteMut.isPending}>
            {sendInviteMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send login invite
          </Button>
        )}

        {(hire.status === "invited" || hire.status === "completed") && (
          <div className="flex items-center gap-2 rounded-xl p-3" style={{ background: SUCCESS_BG }}>
            <CheckCircle2 size={16} style={{ color: SUCCESS }} className="shrink-0" />
            <p className="text-xs font-bold" style={{ color: SUCCESS }}>
              Login invite sent — {hire.status === "completed" ? "account activated." : "waiting for them to set up their account."}
            </p>
          </div>
        )}
      </div>

      {(hire.status === "invited" || hire.status === "completed") && (
        <div className="flex items-center gap-2.5 rounded-2xl p-4" style={{ background: "var(--cc-status-info-bg)" }}>
          <ShieldCheck size={16} style={{ color: INFO }} className="shrink-0" />
          <p className="text-xs" style={{ color: TEXT }}>
            {hire.full_name.split(" ")[0]} will appear on the Workers tab once they finish setting up their account, and can't be rostered until their onboarding checklist is complete.
          </p>
        </div>
      )}

      <Dialog open={addDocOpen} onOpenChange={setAddDocOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl" style={{ background: SURFACE }}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2" style={{ color: TEXT }}>
              <FileText size={18} style={{ color: PLUM }} /> Add document
            </DialogTitle>
          </DialogHeader>
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
              <label className="flex items-center gap-2 rounded-xl border border-dashed px-3 py-3 text-sm cursor-pointer transition-colors hover:bg-black/[0.02]" style={{ borderColor: BORDER, color: docFile ? TEXT : MUTED }}>
                <Upload size={14} />
                {docFile ? docFile.name : "Choose file"}
                <input type="file" accept="application/pdf,image/jpeg,image/png" className="hidden" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
              </label>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setAddDocOpen(false)}>Cancel</Button>
            <Button variant="navy" onClick={() => addDocMut.mutate()} disabled={!docTitle.trim() || addDocMut.isPending}>
              {addDocMut.isPending ? <Loader2 size={14} className="animate-spin mr-1.5" /> : null} Save document
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function SignatureCard({
  label, signedName, signedAt, pendingLabel,
}: {
  label: string;
  signedName?: string | null;
  signedAt?: string | null;
  pendingLabel: string;
}) {
  const signed = !!signedAt;
  return (
    <div
      className="rounded-xl p-3.5"
      style={{ background: signed ? SUCCESS_BG : SOFT, border: signed ? `1px solid color-mix(in srgb, ${SUCCESS} 25%, transparent)` : "none" }}
    >
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
