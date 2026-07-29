import { useState } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, UserPlus, FileText, Send, CheckCircle2, Clock3, Copy, Trash2,
  Upload, Loader2, ChevronRight, Mail,
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

const STATUS_META: Record<EmployeeHire["status"], { label: string; bg: string; color: string }> = {
  draft: { label: "Draft", bg: "var(--cc-soft)", color: "var(--cc-muted)" },
  awaiting_signatures: { label: "Awaiting signatures", bg: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)" },
  signed: { label: "Signed — ready to invite", bg: "var(--cc-status-info-bg)", color: "var(--cc-status-info)" },
  invited: { label: "Invite sent", bg: "var(--cc-status-success-bg)", color: "var(--cc-status-success)" },
  completed: { label: "Onboarded", bg: "var(--cc-status-success-bg)", color: "var(--cc-status-success)" },
};

const DOC_TYPE_LABELS: Record<string, string> = {
  offer_letter: "Offer letter",
  service_agreement: "Service agreement",
  other: "Other",
};

function StatusBadge({ status }: { status: EmployeeHire["status"] }) {
  const meta = STATUS_META[status];
  return (
    <span className="text-[10px] font-black px-2.5 py-1 rounded-full" style={{ background: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  );
}

export default function OnboardEmployeePage() {
  const { translate } = useAccessibility();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { requireReAuth, modal: reauthModal } = useReAuth();

  const [selectedHireId, setSelectedHireId] = useState<string | null>(null);
  const [newHireOpen, setNewHireOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState("support_worker");

  const hiresQuery = useQuery({ queryKey: ["employee-hires"], queryFn: listHires });
  const hires = hiresQuery.data ?? [];

  const createMut = useMutation({
    mutationFn: () => createHire({ full_name: fullName.trim(), email: email.trim(), phone: phone.trim() || undefined, role }),
    onSuccess: (hire) => {
      qc.invalidateQueries({ queryKey: ["employee-hires"] });
      toast({ title: "New hire created" });
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

  return (
    <HubLayout>
      <div className="space-y-6 pb-10">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/hub")}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black transition-colors hover:bg-white"
            style={{ color: MUTED, background: SOFT }}
          >
            <ArrowLeft size={13} strokeWidth={2.5} /> {translate("md.backToHub")}
          </button>
          <div>
            <h1 className="text-xl font-black" style={{ color: TEXT }}>Onboard Employee</h1>
            <p className="text-[12px] font-medium" style={{ color: MUTED }}>
              Create a new hire, send the offer letter and service agreement for signature, then send their login invite.
            </p>
          </div>
          <Button variant="navy" className="ml-auto gap-2 rounded-full" onClick={() => setNewHireOpen(true)}>
            <UserPlus size={15} /> New Hire
          </Button>
        </div>

        {hiresQuery.isLoading && <p className="text-sm" style={{ color: MUTED }}>Loading…</p>}

        {!hiresQuery.isLoading && hires.length === 0 && (
          <div className="rounded-2xl p-10 text-center" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
            <UserPlus size={32} className="mx-auto mb-3" style={{ color: MUTED }} />
            <p className="text-sm font-bold" style={{ color: MUTED }}>No new hires yet. Click "New Hire" to get started.</p>
          </div>
        )}

        {hires.length > 0 && (
          <div className="rounded-2xl divide-y" style={{ background: SURFACE, boxShadow: CARD_SHADOW, borderColor: BORDER }}>
            {hires.map((h) => (
              <button
                key={h.id}
                onClick={() => setSelectedHireId(h.id)}
                className="w-full flex items-center justify-between gap-4 px-5 py-4 text-left transition-colors hover:bg-black/[0.02]"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="h-9 w-9 rounded-full shrink-0 flex items-center justify-center text-xs font-black" style={{ background: PLUM, color: "#fff" }}>
                    {(h.full_name || "?").charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <p className="font-bold text-sm truncate" style={{ color: TEXT }}>{h.full_name}</p>
                    <p className="text-xs truncate" style={{ color: MUTED }}>{h.email} · {h.role.replace(/_/g, " ")}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <StatusBadge status={h.status} />
                  <ChevronRight size={16} style={{ color: MUTED }} />
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
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Jordan Smith" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="jordan@example.com" />
            </div>
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
    return <p className="text-sm" style={{ color: MUTED }}>Loading…</p>;
  }

  const signLink = hire.sign_token ? `${window.location.origin}/onboarding-sign?token=${hire.sign_token}` : null;

  return (
    <div className="space-y-4 pb-10">
      <button onClick={onBack} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-bold" style={{ color: PLUM }}>
        <ArrowLeft size={15} /> Back to hires
      </button>

      <div className="rounded-2xl p-5" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full shrink-0 flex items-center justify-center text-base font-black" style={{ background: PLUM, color: "#fff" }}>
              {(hire.full_name || "?").charAt(0).toUpperCase()}
            </div>
            <div>
              <h2 className="text-lg font-black" style={{ color: TEXT }}>{hire.full_name}</h2>
              <p className="text-xs" style={{ color: MUTED }}>{hire.email} · {hire.role.replace(/_/g, " ")}{hire.phone ? ` · ${hire.phone}` : ""}</p>
            </div>
          </div>
          <StatusBadge status={hire.status} />
        </div>
      </div>

      {/* Documents */}
      <div className="rounded-2xl p-5 space-y-3" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-black" style={{ color: TEXT }}>Documents</p>
          {hire.status === "draft" && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAddDocOpen(true)}>
              <FileText size={13} /> Add document
            </Button>
          )}
        </div>
        {documents.length === 0 ? (
          <p className="text-xs" style={{ color: MUTED }}>No documents attached yet. Add the offer letter and service agreement before sending for signature.</p>
        ) : (
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {documents.map((d: OnboardingDocument) => (
              <div key={d.id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-bold" style={{ color: TEXT }}>{d.title}</p>
                  <p className="text-xs" style={{ color: MUTED }}>{DOC_TYPE_LABELS[d.document_type] ?? d.document_type}{d.file_url ? " · file attached" : ""}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {d.file_url && (
                    <a href={d.file_url} target="_blank" rel="noreferrer" className="text-xs font-bold underline" style={{ color: PLUM }}>View</a>
                  )}
                  {hire.status === "draft" && (
                    <button onClick={() => removeDocMut.mutate(d.id)} className="rounded-lg p-1.5 hover:bg-black/5" aria-label="Remove document">
                      <Trash2 size={13} style={{ color: MUTED }} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Signatures */}
      <div className="rounded-2xl p-5 space-y-3" style={{ background: SURFACE, boxShadow: CARD_SHADOW }}>
        <p className="text-sm font-black" style={{ color: TEXT }}>Signatures</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-xl p-3" style={{ background: SOFT }}>
            <p className="text-[10px] font-bold uppercase" style={{ color: MUTED }}>Employer</p>
            {hire.employer_signed_at ? (
              <p className="text-xs font-bold mt-1 flex items-center gap-1.5" style={{ color: "var(--cc-status-success)" }}>
                <CheckCircle2 size={13} /> {hire.employer_signed_name}
              </p>
            ) : (
              <p className="text-xs mt-1 flex items-center gap-1.5" style={{ color: MUTED }}><Clock3 size={13} /> Not yet sent</p>
            )}
          </div>
          <div className="rounded-xl p-3" style={{ background: SOFT }}>
            <p className="text-[10px] font-bold uppercase" style={{ color: MUTED }}>New hire</p>
            {hire.worker_signed_at ? (
              <p className="text-xs font-bold mt-1 flex items-center gap-1.5" style={{ color: "var(--cc-status-success)" }}>
                <CheckCircle2 size={13} /> {hire.worker_signed_name}
              </p>
            ) : (
              <p className="text-xs mt-1 flex items-center gap-1.5" style={{ color: MUTED }}><Clock3 size={13} /> Awaiting signature</p>
            )}
          </div>
        </div>

        {hire.status === "draft" && (
          <Button variant="navy" className="w-full gap-2 rounded-xl" onClick={() => sendSignatureMut.mutate()} disabled={sendSignatureMut.isPending || documents.length === 0}>
            {sendSignatureMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send for signature
          </Button>
        )}

        {hire.status === "awaiting_signatures" && signLink && (
          <div className="flex items-center gap-2 rounded-xl p-3" style={{ background: "var(--cc-status-warning-bg)" }}>
            <Mail size={14} style={{ color: "var(--cc-status-warning)" }} />
            <p className="text-xs flex-1" style={{ color: TEXT }}>Emailed to {hire.email}. Waiting for their signature.</p>
            <button
              onClick={() => { navigator.clipboard.writeText(signLink); toast({ title: "Sign link copied" }); }}
              className="rounded-lg p-1.5 hover:bg-black/5"
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
          <p className="text-xs font-bold flex items-center gap-1.5" style={{ color: "var(--cc-status-success)" }}>
            <CheckCircle2 size={14} /> Login invite sent — {hire.status === "completed" ? "account activated." : "waiting for them to set up their account."}
          </p>
        )}
      </div>

      <Dialog open={addDocOpen} onOpenChange={setAddDocOpen}>
        <DialogContent className="sm:max-w-md rounded-2xl" style={{ background: SURFACE }}>
          <DialogHeader>
            <DialogTitle style={{ color: TEXT }}>Add document</DialogTitle>
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
              <Input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="e.g. Offer of Employment" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Notes (optional)</label>
              <Input value={docNotes} onChange={(e) => setDocNotes(e.target.value)} placeholder="Any context for this document" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>File (PDF or image, optional)</label>
              <label className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm cursor-pointer" style={{ borderColor: BORDER, color: docFile ? TEXT : MUTED }}>
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
