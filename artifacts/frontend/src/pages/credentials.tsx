import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BadgeCheck, FileUp, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useReAuth } from "@/hooks/useReAuth";
import {
  createCredential,
  deleteCredential,
  listMyCredentials,
  listTeamCredentials,
  reviewCredential,
  uploadCredentialFile,
  type Credential,
} from "@/services/credentialsService";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";

const WORKER_TYPES = [
  "NDIS Worker Screening",
  "Police Check",
  "First Aid",
  "CPR",
  "Working With Children",
  "Driver Licence",
  "Other",
];

const ALLIED_TYPES = [
  "AHPRA Registration",
  "Professional Indemnity Insurance",
  "Police Check",
  "First Aid/CPR",
  "Discipline-specific Certificate",
  "Other",
];

function statusClass(status: string) {
  if (status === "valid") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "expiring") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "expired" || status === "rejected") return "bg-red-50 text-red-700 border-red-200";
  return "bg-[#F5F3FC] text-[#5533CC] border-[#E2DEF2]";
}

function CredentialRow({
  credential,
  coordinator,
  onUpload,
  onDelete,
  onReview,
}: {
  credential: Credential;
  coordinator: boolean;
  onUpload: (credential: Credential, file: File) => void;
  onDelete: (credential: Credential) => void;
  onReview: (credential: Credential, status: "valid" | "rejected") => void;
}) {
  return (
    <div className="grid gap-3 border-b border-[#EEEAFB] py-4 last:border-0 lg:grid-cols-[1fr_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-black text-[#1E1640]">{credential.title}</p>
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase ${statusClass(credential.status)}`}>
            {credential.status.replace("_", " ")}
          </span>
        </div>
        <p className="mt-1 text-xs font-medium text-[#7A6A9E]">
          {credential.credential_type}
          {credential.issuer ? ` • ${credential.issuer}` : ""}
          {credential.expiry_date ? ` • expires ${credential.expiry_date}` : ""}
        </p>
        {credential.user && (
          <p className="mt-1 text-xs text-[#7A6A9E]">
            {credential.user.full_name || credential.user.email} • {credential.user.role?.replace("_", " ")}
          </p>
        )}
        {credential.file_url && (
          <a href={credential.file_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-bold text-[#5533CC]">
            View uploaded document
          </a>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {!coordinator && credential.status !== "valid" && (
          <>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[#E2DEF2] px-3 py-2 text-xs font-bold text-[#5533CC] hover:bg-[#F8F6FE]">
              <FileUp className="h-4 w-4" />
              Upload file
              <input
                type="file"
                className="hidden"
                accept="application/pdf,image/jpeg,image/png,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onUpload(credential, file);
                }}
              />
            </label>
            <Button variant="ghost" size="sm" className="gap-1 text-[#F03060]" onClick={() => onDelete(credential)}>
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </>
        )}
        {coordinator && (
          <>
            <Button variant="outline" size="sm" className="gap-1" onClick={() => onReview(credential, "valid")}>
              <ShieldCheck className="h-3.5 w-3.5" />
              Verify
            </Button>
            <Button variant="ghost" size="sm" className="text-[#F03060]" onClick={() => onReview(credential, "rejected")}>
              Reject
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

export default function Credentials() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { requireReAuth, modal } = useReAuth();
  const queryClient = useQueryClient();
  const isCoordinator = user?.role === "support_coordinator";
  const credentialTypes = user?.role === "allied_health" ? ALLIED_TYPES : WORKER_TYPES;
  const queryKey = isCoordinator ? ["credentials", "team"] : ["credentials", "me"];
  const { data = [], isLoading, error } = useQuery({
    queryKey,
    queryFn: isCoordinator ? listTeamCredentials : listMyCredentials,
  });
  const [form, setForm] = useState({
    credential_type: credentialTypes[0],
    title: "",
    credential_number: "",
    issuer: "",
    issue_date: "",
    expiry_date: "",
  });

  const summary = useMemo(() => ({
    total: data.length,
    expiring: data.filter((item) => item.status === "expiring").length,
    expired: data.filter((item) => item.status === "expired").length,
    pending: data.filter((item) => item.status === "pending_review").length,
  }), [data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey });

  const createMutation = useMutation({
    mutationFn: createCredential,
    onSuccess: () => {
      setForm((prev) => ({ ...prev, title: "", credential_number: "", issuer: "", issue_date: "", expiry_date: "" }));
      invalidate();
      toast({ title: "Credential saved", description: "It is now in your wallet for review." });
    },
    onError: (err) => toast({ title: "Could not save credential", description: (err as Error).message, variant: "destructive" }),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ credential, file }: { credential: Credential; file: File }) => uploadCredentialFile(credential.id, file),
    onSuccess: () => {
      invalidate();
      toast({ title: "Credential file uploaded" });
    },
    onError: (err) => toast({ title: "Upload failed", description: (err as Error).message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (credential: Credential) => deleteCredential(credential.id),
    onSuccess: () => {
      invalidate();
      toast({ title: "Credential deleted" });
    },
    onError: (err) => toast({ title: "Delete failed", description: (err as Error).message, variant: "destructive" }),
  });

  const reviewMutation = useMutation({
    mutationFn: ({ credential, status }: { credential: Credential; status: "valid" | "rejected" }) =>
      requireReAuth(() => reviewCredential(credential.id, { status })),
    onSuccess: () => {
      invalidate();
      toast({ title: "Credential review saved" });
    },
    onError: (err) => toast({ title: "Review failed", description: (err as Error).message, variant: "destructive" }),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) {
      toast({ title: "Title required", variant: "destructive" });
      return;
    }
    createMutation.mutate({
      credential_type: form.credential_type,
      title: form.title,
      credential_number: form.credential_number || null,
      issuer: form.issuer || null,
      issue_date: form.issue_date || null,
      expiry_date: form.expiry_date || null,
      status: "pending_review",
    });
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      {modal}
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
          {isCoordinator ? "Organisation" : user?.role === "allied_health" ? "Allied Health" : "Support Worker"}
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>
          {isCoordinator ? "Team Credential Wallet" : "Credential Wallet"}
        </h1>
      </div>

      <div className="grid gap-3 sm:grid-cols-4">
        {[
          ["Total", summary.total],
          ["Pending review", summary.pending],
          ["Expiring", summary.expiring],
          ["Expired", summary.expired],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border bg-white p-4 shadow-sm" style={{ borderColor: BORDER }}>
            <p className="text-xs font-bold uppercase text-[#7A6A9E]">{label}</p>
            <p className="mt-1 text-2xl font-black text-[#1E1640]">{value}</p>
          </div>
        ))}
      </div>

      {!isCoordinator && (
        <form onSubmit={submit} className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <div className="mb-4 flex items-center gap-2">
            <BadgeCheck className="h-5 w-5 text-[#5533CC]" />
            <h2 className="font-black text-[#1E1640]">Add credential</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Type</Label>
              <select
                value={form.credential_type}
                onChange={(event) => setForm({ ...form, credential_type: event.target.value })}
                className="mt-1 h-10 w-full rounded-xl border border-[#E2DEF2] bg-white px-3 text-sm"
              >
                {credentialTypes.map((type) => <option key={type} value={type}>{type}</option>)}
              </select>
            </div>
            <div>
              <Label>Title</Label>
              <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-1 rounded-xl" />
            </div>
            <div>
              <Label>Credential number</Label>
              <Input value={form.credential_number} onChange={(event) => setForm({ ...form, credential_number: event.target.value })} className="mt-1 rounded-xl" />
            </div>
            <div>
              <Label>Issuer</Label>
              <Input value={form.issuer} onChange={(event) => setForm({ ...form, issuer: event.target.value })} className="mt-1 rounded-xl" />
            </div>
            <div>
              <Label>Issue date</Label>
              <Input type="date" value={form.issue_date} onChange={(event) => setForm({ ...form, issue_date: event.target.value })} className="mt-1 rounded-xl" />
            </div>
            <div>
              <Label>Expiry date</Label>
              <Input type="date" value={form.expiry_date} onChange={(event) => setForm({ ...form, expiry_date: event.target.value })} className="mt-1 rounded-xl" />
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button disabled={createMutation.isPending} className="gap-2 rounded-xl" style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
              Save credential
            </Button>
          </div>
        </form>
      )}

      <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <h2 className="font-black" style={{ color: TEXT }}>{isCoordinator ? "Organisation credentials" : "My credentials"}</h2>
        {isLoading && <p className="mt-4 text-sm font-bold" style={{ color: MUTED }}>Loading credentials...</p>}
        {error && <p className="mt-4 text-sm font-bold text-red-600">{(error as Error).message}</p>}
        {!isLoading && data.length === 0 && (
          <p className="mt-4 rounded-2xl bg-[#F5F3FC] p-4 text-sm font-medium" style={{ color: MUTED }}>
            No credentials have been recorded yet.
          </p>
        )}
        <div className="mt-3">
          {data.map((credential) => (
            <CredentialRow
              key={credential.id}
              credential={credential}
              coordinator={isCoordinator}
              onUpload={(item, file) => uploadMutation.mutate({ credential: item, file })}
              onDelete={(item) => deleteMutation.mutate(item)}
              onReview={(item, status) => reviewMutation.mutate({ credential: item, status })}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
