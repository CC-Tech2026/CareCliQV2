import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { BadgeCheck, Bell, FileUp, Loader2, ShieldCheck, Trash2 } from "lucide-react";
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
import {
  createShiftCredentialRequirement,
  deleteShiftCredentialRequirement,
  getCoordinatorCredentialAlerts,
  listShiftCredentialRequirements,
  sendBulkReminders,
  type CredentialAlert,
  type ShiftCredentialRequirement,
} from "@/services/coordinatorService";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

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

const STATUS_FILTERS = ["all", "pending_review", "expiring", "expired", "valid", "rejected"] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const SHIFT_TYPES = [
  "standard_support",
  "community_access",
  "allied_health",
  "respite_care",
];

function humanize(value: string) {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusClass(status: string) {
  if (status === "valid") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "expiring") return "bg-amber-50 text-amber-700 border-amber-200";
  if (status === "expired" || status === "rejected") return "bg-red-50 text-red-700 border-red-200";
  return "bg-[#F8F8FE] text-[#3730A3] border-[#E5E7EB]";
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
          <p className="font-black text-[#111827]">{credential.title}</p>
          <span className={`rounded-full border px-2.5 py-1 text-[11px] font-black uppercase ${statusClass(credential.status)}`}>
            {credential.status.replace("_", " ")}
          </span>
        </div>
        <p className="mt-1 text-xs font-medium text-[#6B7280]">
          {credential.credential_type}
          {credential.issuer ? ` • ${credential.issuer}` : ""}
          {credential.expiry_date ? ` • expires ${credential.expiry_date}` : ""}
        </p>
        {credential.user && (
          <p className="mt-1 text-xs text-[#6B7280]">
            {credential.user.full_name || credential.user.email} • {credential.user.role?.replace("_", " ")}
          </p>
        )}
        {credential.file_url && (
          <a href={credential.file_url} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-bold text-[#3730A3]">
            View uploaded document
          </a>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {!coordinator && credential.status !== "valid" && (
          <>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-[#E5E7EB] px-3 py-2 text-xs font-bold text-[#3730A3] hover:bg-[#F8F6FE]">
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
            <Button variant="ghost" size="sm" className="gap-1 text-[#BE185D]" onClick={() => onDelete(credential)}>
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
            <Button variant="ghost" size="sm" className="text-[#BE185D]" onClick={() => onReview(credential, "rejected")}>
              Reject
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function BulkRemindersPanel({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [customMessage, setCustomMessage] = useState("Your credential is expiring soon. Please update it to remain compliant.");
  const reminderTemplates = [
    "Your credential is expiring soon. Please update it to remain compliant.",
    "Your credential is now expired. Please upload the renewed document today to avoid assignment blocks.",
    "Friendly reminder: please update your credential file and expiry date so we can keep your roster active.",
  ];

  const { data: alertsData, isLoading: alertsLoading } = useOrgQuery(["coordinator-credential-alerts"], {
    queryFn: getCoordinatorCredentialAlerts,
    enabled: true,
  });

  const credentialAlerts: CredentialAlert[] = alertsData?.alerts ?? [];

  const workers = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of credentialAlerts) {
      if (a.user_id) map.set(a.user_id, a.full_name ?? a.user_id);
    }
    return [...map.entries()].map(([id, name]) => ({ id, name }));
  }, [credentialAlerts]);

  const mutation = useMutation({
    mutationFn: () => sendBulkReminders([...selectedIds], customMessage),
    onSuccess: (result) => {
      const count = result.notifications_sent ?? result.alerts_created ?? 0;
      toast({ title: "Reminders sent", description: `${count} notification(s) sent.` });
      onClose();
    },
    onError: (err) => toast({ title: "Failed to send reminders", description: (err as Error).message, variant: "destructive" }),
  });

  function toggle(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    if (selectedIds.size === workers.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(workers.map((w) => w.id)));
  }

  return (
    <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-2 flex items-center justify-between gap-3">
        <h2 className="font-black text-[#111827]">Send Credential Reminders</h2>
        <Button variant="outline" size="sm" className="rounded-xl" onClick={onClose}>Close</Button>
      </div>
      <p className="text-sm text-[#6B7280]">
        Select workers with expiring or expired credentials to send them an in-app reminder.
      </p>

        {alertsLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-[#6B7280]">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : workers.length === 0 ? (
          <p className="mt-2 rounded-xl bg-[#F8F8FE] p-3 text-sm font-bold text-[#3730A3]">
            No workers with expiring credentials found.
          </p>
        ) : (
          <div className="mt-2 space-y-2">
            <button className="text-xs font-bold text-[#3730A3] underline" onClick={toggleAll}>
              {selectedIds.size === workers.length ? "Deselect all" : "Select all"}
            </button>
            <div className="max-h-48 overflow-y-auto space-y-1">
              {workers.map(({ id, name }) => (
                <label key={id} className="flex cursor-pointer items-center gap-3 rounded-xl border p-2.5" style={{ borderColor: "var(--cc-border)" }}>
                  <input
                    type="checkbox"
                    checked={selectedIds.has(id)}
                    onChange={() => toggle(id)}
                    className="h-4 w-4 accent-[#3730A3]"
                  />
                  <span className="text-sm font-semibold text-[#111827]">{name}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="mt-2">
          <Label>Message</Label>
          <div className="mt-2 flex flex-wrap gap-2">
            {reminderTemplates.map((template) => (
              <button
                key={template}
                type="button"
                className="rounded-full border border-[#E5E7EB] bg-[#F8F6FE] px-3 py-1 text-xs font-bold text-[#3730A3]"
                onClick={() => setCustomMessage(template)}
              >
                Use Template
              </button>
            ))}
          </div>
          <textarea
            className="mt-1 w-full rounded-xl border border-[#E5E7EB] p-3 text-sm"
            rows={3}
            value={customMessage}
            onChange={(e) => setCustomMessage(e.target.value)}
          />
        </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" className="rounded-xl" onClick={onClose}>Cancel</Button>
        <Button
          disabled={selectedIds.size === 0 || mutation.isPending}
          className="rounded-xl gap-1"
          style={{ background: "var(--cc-plum)" }}
          onClick={() => mutation.mutate()}
        >
          {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
          Send Reminders ({selectedIds.size})
        </Button>
      </div>
    </section>
  );
}

export default function Credentials() {
  const { user } = useAuth();
  const { toast } = useToast();
  const { requireReAuth, modal } = useReAuth();
  const queryClient = useQueryClient();
  const isCoordinator = user?.role === "support_coordinator";
  const orgId = user?.organizationId ?? "__no_org__";
  const credentialTypes = user?.role === "allied_health" ? ALLIED_TYPES : WORKER_TYPES;
  const ruleCredentialTypes = useMemo(() => {
    const merged = [...WORKER_TYPES, ...ALLIED_TYPES];
    return [...new Set(merged)].sort((a, b) => a.localeCompare(b));
  }, []);
  const baseKey = isCoordinator ? ["credentials", "team"] : ["credentials", "me"];
  const { data = [], isLoading, error } = useOrgQuery(baseKey, {
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
  const [showBulkReminders, setShowBulkReminders] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [ruleShiftType, setRuleShiftType] = useState<string>(SHIFT_TYPES[0]);
  const [ruleCredentialType, setRuleCredentialType] = useState<string>(WORKER_TYPES[0]);

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
      const haystack = [
        item.title,
        item.credential_type,
        item.issuer,
        item.user?.full_name,
        item.user?.email,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [data, searchQuery, statusFilter]);

  const { data: shiftRules = [], isLoading: shiftRulesLoading } = useOrgQuery(
    ["coordinator", "shift-credential-requirements"],
    {
      queryFn: () => listShiftCredentialRequirements(),
      enabled: isCoordinator,
    },
  );

  const invalidate = () => queryClient.invalidateQueries({ queryKey: [orgId, ...baseKey] });

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

  const createRuleMutation = useMutation({
    mutationFn: () => createShiftCredentialRequirement({
      shift_type: ruleShiftType,
      required_credential_type: ruleCredentialType,
      minimum_status: "valid",
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [orgId, "coordinator", "shift-credential-requirements"] });
      toast({ title: "Shift credential rule added" });
    },
    onError: (err) => toast({ title: "Could not add rule", description: (err as Error).message, variant: "destructive" }),
  });

  const deleteRuleMutation = useMutation({
    mutationFn: (rule: ShiftCredentialRequirement) => deleteShiftCredentialRequirement(rule.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [orgId, "coordinator", "shift-credential-requirements"] });
      toast({ title: "Shift credential rule removed" });
    },
    onError: (err) => toast({ title: "Could not remove rule", description: (err as Error).message, variant: "destructive" }),
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
      {showBulkReminders && (
        <BulkRemindersPanel onClose={() => setShowBulkReminders(false)} />
      )}
      <div>
        <p className="hidden" style={{ color: CORAL }}>
          {isCoordinator ? "Organisation" : user?.role === "allied_health" ? "Allied Health" : "Support Worker"}
        </p>
        <h1 className="text-xl font-black tracking-tight" style={{ color: PLUM }}>
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
            <p className="text-xs font-bold uppercase text-[#6B7280]">{label}</p>
            <p className="mt-1 text-2xl font-black text-[#111827]">{value}</p>
          </div>
        ))}
      </div>

      {isCoordinator && (summary.expiring > 0 || summary.expired > 0) && (
        <div className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 px-5 py-3">
          <p className="text-sm font-bold text-amber-800">
            {summary.expiring + summary.expired} worker credential(s) need attention.
          </p>
          <Button
            size="sm"
            className="gap-1.5 rounded-xl"
            style={{ background: PLUM }}
            onClick={() => setShowBulkReminders(true)}
          >
            <Bell className="h-3.5 w-3.5" />
            Send Reminders
          </Button>
        </div>
      )}

      {isCoordinator && (
        <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <div className="mb-4">
            <h2 className="font-black text-[#111827]">Shift Credential Rules</h2>
            <p className="mt-1 text-sm text-[#6B7280]">
              Configure which credential types are required per shift type. Shift assignment will block when required credentials are missing.
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
            <div>
              <Label>Shift type</Label>
              <select
                value={ruleShiftType}
                onChange={(event) => setRuleShiftType(event.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-sm"
              >
                {SHIFT_TYPES.map((type) => (
                  <option key={type} value={type}>{type.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
            <div>
              <Label>Required credential</Label>
              <select
                value={ruleCredentialType}
                onChange={(event) => setRuleCredentialType(event.target.value)}
                className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-sm"
              >
                {ruleCredentialTypes.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div className="flex justify-end">
              <Button
                className="gap-2 rounded-xl"
                style={{ background: PLUM }}
                disabled={createRuleMutation.isPending}
                onClick={() => createRuleMutation.mutate()}
              >
                {createRuleMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                Add rule
              </Button>
            </div>
          </div>

          <div className="mt-4 rounded-2xl bg-[#F8F6FE] p-3">
            {shiftRulesLoading && <p className="text-sm font-semibold text-[#6B7280]">Loading rules...</p>}
            {!shiftRulesLoading && shiftRules.length === 0 && (
              <p className="text-sm font-semibold text-[#6B7280]">No shift credential rules configured yet.</p>
            )}
            {!shiftRulesLoading && shiftRules.length > 0 && (
              <div className="space-y-2">
                {shiftRules.map((rule) => (
                  <div key={rule.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2">
                    <p className="text-sm font-semibold text-[#111827]">
                      <span className="capitalize">{humanize(rule.shift_type)}</span>
                      <span className="text-[#6B7280]"> requires </span>
                      {rule.required_credential_type}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-[#BE185D]"
                      disabled={deleteRuleMutation.isPending}
                      onClick={() => deleteRuleMutation.mutate(rule)}
                    >
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      )}

      {!isCoordinator && (
        <form onSubmit={submit} className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <div className="mb-4 flex items-center gap-2">
            <BadgeCheck className="h-5 w-5 text-[#3730A3]" />
            <h2 className="font-black text-[#111827]">Add credential</h2>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <Label>Type</Label>
              <select
                value={form.credential_type}
                onChange={(event) => setForm({ ...form, credential_type: event.target.value })}
                className="mt-1 h-10 w-full rounded-xl border border-[#E5E7EB] bg-white px-3 text-sm"
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
            <Button disabled={createMutation.isPending} className="gap-2 rounded-xl" style={{ background: PLUM }}>
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
              Save credential
            </Button>
          </div>
        </form>
      )}

      <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <h2 className="font-black" style={{ color: TEXT }}>{isCoordinator ? "Organisation credentials" : "My credentials"}</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-[1fr_auto] md:items-center">
          <Input
            placeholder="Search by title, type, issuer, worker..."
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
                    borderColor: active ? PLUM : "#E5E7EB",
                    background: active ? "var(--cc-soft)" : "var(--cc-bg)",
                    color: active ? PLUM : MUTED,
                  }}
                >
                  {filter === "all" ? "All" : humanize(filter)}
                </button>
              );
            })}
          </div>
        </div>
        {isLoading && <p className="mt-4 text-sm font-bold" style={{ color: MUTED }}>Loading credentials...</p>}
        {error && <p className="mt-4 text-sm font-bold text-red-600">{(error as Error).message}</p>}
        {!isLoading && data.length === 0 && (
          <p className="mt-4 rounded-2xl bg-[#F8F8FE] p-4 text-sm font-medium" style={{ color: MUTED }}>
            No credentials have been recorded yet.
          </p>
        )}
        {!isLoading && data.length > 0 && filteredData.length === 0 && (
          <p className="mt-4 rounded-2xl bg-[#F8F8FE] p-4 text-sm font-medium" style={{ color: MUTED }}>
            No credentials match your current search or status filter.
          </p>
        )}
        <div className="mt-3">
          {filteredData.map((credential) => (
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
