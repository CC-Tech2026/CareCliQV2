import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { AlertCircle, BadgeCheck, ChevronDown, ExternalLink, FileUp, Loader2, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  createCredential,
  deleteCredential,
  listMyCredentials,
  uploadCredentialFile,
  type Credential,
} from "@/services/credentialsService";
import { CREDENTIAL_TYPES, credentialTypeLabel, credentialTypeMeta, isCredentialMandatory } from "@/lib/credential-types";

const PLUM = "var(--cc-plum)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const WARNING = "var(--cc-status-warning)";
const WARNING_BG = "var(--cc-status-warning-bg)";

// "Police Check" and "Other" are free-text pseudo-types (the display label doubles
// as the stored credential_type value) rather than entries in the canonical
// registry - kept exactly as before so existing saved credentials with these
// literal values keep matching.
const WORKER_TYPES = [...CREDENTIAL_TYPES.map((c) => c.type), "Police Check", "Other"];

const STATUS_FILTERS = ["all", "pending_review", "expiring", "expired", "valid", "rejected"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

function statusClass(status: string) {
  if (status === "valid") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "expiring") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "expired" || status === "rejected") return "bg-red-50 text-red-700 border-red-200";
  return "bg-[#ECECEC] text-[#E8457A] border-[#E8E8EA]";
}

function statusLabel(status: string, translate: (key: string) => string) {
  const map: Record<string, string> = {
    valid: "credentials.valid",
    expiring: "credentials.expiring",
    expired: "credentials.expired",
    pending_review: "credentials.pendingReview",
    rejected: "credentials.rejected",
  };
  return map[status] ? translate(map[status]) : status.replace(/_/g, " ");
}

