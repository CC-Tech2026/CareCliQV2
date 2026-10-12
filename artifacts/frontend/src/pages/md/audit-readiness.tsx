import { loadErrorHint } from "@/lib/load-error";
import { Fragment, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Download,
  FolderLock,
  Link2,
  Settings2,
  ShieldAlert,
  XCircle,
} from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import {
  EmptyState,
  LoadError,
  Notice,
  PageHeader,
  PillTabs,
  RowList,
  SearchField,
  Section,
  SkeletonBlocks,
  StatusText,
  SummaryStrip,
  Surface,
  ctaClass,
  ghostClass,
  outlineClass,
  rowClass,
  type Tone,
} from "@/components/layout/PageKit";
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
import { PanelHeader, PrimaryButton, SecondaryButton, textareaClass } from "@/pages/md/vault/components/PanelKit";

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

const STATUS_TONE: Record<ItemStatus | "rejected", Tone> = {
  missing: "danger",
  overdue: "danger",
  rejected: "danger",
  awaiting_review: "info",
  due_soon: "warning",
  current: "good",
  not_applicable: "neutral",
};

function StatusPill({ status }: { status: ItemStatus | "rejected" }) {
  return <StatusText tone={STATUS_TONE[status]}>{STATUS_LABELS[status]}</StatusText>;
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
  const areas = summary.by_area.filter((a) => a.total > 0);

  return (
    <div className="space-y-8">
      {!data.profile_configured && (
        <Notice
          tone="warning"
          icon={Settings2}
          title="Your audit profile isn't set up"
          action={<button type="button" className={outlineClass} onClick={openSetup}>Set up audit profile</button>}
        >
          Set your audit type and registration groups so the checklist only includes what applies to you.
          Until then, every audit type's requirements are included.
        </Notice>
      )}

      <SummaryStrip
        items={[
          {
            value: summary.readiness_percent === null ? "N/A" : `${summary.readiness_percent}%`,
            label: `evidence ready, ${summary.counts.current + summary.counts.due_soon} of ${summary.applicable} items`,
            onClick: () => openChecklist({}),
          },
          {
            value: summary.critical_gaps,
            label: "critical gaps",
            tone: summary.critical_gaps ? "danger" : "good",
            onClick: () => openChecklist({ critical: "1", status: "gaps" }),
          },
          {
            value: summary.counts.awaiting_review,
            label: "awaiting review",
            tone: summary.counts.awaiting_review ? "info" : undefined,
            onClick: () => openChecklist({ status: "awaiting_review" }),
          },
          {
            value: summary.counts.due_soon,
            label: "due within 60 days",
            tone: summary.counts.due_soon ? "warning" : undefined,
            onClick: () => openChecklist({ status: "due_soon" }),
          },
        ]}
      />

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="By area" description="How much of each practice standard area has current evidence.">
          <Surface>
            {areas.length === 0 ? (
              <p className="px-5 py-6 text-sm leading-6" style={{ color: MUTED }}>
                No requirements are listed yet. Review your audit profile to confirm the areas that apply to your organisation.
              </p>
            ) : (
              <RowList>
                {areas.map((area) => {
                  const pct = area.total ? Math.round((100 * area.ready) / area.total) : 0;
                  return (
                    <li key={area.area}>
                      <button type="button" onClick={() => openChecklist({ area: area.area })} className={`${rowClass} flex-col items-stretch gap-2`}>
                        <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <span className="text-sm font-semibold" style={{ color: TEXT }}>{area.label}</span>
                          <span className="text-xs tabular-nums" style={{ color: MUTED }}>
                            {area.ready}/{area.total} ready
                            {area.gaps ? <span className="font-semibold" style={{ color: "var(--cc-danger-text)" }}> · {area.gaps} gaps</span> : null}
                          </span>
                        </span>
                        <span className="block h-1.5 overflow-hidden rounded-full" style={{ background: "var(--cc-soft)" }}>
                          <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: PLUM }} />
                        </span>
                      </button>
                    </li>
                  );
                })}
              </RowList>
            )}
          </Surface>
        </Section>

        <Section
          title="Critical gaps"
          description="Critical requirements with missing or overdue evidence."
          action={
            summary.critical_gaps > criticalGaps.length ? (
              <button type="button" className={ghostClass} onClick={() => openChecklist({ critical: "1", status: "gaps" })}>
                See all {summary.critical_gaps}
              </button>
            ) : undefined
          }
        >
          <Surface>
            {criticalGaps.length === 0 ? (
              <p className="flex items-center gap-2 px-5 py-6 text-sm" style={{ color: MUTED }}>
                <CheckCircle2 size={16} style={{ color: "var(--cc-green)" }} />
                No critical item is missing or overdue.
              </p>
            ) : (
              <RowList>
                {criticalGaps.map((item) => (
                  <li key={item.id}>
                    <button type="button" onClick={() => openItem(item.id)} className={rowClass}>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold" style={{ color: TEXT }}>{item.title}</span>
                        <span className="block truncate text-xs" style={{ color: MUTED }}>{item.subject_name}</span>
                      </span>
                      <StatusPill status={item.status} />
                    </button>
                  </li>
                ))}
              </RowList>
            )}
          </Surface>
        </Section>
      </div>
    </div>
  );
}

