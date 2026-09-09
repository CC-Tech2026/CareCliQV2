import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useMutation } from "@tanstack/react-query";
import { Plus, PenLine, CheckCircle2, MessageSquareWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { SectionInfo } from "@/components/ui/section-info";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  FEEDBACK_CATEGORIES, type FeedbackCategory, type FeedbackStatus, type OperationalFeedback,
  createOperationalFeedback, listOperationalFeedback, updateOperationalFeedbackStatus,
} from "@/services/operationalFeedbackService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const SUCCESS = "var(--cc-status-success)";
const SUCCESS_BG = "var(--cc-status-success-bg)";
const WARNING = "var(--cc-status-warning)";
const WARNING_BG = "var(--cc-status-warning-bg)";
const DANGER = "var(--cc-status-danger)";
const DANGER_BG = "var(--cc-status-danger-bg)";

const STATUS_META: Record<FeedbackStatus, { label: string; bg: string; color: string }> = {
  open: { label: "Open", bg: DANGER_BG, color: DANGER },
  in_review: { label: "In review", bg: WARNING_BG, color: WARNING },
  resolved: { label: "Resolved", bg: SUCCESS_BG, color: SUCCESS },
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
      <SheetContent side="right" className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>New Report</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div>
            <label className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Category</label>
            <Select value={category} onValueChange={(v) => setCategory(v as FeedbackCategory)}>
              <SelectTrigger className="mt-1.5 h-10"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FEEDBACK_CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Title</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Rostering app keeps logging me out mid-shift"
              className="mt-1.5"
            />
          </div>
          <div>
            <label className="text-[11px] font-black uppercase tracking-wide" style={{ color: MUTED }}>What's going on?</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what isn't working or what you'd like to flag. This is for operational issues — for anything involving participant safety, use Report Incident instead."
              className="mt-1.5 min-h-[140px]"
            />
          </div>
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            variant="navy"
            onClick={() => submitMut.mutate()}
            disabled={!title.trim() || !description.trim() || submitMut.isPending}
          >
            Submit report
          </Button>
        </SheetFooter>
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
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState<FeedbackStatus>("in_review");
  const [draftNotes, setDraftNotes] = useState("");

  const feedbackQuery = useOrgQuery(["operational-feedback"], {
    queryFn: () => listOperationalFeedback(),
  });
  const allReports = feedbackQuery.data ?? [];
  const reports = allReports.filter((r) => statusFilter === "all" || r.status === statusFilter);
  const openCount = allReports.filter((r) => r.status === "open").length;

  const updateMut = useMutation({
    mutationFn: (vars: { id: string; status: FeedbackStatus; notes?: string }) =>
      updateOperationalFeedbackStatus(vars.id, vars.status, vars.notes),
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: [orgId, "operational-feedback"] });
      toast({ title: "Report updated", description: `Marked as ${STATUS_META[vars.status].label.toLowerCase()}.` });
      setRespondingId(null);
      setDraftNotes("");
    },
    onError: (e: Error) => toast({ title: "Could not update report", description: e.message, variant: "destructive" }),
  });

  function startResponding(r: OperationalFeedback) {
    setRespondingId(r.id);
    setDraftStatus(r.status === "open" ? "in_review" : r.status);
    setDraftNotes(r.resolution_notes ?? "");
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6 pb-16">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight" style={{ color: TEXT }}>
            Feedback & Reports
            <SectionInfo text="Flag anything operational that isn't working: rostering, equipment, scheduling, communication. For participant-safety issues, use Report Incident instead." />
          </h1>
          {canResolve && (
            <p className="mt-0.5 text-[12px] font-medium" style={{ color: MUTED }}>
              {allReports.length} total · {openCount} open
            </p>
          )}
        </div>
        <Button variant="navy" className="gap-1.5" onClick={() => setNewOpen(true)}>
          <Plus size={15} /> New Report
        </Button>
      </div>

      {canResolve && (
        <div className="flex items-center gap-0.5 rounded-xl p-1 w-fit" style={{ background: SOFT }}>
          {(["all", "open", "in_review", "resolved"] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className="h-8 rounded-lg px-3 text-[11px] font-black transition-all"
              style={{
                background: statusFilter === s ? "var(--cc-surface)" : "transparent",
                color: statusFilter === s ? PLUM : MUTED,
                boxShadow: statusFilter === s ? "var(--cc-shadow-sm)" : "none",
              }}
            >
              {s === "all" ? "All" : STATUS_META[s].label}
            </button>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border" style={{ borderColor: BORDER, background: "var(--cc-surface)" }}>
        {feedbackQuery.isLoading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl" style={{ background: SOFT }} />)}
          </div>
        ) : feedbackQuery.isError ? (
          <div className="p-8 text-center">
            <p className="font-black" style={{ color: TEXT }}>Could not load Feedback & Reports</p>
            <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>Reload the page to try again.</p>
          </div>
        ) : reports.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-5 py-14 text-center">
            <MessageSquareWarning size={28} style={{ color: MUTED }} />
            <p className="text-[12px] font-medium" style={{ color: MUTED }}>
              {canResolve ? "No reports match the current filter." : "You haven't submitted any reports yet."}
            </p>
          </div>
        ) : (
          <div className="divide-y" style={{ borderColor: BORDER }}>
            {reports.map((r) => {
              const meta = STATUS_META[r.status];
              const responding = respondingId === r.id;
              return (
                <div key={r.id} className="p-5">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <p className="text-sm font-black" style={{ color: TEXT }}>{r.title}</p>
                      <p className="mt-0.5 text-[11px] font-medium" style={{ color: MUTED }}>
                        {categoryLabel(r.category)}
                        {canResolve && ` · ${r.reporter_name}`} · Filed {formatDate(r.created_at)}
                      </p>
                    </div>
                    <span className="text-[10px] font-black px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: meta.bg, color: meta.color }}>
                      {meta.label}
                    </span>
                  </div>
                  <p className="mt-3 text-xs leading-5" style={{ color: MUTED }}>{r.description}</p>

                  {r.resolution_notes && !responding && (
                    <div className="mt-3 rounded-lg p-3" style={{ background: r.status === "resolved" ? SUCCESS_BG : WARNING_BG }}>
                      <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: r.status === "resolved" ? SUCCESS : WARNING }}>
                        Response
                      </p>
                      <p className="mt-1 text-xs leading-5" style={{ color: TEXT }}>{r.resolution_notes}</p>
                      {r.resolved_at && <p className="mt-1.5 text-[10px] font-medium" style={{ color: MUTED }}>Updated {formatDate(r.resolved_at)}</p>}
                    </div>
                  )}

                  {canResolve && (
                    !responding ? (
                      <Button variant="outline" size="sm" className="mt-3 gap-1.5 rounded-lg" onClick={() => startResponding(r)}>
                        <PenLine size={13} /> {r.status === "open" ? "Address report" : r.resolution_notes ? "Update response" : "Update status"}
                      </Button>
                    ) : (
                      <div className="mt-3 space-y-2 rounded-lg border p-3" style={{ background: SOFT, borderColor: BORDER }}>
                        <label className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>Mark as</label>
                        <Select value={draftStatus} onValueChange={(v) => setDraftStatus(v as FeedbackStatus)}>
                          <SelectTrigger className="h-9 text-sm bg-white"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="in_review">In review</SelectItem>
                            <SelectItem value="resolved">Resolved</SelectItem>
                          </SelectContent>
                        </Select>
                        {draftStatus === "resolved" && (
                          <>
                            <label className="text-[10px] font-black uppercase tracking-wide block pt-1" style={{ color: MUTED }}>
                              What was done about it?
                            </label>
                            <Textarea
                              value={draftNotes}
                              onChange={(e) => setDraftNotes(e.target.value)}
                              placeholder="e.g. Raised with IT, rostering app updated to the latest build."
                              className="min-h-[80px] text-sm bg-white"
                            />
                          </>
                        )}
                        <div className="flex gap-2 pt-1">
                          <Button variant="outline" size="sm" className="rounded-lg" onClick={() => setRespondingId(null)}>Cancel</Button>
                          <Button
                            variant="navy"
                            size="sm"
                            className="gap-1.5 rounded-lg"
                            onClick={() => updateMut.mutate({ id: r.id, status: draftStatus, notes: draftNotes.trim() || undefined })}
                            disabled={draftStatus === "resolved" && !draftNotes.trim()}
                          >
                            <CheckCircle2 size={13} /> Save
                          </Button>
                        </div>
                      </div>
                    )
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {newOpen && <NewReportSheet onClose={() => setNewOpen(false)} />}
    </div>
  );
}