function CredentialRow({
  credential, onUpload, onDelete,
}: {
  credential: Credential;
  onUpload: (credential: Credential, file: File) => void;
  onDelete: (credential: Credential) => void;
}) {
  const { translate, translateParams } = useAccessibility();
  return (
    <div className="grid gap-3 border-b border-[#EDE3FC] py-4 last:border-0 lg:grid-cols-[1fr_auto] lg:items-center">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-black text-[#1A1A2E]">{credential.title}</p>
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase ${statusClass(credential.status)}`}>
            {statusLabel(credential.status, translate)}
          </span>
          {isCredentialMandatory(credential.credential_type) && (
            <span className="rounded-full border px-2 py-0.5 text-[10px] font-black uppercase" style={{ borderColor: WARNING_BG, background: WARNING_BG, color: WARNING }}>
              Required
            </span>
          )}
        </div>
        <p className="mt-1 text-xs font-medium text-[#6A6A77]">
          {credentialTypeLabel(credential.credential_type)}
          {credential.issuer ? ` · ${credential.issuer}` : ""}
          {credential.expiry_date ? ` · ${translateParams("credentials.expiresOn", { date: credential.expiry_date })}` : ""}
        </p>
        {credential.file_url && (
          <a href={credential.file_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-bold text-[#E8457A]">
            {translate("credentials.viewDocument")}
          </a>
        )}
        {credential.status !== "valid" && (() => {
          const meta = credentialTypeMeta(credential.credential_type);
          if (!meta) return null;
          return (
            <p className="mt-2 text-xs leading-relaxed" style={{ color: MUTED }}>
              {meta.guidance}
              {meta.externalUrl && (
                <>
                  {" "}
                  <a href={meta.externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold text-[#E8457A]">
                    {meta.externalLabel ?? "Learn more"} <ExternalLink className="h-3 w-3" />
                  </a>
                </>
              )}
            </p>
          );
        })()}
      </div>
      <div className="flex flex-wrap gap-2">
        {credential.status !== "valid" && (
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[#E8E8EA] px-3 py-2 text-xs font-bold text-[#E8457A] hover:bg-[#F8F6FE]">
            <FileUp className="h-4 w-4" />
            {translate("credentials.uploadFile")}
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
        )}
        {/* The backend blocks deleting any credential once verified_at is
            set, regardless of its current status — a previously-verified
            credential that later ages into "expiring"/"expired" still has
            verified_at set, so gating on status alone showed this button
            for every credential a worker has ever had verified, and
            clicking it always 403'd. */}
        {!credential.verified_at && (
          <Button variant="ghost" size="sm" className="gap-1 text-[#7C3AED]" onClick={() => onDelete(credential)}>
            <Trash2 className="h-3.5 w-3.5" />
            {translate("credentials.delete")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function MyCredentialsCard() {
  const { toast } = useToast();
  const { translate } = useAccessibility();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const orgId = user?.organizationId ?? "__no_org__";
  const baseKey = ["credentials", "me"];

  const { data = [], isLoading, error } = useOrgQuery(baseKey, { queryFn: listMyCredentials });

  const [form, setForm] = useState({
    credential_type: WORKER_TYPES[0],
    title: "",
    credential_number: "",
    issuer: "",
    issue_date: "",
    expiry_date: "",
    screening_number: "",
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [addOpenOverride, setAddOpenOverride] = useState<boolean | null>(null);
  const addOpen = addOpenOverride ?? data.length === 0;

  const summary = useMemo(() => ({
    total: data.length,
    expiring: data.filter((item) => item.status === "expiring").length,
    expired: data.filter((item) => item.status === "expired").length,
    pending: data.filter((item) => item.status === "pending_review").length,
  }), [data]);

  const filteredData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return data.filter((item) => {
      const statusMatch = statusFilter === "all" || item.status === statusFilter;
      if (!statusMatch) return false;
      if (!q) return true;
      const haystack = [item.title, item.credential_type, credentialTypeLabel(item.credential_type), item.issuer]
        .filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [data, searchQuery, statusFilter]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [orgId, ...baseKey] });

  const createMutation = useMutation({
    mutationFn: createCredential,
    onSuccess: () => {
      setForm((prev) => ({ ...prev, title: "", credential_number: "", issuer: "", issue_date: "", expiry_date: "", screening_number: "" }));
      setAddOpenOverride(false);
      invalidate();
      toast({ title: translate("credentials.saved"), description: translate("credentials.savedDescription") });
    },
    onError: (err) => toast({ title: translate("credentials.saveFailed"), description: (err as Error).message, variant: "destructive" }),
  });

  const uploadMutation = useMutation({
    mutationFn: ({ credential, file }: { credential: Credential; file: File }) => uploadCredentialFile(credential.id, file),
    onSuccess: () => { invalidate(); toast({ title: translate("credentials.uploaded") }); },
    onError: (err) => toast({ title: translate("credentials.uploadFailed"), description: (err as Error).message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (credential: Credential) => deleteCredential(credential.id),
    onSuccess: () => { invalidate(); toast({ title: translate("credentials.deleted") }); },
    onError: (err) => toast({ title: translate("credentials.deleteFailed"), description: (err as Error).message, variant: "destructive" }),
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.title.trim()) {
      toast({ title: translate("credentials.titleRequired"), variant: "destructive" });
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
      screening_number: form.credential_type === "ndis_screening" ? (form.screening_number || null) : null,
    });
  }

  const needsAttention = summary.pending + summary.expiring + summary.expired;
  const allGood = !isLoading && data.length > 0 && needsAttention === 0;

  // Mandatory credential types with nothing on file yet - the gap that has to be
  // closed before this worker can be rostered with a participant, surfaced with
  // guidance on how to actually get each one instead of a bare "missing" flag.
  const missingMandatory = useMemo(() => {
    const onFile = new Set(data.map((item) => item.credential_type));
    return CREDENTIAL_TYPES.filter((c) => c.mandatory && !onFile.has(c.type));
  }, [data]);

  function startAdding(type: string) {
    setForm((prev) => ({ ...prev, credential_type: type }));
    setAddOpenOverride(true);
  }

  return (
    <div className="space-y-4 rounded-2xl border border-[#E8E8EA] bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[#1A1A2E]">
          <BadgeCheck className="h-5 w-5 text-[#E8457A]" />
          <h2 className="font-black">{translate("credentials.title")}</h2>
        </div>
        {!isLoading && data.length > 0 && (
          allGood ? (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black" style={{ background: "var(--cc-status-success-bg)", color: "var(--cc-status-success)" }}>
              <ShieldCheck className="h-3 w-3" /> All up to date
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black" style={{ background: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)" }}>
              {needsAttention} need{needsAttention === 1 ? "s" : ""} attention
            </span>
          )
        )}
      </div>

      {!isLoading && missingMandatory.length > 0 && (
        <div className="rounded-2xl border p-4" style={{ borderColor: WARNING_BG, background: WARNING_BG }}>
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4" style={{ color: WARNING }} />
            <p className="text-xs font-black uppercase tracking-wide" style={{ color: WARNING }}>
              {missingMandatory.length} mandatory credential{missingMandatory.length === 1 ? "" : "s"} still needed
            </p>
          </div>
          <p className="mt-1 text-xs" style={{ color: "#1A1A2E" }}>
            These have to be on file and verified before you can be rostered with a participant. The rest can be completed after you start.
          </p>
          <div className="mt-3 space-y-2">
            {missingMandatory.map((meta) => (
              <div key={meta.type} className="rounded-xl border bg-white p-3" style={{ borderColor: BORDER }}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <p className="text-sm font-black" style={{ color: "#1A1A2E" }}>{meta.label}</p>
                  <Button size="sm" variant="ghost" className="h-7 gap-1 rounded-lg px-2.5 text-xs font-bold text-[#E8457A]" onClick={() => startAdding(meta.type)}>
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
                <p className="mt-1 text-xs leading-relaxed" style={{ color: MUTED }}>{meta.guidance}</p>
                {meta.externalUrl && (
                  <a
                    href={meta.externalUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-[#E8457A]"
                  >
                    <ExternalLink className="h-3 w-3" /> {meta.externalLabel ?? "Learn more"}
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-xl border" style={{ borderColor: BORDER }}>
        <button
          type="button"
          onClick={() => setAddOpenOverride(!addOpen)}
          className="flex w-full items-center justify-between gap-2 p-4 text-left"
        >
          <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>
            {addOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {translate("credentials.add")}
          </span>
        </button>
        {addOpen && (
      <form onSubmit={submit} className="px-4 pb-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>{translate("credentials.type")}</Label>
            <select
              title="Credential type"
              value={form.credential_type}
              onChange={(event) => setForm({ ...form, credential_type: event.target.value })}
              className="mt-1 h-10 w-full rounded-xl border border-[#E8E8EA] bg-white px-3 text-sm"
            >
              {WORKER_TYPES.map((type) => (
                <option key={type} value={type}>
                  {credentialTypeLabel(type)}{isCredentialMandatory(type) ? " — Required" : ""}
                </option>
              ))}
            </select>
            {(() => {
              const meta = credentialTypeMeta(form.credential_type);
              if (!meta) return null;
              return (
                <div className="mt-2 rounded-xl border p-3" style={{ borderColor: BORDER, background: "var(--cc-soft)" }}>
                  <p className="text-xs font-black" style={{ color: "#1A1A2E" }}>How to get this</p>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: MUTED }}>{meta.guidance}</p>
                  {meta.externalUrl && (
                    <a
                      href={meta.externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1.5 text-xs font-bold text-[#E8457A]"
                    >
                      <ExternalLink className="h-3 w-3" /> {meta.externalLabel ?? "Learn more"}
                    </a>
                  )}
                </div>
              );
            })()}
          </div>
          <div>
            <Label>{translate("credentials.credentialTitle")}</Label>
            <Input value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} className="mt-1 rounded-xl" />
          </div>
          <div>
            <Label>{translate("credentials.number")}</Label>
            <Input value={form.credential_number} onChange={(event) => setForm({ ...form, credential_number: event.target.value })} className="mt-1 rounded-xl" />
          </div>
          {form.credential_type === "ndis_screening" && (
            <div>
              <Label>Screening check number</Label>
              <Input
                value={form.screening_number}
                onChange={(event) => setForm({ ...form, screening_number: event.target.value })}
                placeholder="e.g. WWC1234567890"
                className="mt-1 rounded-xl"
              />
            </div>
          )}
          <div>
            <Label>{translate("credentials.issuer")}</Label>
            <Input value={form.issuer} onChange={(event) => setForm({ ...form, issuer: event.target.value })} className="mt-1 rounded-xl" />
          </div>
          <div>
            <Label>{translate("credentials.issueDate")}</Label>
            <Input type="date" value={form.issue_date} onChange={(event) => setForm({ ...form, issue_date: event.target.value })} className="mt-1 rounded-xl" />
          </div>
          <div>
            <Label>{translate("credentials.expiryDate")}</Label>
            <Input type="date" value={form.expiry_date} onChange={(event) => setForm({ ...form, expiry_date: event.target.value })} className="mt-1 rounded-xl" />
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <Button disabled={createMutation.isPending} className="gap-2 rounded-xl" style={{ background: "var(--cc-cta)" }}>
            {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
            {translate("credentials.save")}
          </Button>
        </div>
      </form>
        )}
      </div>

      <div>
        {data.length > 3 && (
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
          <Input
            placeholder={translate("credentials.searchPlaceholder")}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            className="rounded-xl"
          />
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((filter) => {
              const active = statusFilter === filter;
              return (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setStatusFilter(filter)}
                  className="rounded-full border px-3 py-1 text-xs font-bold"
                  style={{
                    borderColor: active ? PLUM : "#E8E8EA",
                    background: active ? "var(--cc-soft)" : "var(--cc-bg)",
                    color: active ? PLUM : MUTED,
                  }}
                >
                  {filter === "all" ? translate("common.all") : statusLabel(filter, translate)}
                </button>
              );
            })}
          </div>
        </div>
        )}
        {isLoading && <p className="mt-4 text-sm font-bold" style={{ color: MUTED }}>{translate("credentials.loading")}</p>}
        {error && <p className="mt-4 text-sm font-bold text-red-600">{(error as Error).message}</p>}
        {!isLoading && data.length === 0 && (
          <p className="mt-4 rounded-2xl bg-[#ECECEC] p-4 text-sm font-medium" style={{ color: MUTED }}>{translate("credentials.empty")}</p>
        )}
        {!isLoading && data.length > 0 && filteredData.length === 0 && (
          <p className="mt-4 rounded-2xl bg-[#ECECEC] p-4 text-sm font-medium" style={{ color: MUTED }}>{translate("credentials.noMatch")}</p>
        )}
        <div className="mt-3">
          {filteredData.map((credential) => (
            <CredentialRow
              key={credential.id}
              credential={credential}
              onUpload={(item, file) => uploadMutation.mutate({ credential: item, file })}
              onDelete={(item) => deleteMutation.mutate(item)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
