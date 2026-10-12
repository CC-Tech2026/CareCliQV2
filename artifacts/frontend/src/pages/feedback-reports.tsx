import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useMutation } from "@tanstack/react-query";
import { Plus, MessageSquareWarning, PenLine, Send } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { SectionInfo } from "@/components/ui/section-info";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  EmptyState,
  LoadError,
  PageHeader,
  RowList,
  SkeletonBlocks,
  StatusText,
  SummaryStrip,
  Surface,
  ctaClass,
  outlineClass,
  type Tone,
} from "@/components/layout/PageKit";
import {
  Field,
  PanelFooter,
  PanelHeader,
  PrimaryButton,
  SecondaryButton,
  inputClass,
  textareaClass,
} from "@/pages/md/vault/components/PanelKit";
import { ResponseSheet, type ResponseTarget } from "@/components/feedback/ResponseSheet";
import {
  FEEDBACK_CATEGORIES, type FeedbackCategory, type FeedbackStatus, type OperationalFeedback,
  createOperationalFeedback, listOperationalFeedback, updateOperationalFeedbackStatus,
} from "@/services/operationalFeedbackService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

const STATUS_META: Record<FeedbackStatus, { label: string; tone: Tone }> = {
  open: { label: "Open", tone: "danger" },
  in_review: { label: "In review", tone: "warning" },
  resolved: { label: "Resolved", tone: "good" },
};

function categoryLabel(value: FeedbackCategory) {
  return FEEDBACK_CATEGORIES.find((c) => c.value === value)?.label ?? "Other";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function NewReportSheet({ onClose }: { onClose: () => void }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const qc = useQueryClient();
  const [category, setCategory] = useState<FeedbackCategory>("other");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const submitMut = useMutation({
    mutationFn: () => createOperationalFeedback({ category, title: title.trim(), description: description.trim() }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [orgId, "operational-feedback"] });
      toast({ title: "Report submitted" });
      onClose();
    },
    onError: (e: Error) => toast({ title: "Could not submit report", description: e.message, variant: "destructive" }),
  });

  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col overflow-y-auto sm:max-w-lg">
        <SheetTitle className="sr-only">New report</SheetTitle>
        <SheetDescription className="sr-only">Flag an operational issue.</SheetDescription>
        <PanelHeader
          icon={Send}
          title="New report"
          description="Flag something operational that isn't working. For anything involving participant safety, report an incident instead."
        />
        <form
          id="new-report-form"
          className="mt-6 flex-1 space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (title.trim() && description.trim()) submitMut.mutate();
          }}
        >
          <Field label="Category" htmlFor="report-category">
            <Select value={category} onValueChange={(v) => setCategory(v as FeedbackCategory)}>
              <SelectTrigger id="report-category" className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FEEDBACK_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Title" htmlFor="report-title">
            <input
              id="report-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Rostering app keeps logging me out mid-shift"
              className={inputClass}
              style={{ borderColor: BORDER, color: TEXT }}
            />
          </Field>
          <Field label="What's going on?" htmlFor="report-description">
            <textarea
              id="report-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what isn't working or what you'd like to flag."
              rows={6}
              className={textareaClass}
              style={{ borderColor: BORDER, color: TEXT }}
            />
          </Field>
        </form>
        <PanelFooter>
          <SecondaryButton onClick={onClose} disabled={submitMut.isPending}>Cancel</SecondaryButton>
          <PrimaryButton type="submit" form="new-report-form" busy={submitMut.isPending} disabled={!title.trim() || !description.trim()}>
            Submit report
          </PrimaryButton>
        </PanelFooter>
      </SheetContent>
    </Sheet>
  );
}

