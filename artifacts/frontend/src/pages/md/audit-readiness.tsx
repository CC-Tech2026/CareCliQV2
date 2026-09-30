import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Clock3,
  Download,
  FileSearch,
  FolderLock,
  Link2,
  Settings2,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { StatCard, StatCardGroup } from "@/components/ui/stat-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { formatAppDate } from "@/lib/datetime";
import {
  AREA_LABELS,
  AUDIT_READINESS_KEY,
  STATUS_LABELS,
  fetchChecklist,
  fetchProfile,
  fetchRequirements,
  linkEvidence,
  markNotApplicable,
  outstandingItemsCsv,
  reviewEvidence,
  revokeNotApplicable,
  saveProfile,
  saveRequirementSetting,
  unlinkEvidence,
  type Area,
  type AuditChecklist,
  type AuditEvidence,
  type AuditItem,
  type AuditRequirement,
  type ItemStatus,
  type SubjectType,
} from "@/services/auditReadinessService";
import { fetchFolderDocuments, fetchVaultFolders, type VaultDocument } from "@/services/vaultService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const PLUM = "var(--cc-plum)";

type View = "overview" | "checklist" | "packs";
const VIEWS: { key: View; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "checklist", label: "Checklist" },
  { key: "packs", label: "Audit packs" },
];

const STATUS_ORDER: ItemStatus[] = ["missing", "overdue", "awaiting_review", "due_soon", "current", "not_applicable"];

const STATUS_STYLE: Record<ItemStatus | "rejected", { fg: string; bg: string }> = {
  missing: { fg: "var(--cc-status-danger)", bg: "var(--cc-status-danger-bg)" },
  overdue: { fg: "var(--cc-status-danger)", bg: "var(--cc-status-danger-bg)" },
  rejected: { fg: "var(--cc-status-danger)", bg: "var(--cc-status-danger-bg)" },
  awaiting_review: { fg: "var(--cc-status-info)", bg: "var(--cc-status-info-bg)" },
  due_soon: { fg: "var(--cc-status-warning)", bg: "var(--cc-status-warning-bg)" },
  current: { fg: "var(--cc-status-success)", bg: "var(--cc-status-success-bg)" },
  not_applicable: { fg: "var(--cc-muted)", bg: "var(--cc-soft)" },
};

const SUBJECT_LABELS: Record<SubjectType, string> = {
  organisation: "Organisation",
  worker: "Worker",
  participant: "Participant",
};

function fmtDate(value: string | null | undefined): string {
  if (!value) return "";
  // Date-only values: anchor mid-day so no zone shifts the calendar day.
  return formatAppDate(value.length === 10 ? `${value}T12:00:00Z` : value);
}