// ── Checklist ────────────────────────────────────────────────────────────

const CHECKLIST_PAGE = 30;

function Checklist({
  items,
  filters,
  setFilter,
  clearFilters,
  openItem,
}: {
  items: AuditItem[];
  filters: Record<string, string>;
  setFilter: (key: string, value: string) => void;
  clearFilters: () => void;
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

  const selectClass = "min-h-10 max-w-full rounded-full border bg-cc-surface px-4 text-sm outline-none focus:ring-2 focus:ring-cc-plum";
  const selectStyle = { borderColor: BORDER, color: TEXT };
  const criticalOnly = filters.critical === "1";
  const anyFilter = FILTER_KEYS.some((key) => filters[key]);
  const [shown, setShown] = useState(CHECKLIST_PAGE);
  useEffect(() => setShown(CHECKLIST_PAGE), [filters]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <SearchField
          label="Search requirements or people"
          placeholder="Search requirement or person"
          value={filters.q ?? ""}
          onChange={(value) => setFilter("q", value)}
        />
        <div className="flex flex-wrap items-center gap-2">
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
          <button
            type="button"
            aria-pressed={criticalOnly}
            onClick={() => setFilter("critical", criticalOnly ? "" : "1")}
            className="inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-medium transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum"
            style={criticalOnly ? { background: "var(--cc-text)", color: "var(--cc-bg)" } : { color: TEXT, boxShadow: `inset 0 0 0 1px ${BORDER}` }}
          >
            <ShieldAlert size={15} />
            Critical only
          </button>
        </div>
      </div>

      <div className="flex min-h-11 items-center justify-between gap-3">
        <p className="text-sm" style={{ color: MUTED }}>
          {filtered.length} of {items.length} items
        </p>
        {anyFilter && (
          <button type="button" className={ghostClass} onClick={clearFilters}>
            Clear filters
          </button>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No items match" body="Try another search, or clear the filters." />
      ) : (
        <Surface>
          <RowList>
            {filtered.slice(0, shown).map((item) => (
              <li key={item.id}>
                <button type="button" onClick={() => openItem(item.id)} className={`${rowClass} flex-wrap`}>
                  <span className="min-w-0 basis-48 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="break-words text-sm font-semibold" style={{ color: TEXT }}>{item.title}</span>
                      {item.critical && <StatusText tone="danger">Critical</StatusText>}
                    </span>
                    <span className="block truncate text-xs" style={{ color: MUTED }}>
                      {SUBJECT_LABELS[item.subject_type]} · {item.subject_name}
                      {item.due_date ? ` · due ${fmtDate(item.due_date)}` : ""}
                    </span>
                  </span>
                  <StatusPill status={item.status} />
                  <span className="block w-full text-xs leading-5" style={{ color: MUTED }}>Next step: {item.next_action}</span>
                </button>
              </li>
            ))}
          </RowList>
          {filtered.length > shown && (
            <div className="border-t px-4 py-3 text-center sm:px-5" style={{ borderColor: BORDER }}>
              <button type="button" className={outlineClass} onClick={() => setShown((n) => n + CHECKLIST_PAGE)}>
                Show {Math.min(CHECKLIST_PAGE, filtered.length - shown)} more of {filtered.length - shown}
              </button>
            </div>
          )}
        </Surface>
      )}
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
    <div className="rounded-2xl border p-4" style={{ borderColor: BORDER }}>
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

      <div className="mt-3 flex flex-wrap gap-2">
        {evidence.vault_category && (
          <Link
            href={`/md/vault/${encodeURIComponent(evidence.vault_category)}`}
            className={outlineClass}
          >
            Open in vault
          </Link>
        )}
        {canReview && mode === "idle" && (
          <>
            <button type="button" className={outlineClass} style={{ color: "var(--cc-green)" }} onClick={() => setMode("approve")}>
              {evidence.review_status === "approved" ? "Re-review" : "Approve"}
            </button>
            <button type="button" className={outlineClass} style={{ color: "var(--cc-danger-text)" }} onClick={() => setMode("reject")}>
              Reject
            </button>
          </>
        )}
        {evidence.kind === "linked" && evidence.link_id && mode === "idle" && (
          <button
            type="button"
            className={ghostClass}
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
          <div className="flex flex-wrap gap-2">
            <SecondaryButton onClick={() => setMode("idle")}>Cancel</SecondaryButton>
            <PrimaryButton
              tone={mode === "reject" ? "danger" : "brand"}
              busy={busy}
              disabled={mode === "reject" && !note.trim()}
              onClick={() =>
                run(
                  () => reviewEvidence(item, evidence, mode === "approve" ? "approved" : "rejected", { note, expiry_date: expiry || null }),
                  mode === "approve" ? "Evidence approved" : "Evidence rejected",
                )
              }
            >
              {mode === "approve" ? "Approve" : "Reject"}
            </PrimaryButton>
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
    <div className="space-y-2 rounded-2xl border p-3.5" style={{ borderColor: BORDER }}>
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
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        {item && (
          <>
            <SheetTitle className="sr-only">{item.title}</SheetTitle>
            <SheetDescription className="sr-only">
              {SUBJECT_LABELS[item.subject_type]} · {item.subject_name}
            </SheetDescription>
            <PanelHeader
              icon={ClipboardCheck}
              title={item.title}
              description={
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span>{SUBJECT_LABELS[item.subject_type]} · {item.subject_name}</span>
                  <StatusPill status={item.status} />
                  {item.critical && <StatusText tone="danger">Critical</StatusText>}
                </span>
              }
            />

            <div className="mt-6 space-y-6 text-sm">
              <section
                className="rounded-2xl px-4 py-3"
                style={{ background: item.status === "current" ? "var(--cc-soft)" : STATUS_STYLE[item.status].bg }}
              >
                <p className="text-xs font-semibold" style={{ color: MUTED }}>Next action</p>
                <p className="mt-1 leading-6" style={{ color: TEXT }}>{item.next_action}</p>
              </section>

              {requirement && (
                <section className="space-y-2">
                  <p style={{ color: TEXT }}>{requirement.description}</p>
                  <dl className="grid grid-cols-[120px_1fr] gap-x-3 gap-y-2 rounded-2xl border p-4 text-[13px]" style={{ borderColor: BORDER }}>
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
                <section className="rounded-2xl border p-4" style={{ borderColor: BORDER }}>
                  <p className="font-semibold" style={{ color: TEXT }}>Marked not applicable</p>
                  <p className="mt-1" style={{ color: TEXT }}>{item.not_applicable.reason}</p>
                  <p className="mt-1 text-[11px]" style={{ color: MUTED }}>
                    Approved by {item.not_applicable.approved_by ?? "a managing director"} on {fmtDate(item.not_applicable.approved_at)}
                  </p>
                </section>
              ) : null}

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold" style={{ color: TEXT }}>Evidence</h3>
                  {!item.not_applicable && (
                    <button type="button" className={outlineClass} onClick={() => setLinking((v) => !v)}>
                      <Link2 size={14} />
                      {linking ? "Close" : "Link from vault"}
                    </button>
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
                    className={`${ghostClass} -ml-4`}
                    style={{ color: MUTED }}
                    onClick={() => setNaOpen(true)}
                  >
                    {item.not_applicable ? "Revoke not-applicable decision" : "Mark not applicable"}
                  </button>
                ) : (
                  <div className="space-y-2">
                    <textarea
                      className={textareaClass}
                      style={{ borderColor: BORDER, color: TEXT }}
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
                    <div className="flex flex-wrap gap-2">
                      <SecondaryButton onClick={() => setNaOpen(false)}>Cancel</SecondaryButton>
                      <PrimaryButton
                        busy={busy}
                        disabled={!item.not_applicable && reason.trim().length < 10}
                        onClick={saveNa}
                      >
                        {item.not_applicable ? "Revoke" : "Approve as not applicable"}
                      </PrimaryButton>
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
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetTitle className="sr-only">Audit profile</SheetTitle>
        <SheetDescription className="sr-only">Decides which requirements are on your checklist.</SheetDescription>
        <PanelHeader
          icon={Settings2}
          title="Audit profile"
          description="Decides which requirements are on your checklist. Your auditor sets the final scope from your registration."
        />
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
                    aria-pressed={auditType === t.value}
                    className="min-h-10 rounded-full px-4 text-sm font-medium transition hover:bg-cc-soft"
                    style={
                      auditType === t.value
                        ? { background: "var(--cc-text)", color: "var(--cc-bg)" }
                        : { color: TEXT, boxShadow: `inset 0 0 0 1px ${BORDER}` }
                    }
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
              <div className="max-h-64 space-y-1.5 overflow-y-auto rounded-2xl border p-3" style={{ borderColor: BORDER }}>
                {options.registration_groups.map((g) => (
                  <label key={g.code} className="flex items-start gap-2" style={{ color: TEXT }}>
                    <Checkbox className="mt-0.5" checked={groups.has(g.code)} onCheckedChange={() => toggle(groups, g.code, setGroups)} />
                    <span><span style={{ color: MUTED }}>{g.code}</span> {g.label}</span>
                  </label>
                ))}
              </div>
            </section>

            <PrimaryButton onClick={save} busy={saving}>
              {saving ? "Saving…" : "Save profile"}
            </PrimaryButton>

            <section className="space-y-2 border-t pt-4" style={{ borderColor: BORDER }}>
              <h3 className="font-bold" style={{ color: TEXT }}>Requirements</h3>
              <p style={{ color: MUTED }}>
                Switch off anything that isn't part of how you operate, and set your own review cycles — for example
                how often you recheck police checks.
              </p>
              {(requirementsQuery.data ?? []).map((req) => (
                <div key={req.code} className="rounded-2xl border p-3.5" style={{ borderColor: BORDER, opacity: req.applies ? 1 : 0.6 }}>
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
    <div className="grid gap-8 lg:grid-cols-2">
      <Section title="Outstanding items report" description="Everything that still needs evidence, review or renewal.">
        <Surface className="p-5">
          <p className="flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums tracking-tight" style={{ color: outstanding.length ? "var(--cc-amber)" : "var(--cc-green)" }}>
              {outstanding.length}
            </span>
            <span className="text-sm" style={{ color: MUTED }}>{outstanding.length === 1 ? "action" : "actions"} to follow up</span>
          </p>
          <p className="mt-2 text-sm leading-6" style={{ color: MUTED }}>
            Download them as a spreadsheet to share with whoever is following them up.
          </p>
          <button type="button" className={`${outlineClass} mt-4`} onClick={download} disabled={outstanding.length === 0}>
            <Download size={15} />
            Download CSV
          </button>
        </Surface>
      </Section>
      <Section title="Share evidence with an auditor" description="Pick the supporting records in the vault and share them from there.">
        <Surface className="p-5">
          <p className="text-sm leading-6" style={{ color: MUTED }}>
            The vault keeps every participant, worker and governance record in folders. Use its sharing tools to send an
            auditor exactly what they need, and the outstanding items report to track follow-up.
          </p>
          <Link href="/md/vault" className={`${ctaClass} mt-4`}>
            <FolderLock size={15} />
            Open the vault
          </Link>
        </Surface>
      </Section>
    </div>
  );
}

// ── Page ─────────────────────────────────────────────────────────────────

const FILTER_KEYS = ["area", "scope", "status", "critical", "q"] as const;

export default function AuditReadinessPage({ embedded = false }: { embedded?: boolean }) {
  const Layout = embedded ? Fragment : HubLayout;
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

  const clearFilters = () => {
    const next = new URLSearchParams(params);
    for (const key of FILTER_KEYS) next.delete(key);
    go(next);
  };

  return (
    <Layout>
      <div className="space-y-6 pb-12">
        {!embedded && (
          <PageHeader
            eyebrow="Oversight & Risk"
            title={view === "checklist" ? "Evidence checklist" : view === "packs" ? "Prepare an audit pack" : "Evidence overview"}
          />
        )}
        {!embedded && <PillTabs label="Audit readiness views" value={view} onChange={setView} options={VIEWS} />}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm leading-6" style={{ color: MUTED }}>
            What evidence you have, what's missing and what needs review. This tracks evidence readiness. It
            doesn't determine compliance or guarantee an audit outcome.
          </p>
          <button type="button" className={`${outlineClass} shrink-0`} onClick={() => setSetupOpen(true)}>
            <Settings2 size={15} />
            Audit profile
          </button>
        </div>

        {checklist.isError ? (
          <LoadError onRetry={() => checklist.refetch()}>
            <XCircle size={16} style={{ color: "var(--cc-danger-text)" }} />
            <span>
              <span className="font-semibold">Couldn't load the checklist.</span>
              {loadErrorHint(checklist.error) && <span style={{ color: MUTED }}> {loadErrorHint(checklist.error)}</span>}
            </span>
          </LoadError>
        ) : !checklist.data ? (
          <SkeletonBlocks count={3} height="h-24" />
        ) : view === "overview" ? (
          <Overview data={checklist.data} openChecklist={openChecklist} openItem={openItem} openSetup={() => setSetupOpen(true)} />
        ) : view === "checklist" ? (
          <Checklist items={items} filters={filters} setFilter={setFilter} clearFilters={clearFilters} openItem={openItem} />
        ) : (
          <AuditPacks items={items} />
        )}

        {checklist.data && checklist.data.summary.critical_gaps > 0 && view !== "overview" && (
          <p className="flex items-center gap-2 text-sm font-semibold" style={{ color: "var(--cc-danger-text)" }}>
            <AlertTriangle size={15} />
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
    </Layout>
  );
}