export default function FeedbackReports() {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const { toast } = useToast();
  const qc = useQueryClient();
  const canResolve = user?.role === "support_coordinator" || user?.role === "managing_director";

  const [newOpen, setNewOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | FeedbackStatus>("all");
  const [responding, setResponding] = useState<OperationalFeedback | null>(null);

  const feedbackQuery = useOrgQuery(["operational-feedback"], {
    queryFn: () => listOperationalFeedback(),
  });
  const allReports = feedbackQuery.data ?? [];
  const reports = allReports.filter((r) => statusFilter === "all" || r.status === statusFilter);
  const countOf = (s: FeedbackStatus) => allReports.filter((r) => r.status === s).length;

  const updateMut = useMutation({
    mutationFn: (vars: { id: string; status: FeedbackStatus; notes?: string }) =>
      updateOperationalFeedbackStatus(vars.id, vars.status, vars.notes),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [orgId, "operational-feedback"] });
      toast({ title: "Report updated", description: `Marked as ${STATUS_META[vars.status].label.toLowerCase()}.` });
      setResponding(null);
    },
    onError: (e: Error) => toast({ title: "Could not update report", description: e.message, variant: "destructive" }),
  });

  const target: ResponseTarget | null = responding && {
    id: responding.id,
    title: responding.title,
    context: `${categoryLabel(responding.category)} · ${responding.reporter_name} · Filed ${formatDate(responding.created_at)}`,
    description: responding.description,
    status: responding.status,
    notes: responding.resolution_notes,
  };

  return (
    <div className="space-y-8 pb-12">
      <PageHeader
        eyebrow="Oversight & Risk"
        title={
          <span className="inline-flex items-center gap-2">
            Feedback & Reports
            <SectionInfo text="Flag anything operational that isn't working: rostering, equipment, scheduling, communication. For participant-safety issues, use Report Incident instead." />
          </span>
        }
        description="Operational issues raised by your team, such as rostering, equipment and communication, and what was done about them."
        actions={
          <button type="button" className={`${ctaClass} w-full sm:w-auto`} onClick={() => setNewOpen(true)}>
            <Plus size={15} /> New report
          </button>
        }
      />

      {canResolve && (
        <SummaryStrip
          loading={feedbackQuery.isLoading}
          items={[
            { value: allReports.length, label: "reports", onClick: () => setStatusFilter("all"), active: statusFilter === "all" },
            { value: countOf("open"), label: "open", tone: countOf("open") ? "danger" : "good", onClick: () => setStatusFilter("open"), active: statusFilter === "open" },
            { value: countOf("in_review"), label: "in review", tone: countOf("in_review") ? "warning" : undefined, onClick: () => setStatusFilter("in_review"), active: statusFilter === "in_review" },
            { value: countOf("resolved"), label: "resolved", tone: "good", onClick: () => setStatusFilter("resolved"), active: statusFilter === "resolved" },
          ]}
        />
      )}

      {feedbackQuery.isLoading ? (
        <SkeletonBlocks count={3} />
      ) : feedbackQuery.isError ? (
        <LoadError onRetry={() => feedbackQuery.refetch()}>Feedback & Reports couldn't be loaded.</LoadError>
      ) : reports.length === 0 ? (
        <EmptyState
          icon={MessageSquareWarning}
          title={canResolve ? (statusFilter === "all" ? "No reports yet" : "No reports match") : "You haven't submitted any reports yet"}
          body={canResolve && statusFilter !== "all" ? "Try another status, or show every report." : "Reports your team raises will show here."}
          action={
            canResolve && statusFilter !== "all" ? (
              <button type="button" className={outlineClass} onClick={() => setStatusFilter("all")}>Show all reports</button>
            ) : undefined
          }
        />
      ) : (
        <Surface>
          <RowList>
            {reports.map((r) => {
              const meta = STATUS_META[r.status];
              return (
                <li key={r.id} className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:px-5">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cc-soft" style={{ color: MUTED }} aria-hidden="true">
                    <MessageSquareWarning size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <p className="text-sm font-semibold" style={{ color: TEXT }}>{r.title}</p>
                      <StatusText tone={meta.tone}>{meta.label}</StatusText>
                    </div>
                    <p className="mt-0.5 text-xs" style={{ color: MUTED }}>
                      {categoryLabel(r.category)}
                      {canResolve && ` · ${r.reporter_name}`} · Filed {formatDate(r.created_at)}
                    </p>
                    <p className="mt-2 text-sm leading-6" style={{ color: MUTED }}>{r.description}</p>
                    {r.resolution_notes && (
                      <p className="mt-2 rounded-xl bg-cc-soft px-3.5 py-2.5 text-sm leading-6" style={{ color: TEXT }}>
                        <span className="font-semibold">Response: </span>
                        {r.resolution_notes}
                        {r.resolved_at && <span className="block text-xs" style={{ color: MUTED }}>Updated {formatDate(r.resolved_at)}</span>}
                      </p>
                    )}
                  </div>
                  {canResolve && (
                    <button type="button" className={`${outlineClass} shrink-0 self-start`} onClick={() => setResponding(r)}>
                      <PenLine size={14} />
                      {r.status === "open" ? "Address report" : r.resolution_notes ? "Update response" : "Update status"}
                    </button>
                  )}
                </li>
              );
            })}
          </RowList>
        </Surface>
      )}

      {newOpen && <NewReportSheet onClose={() => setNewOpen(false)} />}
      <ResponseSheet
        target={target}
        onClose={() => setResponding(null)}
        busy={updateMut.isPending}
        noun="report"
        notesLabel="What was done about it?"
        notesPlaceholder="e.g. Raised with IT, rostering app updated to the latest build."
        onSave={(status, notes) => responding && updateMut.mutate({ id: responding.id, status, notes: notes || undefined })}
      />
    </div>
  );
}