function StatusPill({ status }: { status: ItemStatus | "rejected" }) {
  const style = STATUS_STYLE[status];
  return (
    <span
      className="inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-bold"
      style={{ color: style.fg, background: style.bg }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function useInvalidate() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  return () => queryClient.invalidateQueries({ queryKey: [orgId, ...AUDIT_READINESS_KEY] });
}

// ── Overview ─────────────────────────────────────────────────────────────

function Overview({
  data,
  openChecklist,
  openItem,
  openSetup,
}: {
  data: AuditChecklist;
  openChecklist: (filters: Record<string, string>) => void;
  openItem: (id: string) => void;
  openSetup: () => void;
}) {
  const { summary } = data;
  const criticalGaps = data.items
    .filter((i) => i.critical && (i.status === "missing" || i.status === "overdue"))
    .slice(0, 8);

  return (
    <div className="space-y-5">
      {!data.profile_configured && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4"
          style={{ borderColor: "var(--cc-status-warning)", background: "var(--cc-status-warning-bg)" }}
        >
          <p className="text-sm" style={{ color: TEXT }}>
            Set your audit type and registration groups so the checklist only includes what applies to you.
            Until then, every audit type's requirements are included.
          </p>
          <Button size="sm" variant="outline" onClick={openSetup}>
            Set up audit profile
          </Button>
        </div>
      )}

      <StatCardGroup fill>
        <StatCard
          icon={<ClipboardCheck size={16} />}
          label="Evidence ready"
          value={summary.readiness_percent === null ? "—" : `${summary.readiness_percent}%`}
          sub={`${summary.counts.current + summary.counts.due_soon} of ${summary.applicable} items`}
          tone="info"
          onClick={() => openChecklist({})}
        />
        <StatCard
          icon={<ShieldAlert size={16} />}
          label="Critical gaps"
          value={summary.critical_gaps}
          sub="missing or overdue"
          tone={summary.critical_gaps ? "danger" : "success"}
          onClick={() => openChecklist({ critical: "1", status: "gaps" })}
        />
        <StatCard
          icon={<FileSearch size={16} />}
          label="Awaiting review"
          value={summary.counts.awaiting_review}
          tone="info"
          onClick={() => openChecklist({ status: "awaiting_review" })}
        />
        <StatCard
          icon={<Clock3 size={16} />}
          label="Due soon"
          value={summary.counts.due_soon}
          sub="within 60 days"
          tone="warning"
          onClick={() => openChecklist({ status: "due_soon" })}
        />
      </StatCardGroup>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border p-4" style={{ borderColor: BORDER, background: "var(--cc-surface)" }}>
          <h2 className="text-sm font-bold" style={{ color: TEXT }}>By area</h2>
          <div className="mt-3 space-y-2">
            {summary.by_area.filter((a) => a.total > 0).map((area) => {
              const pct = area.total ? Math.round((100 * area.ready) / area.total) : 0;
              return (
                <button
                  key={area.area}
                  type="button"
                  onClick={() => openChecklist({ area: area.area })}
                  className="w-full rounded-lg p-2.5 text-left transition-colors hover:bg-black/5"
                >
                  <div className="flex items-baseline justify-between gap-3 text-[13px]">
                    <span className="font-semibold" style={{ color: TEXT }}>{area.label}</span>
                    <span style={{ color: MUTED }}>
                      {area.ready}/{area.total} ready{area.gaps ? ` · ${area.gaps} gaps` : ""}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full" style={{ background: "var(--cc-soft)" }}>
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: PLUM }} />
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-xl border p-4" style={{ borderColor: BORDER, background: "var(--cc-surface)" }}>
          <h2 className="text-sm font-bold" style={{ color: TEXT }}>Critical gaps</h2>
          {criticalGaps.length === 0 ? (
            <p className="mt-3 flex items-center gap-2 text-sm" style={{ color: MUTED }}>
              <CheckCircle2 size={15} style={{ color: "var(--cc-status-success)" }} />
              No critical item is missing or overdue.
            </p>
          ) : (
            <ul className="mt-2 divide-y" style={{ borderColor: BORDER }}>
              {criticalGaps.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => openItem(item.id)}
                    className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:opacity-80"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-semibold" style={{ color: TEXT }}>
                        {item.title}
                      </span>
                      <span className="block truncate text-[12px]" style={{ color: MUTED }}>{item.subject_name}</span>
                    </span>
                    <StatusPill status={item.status} />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {summary.critical_gaps > criticalGaps.length && (
            <button
              type="button"
              className="mt-2 text-[12px] font-bold"
              style={{ color: PLUM }}
              onClick={() => openChecklist({ critical: "1", status: "gaps" })}
            >
              See all {summary.critical_gaps}
            </button>
          )}
        </section>
      </div>
    </div>
  );
}

// ── Checklist ────────────────────────────────────────────────────────────

function Checklist({
  items,
  filters,
  setFilter,
  openItem,
}: {
  items: AuditItem[];
  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;
  openItem: (id: string) => void;
}) {
  const filtered = useMemo(() => {
    const q = (filters.q ?? "").trim().toLowerCase();
    return items
      .filter((i) => !filters.area || i.area === filters.area)
      .filter((i) => !filters.scope || i.subject_type === filters.scope)
      .filter((i) => {
        if (!filters.status) return true;
        if (filters.status === "gaps") return i.status === "missing" || i.status === "overdue";
        return i.status === filters.status;
      })
      .filter((i) => filters.critical !== "1" || i.critical)
      .filter((i) => !q || i.title.toLowerCase().includes(q) || i.subject_name.toLowerCase().includes(q))
      .sort(
        (a, b) =>
          STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) ||
          Number(b.critical) - Number(a.critical) ||
          a.title.localeCompare(b.title) ||
          a.subject_name.localeCompare(b.subject_name),
      );
  }, [items, filters]);

  const selectClass = "h-9 rounded-md border bg-transparent px-2 text-[13px]";
  const selectStyle = { borderColor: BORDER, color: TEXT };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3" style={{ borderColor: BORDER, background: "var(--cc-surface)" }}>
        <Input
          aria-label="Search requirements or people"
          placeholder="Search requirement or person"
          className="h-9 min-w-[200px] flex-1"
          value={filters.q ?? ""}
          onChange={(e) => setFilter("q", e.target.value)}
        />
        <select aria-label="Area" className={selectClass} style={selectStyle} value={filters.area ?? ""} onChange={(e) => setFilter("area", e.target.value)}>
          <option value="">All areas</option>
          {(Object.keys(AREA_LABELS) as Area[]).map((a) => (
            <option key={a} value={a}>{AREA_LABELS[a]}</option>
          ))}
        </select>
        <select aria-label="Record type" className={selectClass} style={selectStyle} value={filters.scope ?? ""} onChange={(e) => setFilter("scope", e.target.value)}>
          <option value="">Everyone</option>
          <option value="organisation">Organisation</option>
          <option value="worker">Workers</option>
          <option value="participant">Participants</option>
        </select>
        <select aria-label="Status" className={selectClass} style={selectStyle} value={filters.status ?? ""} onChange={(e) => setFilter("status", e.target.value)}>
          <option value="">Any status</option>
          <option value="gaps">Missing or overdue</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS[s]}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-[13px]" style={{ color: TEXT }}>
          <Checkbox
            checked={filters.critical === "1"}
            onCheckedChange={(v) => setFilter("critical", v === true ? "1" : "")}
          />
          Critical only
        </label>
      </div>

      <p className="text-[12px]" style={{ color: MUTED }}>
        {filtered.length} of {items.length} items
      </p>

      <div className="overflow-hidden rounded-xl border" style={{ borderColor: BORDER, background: "var(--cc-surface)" }}>
        {filtered.length === 0 ? (
          <p className="p-6 text-center text-sm" style={{ color: MUTED }}>No items match these filters.</p>
        ) : (
          <ul className="divide-y" style={{ borderColor: BORDER }}>
            {filtered.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => openItem(item.id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-black/5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold" style={{ color: TEXT }}>{item.title}</span>
                      {item.critical && (
                        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--cc-status-danger)" }}>
                          Critical
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-[12px]" style={{ color: MUTED }}>
                      {SUBJECT_LABELS[item.subject_type]} · {item.subject_name}
                      {item.due_date ? ` · due ${fmtDate(item.due_date)}` : ""}
                    </span>
                  </span>
                  <StatusPill status={item.status} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

// ── Item side panel ──────────────────────────────────────────────────────

function EvidenceRow({ item, evidence, onDone }: { item: AuditItem; evidence: AuditEvidence; onDone: () => void }) {
  const { toast } = useToast();
  const [mode, setMode] = useState<"idle" | "approve" | "reject">("idle");
  const [note, setNote] = useState("");
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast({ title: success });
      setMode("idle");
      setNote("");
      setExpiry("");
      onDone();
    } catch (err) {
      toast({ title: "Couldn't save", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const canReview = evidence.reviewable && item.status !== "not_applicable";

  return (
    <div className="rounded-xl border p-3" style={{ borderColor: BORDER }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold" style={{ color: TEXT }}>{evidence.title}</p>
          <p className="mt-0.5 text-[12px]" style={{ color: MUTED }}>
            {evidence.kind === "auto" ? "Found in CareCliQ" : "Linked from the vault"}
            {evidence.date ? ` · ${fmtDate(evidence.date)}` : ""}
            {evidence.due_date ? ` · due ${fmtDate(evidence.due_date)}` : ""}
          </p>
          {evidence.detail && <p className="mt-1 text-[12px]" style={{ color: TEXT }}>{evidence.detail}</p>}
          {evidence.reviewed_by && evidence.reviewed_at && (
            <p className="mt-1 text-[11px]" style={{ color: MUTED }}>
              {evidence.review_status === "rejected" ? "Rejected" : "Approved"} by {evidence.reviewed_by} on {fmtDate(evidence.reviewed_at)}
            </p>
          )}
        </div>
        <StatusPill status={evidence.status} />
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        {evidence.vault_category && (
          <Link
            href={`/md/vault/${encodeURIComponent(evidence.vault_category)}`}
            className="text-[12px] font-bold"
            style={{ color: PLUM }}
          >
            Open in vault
          </Link>
        )}
        {canReview && mode === "idle" && (
          <>
            <button type="button" className="text-[12px] font-bold" style={{ color: "var(--cc-status-success)" }} onClick={() => setMode("approve")}>
              {evidence.review_status === "approved" ? "Re-review" : "Approve"}
            </button>
            <button type="button" className="text-[12px] font-bold" style={{ color: "var(--cc-status-danger)" }} onClick={() => setMode("reject")}>
              Reject
            </button>
          </>
        )}
        {evidence.kind === "linked" && evidence.link_id && mode === "idle" && (
          <button
            type="button"
            className="text-[12px] font-bold"
            style={{ color: MUTED }}
            disabled={busy}
            onClick={() => run(() => unlinkEvidence(evidence.link_id as string), "Evidence unlinked")}
          >
            Unlink
          </button>
        )}
      </div>

      {mode !== "idle" && (
        <div className="mt-3 space-y-2">
          {mode === "approve" && (
            <label className="block text-[12px]" style={{ color: TEXT }}>
              Expiry date, if the document has one
              <Input type="date" className="mt-1 h-9" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
            </label>
          )}
          <Textarea
            aria-label={mode === "reject" ? "Why it's rejected" : "Review note"}
            placeholder={mode === "reject" ? "Why it's rejected (required)" : "Review note (optional)"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={busy || (mode === "reject" && !note.trim())}
              onClick={() =>
                run(
                  () => reviewEvidence(item, evidence, mode === "approve" ? "approved" : "rejected", { note, expiry_date: expiry || null }),
                  mode === "approve" ? "Evidence approved" : "Evidence rejected",
                )
              }
            >
              {mode === "approve" ? "Approve" : "Reject"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("idle")}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}

function LinkFromVault({ item, onDone }: { item: AuditItem; onDone: () => void }) {
  const { toast } = useToast();
  const [folder, setFolder] = useState("");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const folders = useOrgQuery(["md-vault", "folders"], { queryFn: fetchVaultFolders });
  const docs = useOrgQuery<VaultDocument[]>(["md-vault", "folder-docs", folder, search], {
    queryFn: () => fetchFolderDocuments(folder, { search: search || undefined }),
    enabled: !!folder,
  });
  const linked = new Set(item.evidence.map((e) => `${e.source_table}:${e.source_id}`));

  const link = async (doc: VaultDocument) => {
    setBusyId(doc.id);
    try {
      await linkEvidence(item, doc.category, doc.id);
      toast({ title: "Evidence linked", description: "It stays Awaiting review until someone approves it." });
      onDone();
    } catch (err) {
      toast({ title: "Couldn't link", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-2 rounded-xl border p-3" style={{ borderColor: BORDER }}>
      <select
        aria-label="Vault folder"
        className="h-9 w-full rounded-md border bg-transparent px-2 text-[13px]"
        style={{ borderColor: BORDER, color: TEXT }}
        value={folder}
        onChange={(e) => setFolder(e.target.value)}
      >
        <option value="">Choose a vault folder…</option>
        {(folders.data ?? []).map((f) => (
          <option key={f.category} value={f.category}>{f.label} ({f.count})</option>
        ))}
      </select>
      {folder && (
        <>
          <Input
            aria-label="Search the folder"
            placeholder={item.subject_type === "organisation" ? "Search this folder" : `Search, e.g. ${item.subject_name}`}
            className="h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="max-h-64 space-y-1 overflow-y-auto">
            {docs.isLoading && <p className="text-[12px]" style={{ color: MUTED }}>Loading…</p>}
            {docs.data?.length === 0 && <p className="text-[12px]" style={{ color: MUTED }}>Nothing in this folder matches.</p>}
            {docs.data?.slice(0, 50).map((doc) => {
              const already = linked.has(`${doc.source_table}:${doc.source_id}`);
              return (
                <div key={doc.id} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 hover:bg-black/5">
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold" style={{ color: TEXT }}>{doc.title}</span>
                    <span className="block truncate text-[11px]" style={{ color: MUTED }}>
                      {doc.person_name}{doc.date ? ` · ${fmtDate(doc.date)}` : ""}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" disabled={already || busyId !== null} onClick={() => link(doc)}>
                    {already ? "Linked" : busyId === doc.id ? "Linking…" : "Link"}
                  </Button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ItemSheet({
  item,
  requirement,
  onClose,
}: {
  item: AuditItem | null;
  requirement: AuditRequirement | undefined;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const invalidate = useInvalidate();
  const [linking, setLinking] = useState(false);
  const [naOpen, setNaOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setLinking(false);
    setNaOpen(false);
    setReason("");
  }, [item?.id]);

  const done = () => void invalidate();

  const saveNa = async () => {
    if (!item) return;
    setBusy(true);
    try {
      if (item.not_applicable) {
        await revokeNotApplicable(item.not_applicable.id, reason);
        toast({ title: "Decision revoked" });
      } else {
        await markNotApplicable(item, reason.trim());
        toast({ title: "Marked not applicable" });
      }
      setNaOpen(false);
      setReason("");
      done();
    } catch (err) {
      toast({ title: "Couldn't save", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={!!item} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {item && (
          <>
            <SheetHeader>
              <div className="flex items-center gap-2">
                <StatusPill status={item.status} />
                {item.critical && (
                  <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: "var(--cc-status-danger)" }}>
                    Critical
                  </span>
                )}
              </div>
              <SheetTitle>{item.title}</SheetTitle>
              <SheetDescription>
                {SUBJECT_LABELS[item.subject_type]} · {item.subject_name}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-5 text-[13px]">
              <section
                className="rounded-xl p-3"
                style={{ background: item.status === "current" ? "var(--cc-soft)" : STATUS_STYLE[item.status].bg }}
              >
                <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>Next action</p>
                <p className="mt-1" style={{ color: TEXT }}>{item.next_action}</p>
              </section>

              {requirement && (
                <section className="space-y-2">
                  <p style={{ color: TEXT }}>{requirement.description}</p>
                  <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1.5 text-[12px]">
                    <dt style={{ color: MUTED }}>Why it applies</dt>
                    <dd style={{ color: TEXT }}>{item.applies_reason}</dd>
                    <dt style={{ color: MUTED }}>Source</dt>
                    <dd style={{ color: TEXT }}>{requirement.source}</dd>
                    <dt style={{ color: MUTED }}>Review cycle</dt>
                    <dd style={{ color: TEXT }}>
                      {requirement.review_interval_days
                        ? `Every ${requirement.review_interval_days} days`
                        : "Only its own expiry date"}
                    </dd>
                    {requirement.sensitive && (
                      <>
                        <dt style={{ color: MUTED }}>Sensitive</dt>
                        <dd style={{ color: TEXT }}>Identity documents are never included in a pack unless you choose to.</dd>
                      </>
                    )}
                  </dl>
                </section>
              )}

              {item.not_applicable ? (
                <section className="rounded-xl border p-3" style={{ borderColor: BORDER }}>
                  <p className="font-semibold" style={{ color: TEXT }}>Marked not applicable</p>
                  <p className="mt-1" style={{ color: TEXT }}>{item.not_applicable.reason}</p>
                  <p className="mt-1 text-[11px]" style={{ color: MUTED }}>
                    Approved by {item.not_applicable.approved_by ?? "a managing director"} on {fmtDate(item.not_applicable.approved_at)}
                  </p>
                </section>
              ) : null}

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="font-bold" style={{ color: TEXT }}>Evidence</h3>
                  {!item.not_applicable && (
                    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setLinking((v) => !v)}>
                      <Link2 size={14} />
                      {linking ? "Close" : "Link from vault"}
                    </Button>
                  )}
                </div>
                {linking && <LinkFromVault item={item} onDone={done} />}
                {item.evidence.length === 0 ? (
                  <p style={{ color: MUTED }}>{requirement?.evidence_hint ?? "No evidence found yet."}</p>
                ) : (
                  item.evidence.map((ev) => (
                    <EvidenceRow key={`${ev.source_table}:${ev.source_id}`} item={item} evidence={ev} onDone={done} />
                  ))
                )}
              </section>

              <section className="border-t pt-4" style={{ borderColor: BORDER }}>
                {!naOpen ? (
                  <button
                    type="button"
                    className="text-[12px] font-bold"
                    style={{ color: MUTED }}
                    onClick={() => setNaOpen(true)}
                  >
                    {item.not_applicable ? "Revoke not-applicable decision" : "Mark not applicable"}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <Textarea
                      aria-label={item.not_applicable ? "Why it applies again" : "Why it doesn't apply"}
                      placeholder={
                        item.not_applicable
                          ? "Why it applies again (optional)"
                          : "Why this doesn't apply — recorded with your name (at least 10 characters)"
                      }
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={3}
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busy || (!item.not_applicable && reason.trim().length < 10)}
                        onClick={saveNa}
                      >
                        {item.not_applicable ? "Revoke" : "Approve as not applicable"}
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setNaOpen(false)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Setup: audit profile and requirement settings ────────────────────────

function SetupSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const invalidate = useInvalidate();
  const profileQuery = useOrgQuery([...AUDIT_READINESS_KEY, "profile"], { queryFn: fetchProfile, enabled: open });
  const requirementsQuery = useOrgQuery([...AUDIT_READINESS_KEY, "requirements"], { queryFn: fetchRequirements, enabled: open });
  const [auditType, setAuditType] = useState<"verification" | "certification" | "">("");
  const [groups, setGroups] = useState<Set<string>>(new Set());
  const [flags, setFlags] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const p = profileQuery.data?.profile;
    if (!p || !open) return;
    setAuditType(p.audit_type ?? "");
    setGroups(new Set(p.registration_groups));
    setFlags(new Set(p.service_flags));
  }, [profileQuery.data, open]);

  const toggle = (set: Set<string>, value: string, update: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    update(next);
  };

  const save = async () => {
    setSaving(true);
    try {
      await saveProfile({
        audit_type: auditType || null,
        registration_groups: [...groups],
        service_flags: [...flags],
      });
      toast({ title: "Audit profile saved" });
      void invalidate();
    } catch (err) {
      toast({ title: "Couldn't save", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const updateRequirement = async (req: AuditRequirement, change: Partial<{ enabled: boolean; days: number | null }>) => {
    try {
      await saveRequirementSetting(req.code, {
        is_enabled: change.enabled ?? req.enabled,
        review_interval_days: change.days !== undefined ? change.days : req.review_interval_days,
      });
      void invalidate();
    } catch (err) {
      toast({ title: "Couldn't save", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  };

  const options = profileQuery.data?.options;
  const impliedFlags = new Set(
    (options?.service_flags ?? []).filter((f) => f.implied_by.some((g) => groups.has(g))).map((f) => f.key),
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Audit profile</SheetTitle>
          <SheetDescription>
            Decides which requirements are on your checklist. Your auditor sets the final scope from your registration.
          </SheetDescription>
        </SheetHeader>
        {!options ? (
          <p className="mt-4 text-sm" style={{ color: MUTED }}>Loading…</p>
        ) : (
          <div className="mt-4 space-y-6 text-[13px]">
            <section className="space-y-2">
              <h3 className="font-bold" style={{ color: TEXT }}>Audit type</h3>
              <div className="flex flex-wrap gap-2">
                {options.audit_types.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => setAuditType(t.value)}
                    className="rounded-full border px-3 py-1.5 font-semibold"
                    style={{
                      borderColor: auditType === t.value ? PLUM : BORDER,
                      color: auditType === t.value ? PLUM : TEXT,
                      background: auditType === t.value ? "var(--cc-active-bg)" : "transparent",
                    }}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h3 className="font-bold" style={{ color: TEXT }}>Services you deliver</h3>
              {options.service_flags.map((f) => {
                const implied = impliedFlags.has(f.key);
                return (
                  <label key={f.key} className="flex items-start gap-2" style={{ color: TEXT }}>
                    <Checkbox
                      className="mt-0.5"
                      checked={flags.has(f.key) || implied}
                      disabled={implied}
                      onCheckedChange={() => toggle(flags, f.key, setFlags)}
                    />
                    <span>
                      {f.label}
                      {implied && <span style={{ color: MUTED }}> — from your registration groups</span>}
                    </span>
                  </label>
                );
              })}
            </section>

            <section className="space-y-2">
              <h3 className="font-bold" style={{ color: TEXT }}>Registration groups</h3>
              <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-xl border p-3" style={{ borderColor: BORDER }}>
                {options.registration_groups.map((g) => (
                  <label key={g.code} className="flex items-start gap-2" style={{ color: TEXT }}>
                    <Checkbox className="mt-0.5" checked={groups.has(g.code)} onCheckedChange={() => toggle(groups, g.code, setGroups)} />
                    <span><span style={{ color: MUTED }}>{g.code}</span> {g.label}</span>
                  </label>
                ))}
              </div>
            </section>

            <Button onClick={save} disabled={saving} style={{ background: PLUM, color: "white" }}>
              {saving ? "Saving…" : "Save profile"}
            </Button>

            <section className="space-y-2 border-t pt-4" style={{ borderColor: BORDER }}>
              <h3 className="font-bold" style={{ color: TEXT }}>Requirements</h3>
              <p style={{ color: MUTED }}>
                Switch off anything that isn't part of how you operate, and set your own review cycles — for example
                how often you recheck police checks.
              </p>
              {(requirementsQuery.data ?? []).map((req) => (
                <div key={req.code} className="rounded-lg border p-2.5" style={{ borderColor: BORDER, opacity: req.applies ? 1 : 0.6 }}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold" style={{ color: TEXT }}>{req.title}</p>
                      <p className="text-[11px]" style={{ color: MUTED }}>{req.applies_reason}</p>
                    </div>
                    <Switch
                      aria-label={`Include ${req.title}`}
                      checked={req.enabled}
                      onCheckedChange={(v) => updateRequirement(req, { enabled: v })}
                    />
                  </div>
                  <label className="mt-2 flex items-center gap-2 text-[12px]" style={{ color: MUTED }}>
                    Review every
                    <Input
                      type="number"
                      min={1}
                      max={3650}
                      className="h-8 w-20"
                      defaultValue={req.review_interval_days ?? ""}
                      placeholder="—"
                      onBlur={(e) => {
                        const raw = e.target.value.trim();
                        const days = raw ? Math.round(Number(raw)) : null;
                        if (days !== null && (!Number.isFinite(days) || days < 1 || days > 3650)) return;
                        if (days !== req.review_interval_days) void updateRequirement(req, { days });
                      }}
                    />
                    days
                  </label>
                </div>
              ))}
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ── Audit packs ──────────────────────────────────────────────────────────

function AuditPacks({ items }: { items: AuditItem[] }) {
  const outstanding = items.filter((i) => ["missing", "overdue", "awaiting_review", "due_soon"].includes(i.status));

  const download = () => {
    const blob = new Blob([outstandingItemsCsv(items)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `outstanding-audit-items-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-xl border p-4" style={{ borderColor: BORDER, background: "var(--cc-surface)" }}>
        <h2 className="text-sm font-bold" style={{ color: TEXT }}>Outstanding items report</h2>
        <p className="mt-1 text-[13px]" style={{ color: MUTED }}>
          {outstanding.length} item{outstanding.length === 1 ? "" : "s"} still need evidence, review or renewal. Download
          them as a spreadsheet to share with whoever is following them up.
        </p>
        <Button className="mt-3 gap-2" variant="outline" onClick={download} disabled={outstanding.length === 0}>
          <Download size={15} />
          Download CSV
        </Button>
      </section>
      <section className="rounded-xl border p-4" style={{ borderColor: BORDER, background: "var(--cc-surface)" }}>
        <h2 className="text-sm font-bold" style={{ color: TEXT }}>Share evidence with an auditor</h2>
        <p className="mt-1 text-[13px]" style={{ color: MUTED }}>
          Build a pack from the vault today. Packs assembled straight from this checklist — with an evidence index and
          review history — are coming next.
        </p>
        <Link href="/md/vault">
          <Button className="mt-3 gap-2" variant="outline">
            <FolderLock size={15} />
            Open the vault
          </Button>
        </Link>
      </section>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

const FILTER_KEYS = ["area", "scope", "status", "critical", "q"] as const;

export default function AuditReadinessPage() {
  const [location, navigate] = useLocation();
  const search = useSearch();
  const params = useMemo(() => new URLSearchParams(search), [search]);
  const view = (VIEWS.some((v) => v.key === params.get("view")) ? params.get("view") : "overview") as View;
  const filters = useMemo(() => {
    const out: Record<string, string> = {};
    for (const key of FILTER_KEYS) {
      const value = params.get(key);
      if (value) out[key] = value;
    }
    return out;
  }, [params]);
  const selectedId = params.get("item");
  const [setupOpen, setSetupOpen] = useState(false);

  const checklist = useOrgQuery([...AUDIT_READINESS_KEY, "checklist"], { queryFn: fetchChecklist });
  const requirements = useOrgQuery([...AUDIT_READINESS_KEY, "requirements"], { queryFn: fetchRequirements });

  const go = (next: URLSearchParams) => {
    const qs = next.toString();
    navigate(qs ? `${location}?${qs}` : location, { replace: true });
  };
  const setView = (v: View) => {
    const next = new URLSearchParams(params);
    next.set("view", v);
    next.delete("item");
    go(next);
  };
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    go(next);
  };
  const openChecklist = (f: Record<string, string>) => {
    const next = new URLSearchParams({ view: "checklist", ...f });
    go(next);
  };
  const openItem = (id: string) => {
    const next = new URLSearchParams(params);
    next.set("item", id);
    go(next);
  };
  const closeItem = () => {
    const next = new URLSearchParams(params);
    next.delete("item");
    go(next);
  };

  const items = checklist.data?.items ?? [];
  const selected = selectedId ? items.find((i) => i.id === selectedId) ?? null : null;
  const requirementByCode = useMemo(
    () => new Map((requirements.data ?? []).map((r) => [r.code, r])),
    [requirements.data],
  );

  return (
    <HubLayout>
      <div className="space-y-5 pb-12">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <span
              className="flex h-11 w-11 items-center justify-center rounded-xl"
              style={{ background: "var(--cc-active-bg)", color: PLUM }}
            >
              <ClipboardCheck size={20} />
            </span>
            <div>
              <h1 className="text-xl font-semibold tracking-[-0.025em]" style={{ color: TEXT }}>
                Audit readiness
              </h1>
              <p className="mt-0.5 max-w-2xl text-[13px]" style={{ color: MUTED }}>
                What evidence you have, what's missing and what needs review. This tracks evidence readiness — it
                doesn't determine compliance or guarantee an audit outcome.
              </p>
            </div>
          </div>
          <Button variant="outline" className="shrink-0 gap-2" onClick={() => setSetupOpen(true)}>
            <Settings2 size={15} />
            Audit profile
          </Button>
        </div>

        <div role="tablist" className="flex gap-1 border-b" style={{ borderColor: BORDER }}>
          {VIEWS.map((v) => (
            <button
              key={v.key}
              role="tab"
              type="button"
              aria-selected={view === v.key}
              onClick={() => setView(v.key)}
              className="-mb-px border-b-2 px-3 py-2 text-[13px] font-semibold"
              style={{
                borderColor: view === v.key ? PLUM : "transparent",
                color: view === v.key ? PLUM : MUTED,
              }}
            >
              {v.label}
            </button>
          ))}
        </div>

        {checklist.isError ? (
          <div
            role="alert"
            className="flex items-center gap-2 rounded-xl border p-4 text-sm"
            style={{ borderColor: "var(--cc-status-danger)", color: "var(--cc-status-danger)" }}
          >
            <XCircle size={16} />
            Couldn't load the checklist.
            <button type="button" className="font-bold underline" onClick={() => checklist.refetch()}>
              Try again
            </button>
          </div>
        ) : !checklist.data ? (
          <p className="text-sm" style={{ color: MUTED }}>Loading…</p>
        ) : view === "overview" ? (
          <Overview data={checklist.data} openChecklist={openChecklist} openItem={openItem} openSetup={() => setSetupOpen(true)} />
        ) : view === "checklist" ? (
          <Checklist items={items} filters={filters} setFilter={setFilter} openItem={openItem} />
        ) : (
          <AuditPacks items={items} />
        )}

        {checklist.data && checklist.data.summary.critical_gaps > 0 && view !== "overview" && (
          <p className="flex items-center gap-2 text-[12px]" style={{ color: "var(--cc-status-danger)" }}>
            <AlertTriangle size={14} />
            {checklist.data.summary.critical_gaps} critical gap{checklist.data.summary.critical_gaps === 1 ? "" : "s"}
          </p>
        )}
      </div>

      <ItemSheet
        item={selected}
        requirement={selected ? requirementByCode.get(selected.requirement_code) : undefined}
        onClose={closeItem}
      />
      <SetupSheet open={setupOpen} onOpenChange={setSetupOpen} />
    </HubLayout>
  );
}
