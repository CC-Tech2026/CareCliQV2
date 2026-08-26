import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  AlertCircle, ArrowLeft, BookOpen, CheckCircle2, ChevronRight, Clock, FileText,
  GraduationCap, Hourglass, Plus, Send, ShieldAlert,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { SectionInfo } from "@/components/ui/section-info";
import { useToast } from "@/hooks/use-toast";
import { BORDER, CORAL, MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import {
  createTrainingRequest,
  getTrainingHistory,
  getTrainingModules,
  getTrainingRecommendations,
  getTrainingRequests,
  markTrainingComplete,
  startTrainingModule,
  type TrainingModule,
  type TrainingRecommendation,
} from "@/services/workerPerformanceService";

const REQUEST_STATUS_KEYS: Record<string, string> = {
  pending: "training.requestStatus.pending",
  approved: "training.requestStatus.approved",
  rejected: "training.requestStatus.rejected",
};

type ModuleRow = {
  module: TrainingModule;
  recommendation: TrainingRecommendation | null;
  status: string;
  overdue: boolean;
};

function rowStatusMeta(row: ModuleRow): { label: string; bg: string; color: string } {
  if (row.overdue) return { label: "training.status.overdueLabel", bg: "var(--cc-status-danger-bg)", color: "var(--cc-status-danger)" };
  if (row.status === "confirmed") return { label: "training.status.current", bg: "#ECFDF5", color: "#059669" };
  if (row.status === "awaiting_confirmation") return { label: "training.status.pendingReview", bg: "#FFFBEB", color: "#D97706" };
  if (row.status === "rejected") return { label: "training.status.rejected", bg: "#FEF2F2", color: "#DC2626" };
  if (row.recommendation) return { label: "training.status.assigned", bg: "var(--cc-status-warning-bg)", color: "var(--cc-status-warning)" };
  return { label: "training.status.available", bg: "var(--cc-soft)", color: MUTED };
}

export default function WorkerTrainingPage() {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"modules" | "requests">("modules");
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);

  const modulesQuery = useOrgQuery(["worker", "training-modules"], { queryFn: getTrainingModules });
  const requestsQuery = useOrgQuery(["worker", "training-requests"], { queryFn: getTrainingRequests });
  const historyQuery = useOrgQuery(["worker", "training-history"], { queryFn: getTrainingHistory });
  const recommendationsQuery = useOrgQuery(["worker", "training-recommendations"], { queryFn: getTrainingRecommendations });

  const historyByModule = useMemo(
    () => new Map(
      (historyQuery.data?.history ?? []).map((h) => [String((h as Record<string, unknown>).module_id), h as Record<string, unknown>]),
    ),
    [historyQuery.data],
  );
  const recommendationByModule = useMemo(
    () => new Map((recommendationsQuery.data?.recommendations ?? []).map((r) => [r.training_module_id, r])),
    [recommendationsQuery.data],
  );

  const rows: ModuleRow[] = useMemo(() => (modulesQuery.data?.modules ?? []).map((module) => {
    const recommendation = recommendationByModule.get(module.id) ?? null;
    const status = String(historyByModule.get(module.id)?.status ?? "not_started");
    const overdue = !!recommendation?.due_at
      && new Date(recommendation.due_at).getTime() < Date.now()
      && status !== "confirmed" && status !== "awaiting_confirmation";
    return { module, recommendation, status, overdue };
  }).sort((a, b) => {
    const rank = (r: ModuleRow) => (r.overdue ? 0 : r.recommendation && r.status === "not_started" ? 1 : r.status === "confirmed" ? 3 : 2);
    return rank(a) - rank(b);
  }), [modulesQuery.data, recommendationByModule, historyByModule]);

  const assignedCount = rows.filter((r) => r.recommendation && r.status !== "confirmed").length;
  const overdueCount = rows.filter((r) => r.overdue).length;
  const completedCount = rows.filter((r) => r.status === "confirmed").length;

  const completeMut = useMutation({
    mutationFn: (moduleId: string) =>
      markTrainingComplete({
        module_id: moduleId,
        completed_at: format(new Date(), "yyyy-MM-dd"),
        acknowledged: true,
      }),
    onSuccess: () => {
      toast({
        title: translate("training.toast.submittedTitle"),
        description: translate("training.toast.submittedDesc"),
      });
      setOpenModuleId(null);
      void queryClient.invalidateQueries({ queryKey: ["worker", "training-history"] });
      void queryClient.invalidateQueries({ queryKey: ["worker", "training-recommendations"] });
    },
    onError: (e: Error) =>
      toast({ title: translate("training.toast.failed"), description: e.message, variant: "destructive" }),
  });

  const requestMut = useMutation({
    mutationFn: () => createTrainingRequest({ request_text: requestText, reason: requestReason, urgent }),
    onSuccess: () => {
      toast({
        title: translate("training.toast.requestSentTitle"),
        description: translate("training.toast.requestSentDesc"),
      });
      setRequestOpen(false);
      setRequestText("");
      setRequestReason("");
      setUrgent(false);
      void queryClient.invalidateQueries({ queryKey: ["worker", "training-requests"] });
    },
    onError: (e: Error) =>
      toast({ title: translate("training.toast.failed"), description: e.message, variant: "destructive" }),
  });

  const isLoading = modulesQuery.isLoading || recommendationsQuery.isLoading || historyQuery.isLoading;

  const tabs = [
    { id: "modules" as const, label: translate("training.tab.training"), badge: assignedCount },
    { id: "requests" as const, label: translate("training.tab.requests") },
  ];

  return (
    <div className="w-full space-y-5 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
            {translate("performance.eyebrow")}
          </p>
          <h1 className="mt-1 flex items-center gap-2 text-3xl font-black tracking-tight" style={{ color: TEXT }}>
            {translate("training.title")}
            <SectionInfo text="Required and optional courses, certifications, and training requests." />
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setRequestOpen(true)}
          className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-black text-white shadow-sm"
          style={{ background: PLUM }}
        >
          <Plus size={16} />
          {translate("training.request")}
        </button>
      </header>

      {!openModuleId && (
        <div className="grid grid-cols-3 divide-x rounded-2xl border bg-card" style={{ borderColor: BORDER }}>
          <div className="px-4 py-3.5">
            <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>{translate("training.stat.assigned")}</p>
            <p className="text-lg font-black tabular-nums mt-0.5" style={{ color: TEXT }}>{assignedCount}</p>
          </div>
          <div className="px-4 py-3.5">
            <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>{translate("training.stat.overdue")}</p>
            <p className="text-lg font-black tabular-nums mt-0.5" style={{ color: overdueCount > 0 ? "var(--cc-status-danger)" : TEXT }}>{overdueCount}</p>
          </div>
          <div className="px-4 py-3.5">
            <p className="text-[10px] font-black uppercase tracking-wide" style={{ color: MUTED }}>{translate("training.stat.completed")}</p>
            <p className="text-lg font-black tabular-nums mt-0.5" style={{ color: TEXT }}>{completedCount}</p>
          </div>
        </div>
      )}

      {!openModuleId && (
        <div className="flex rounded-full bg-cc-bg p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className="relative flex-1 rounded-full py-2.5 text-xs font-black transition sm:text-sm"
              style={{
                background: tab === t.id ? "var(--cc-surface)" : "transparent",
                color: tab === t.id ? TEXT : MUTED,
                boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
              }}
            >
              {t.label}
              {!!t.badge && (
                <span
                  className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1.5 py-0.5 text-[10px] font-black text-white"
                  style={{ background: PLUM }}
                >
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {tab === "modules" && openModuleId && (
        <TrainingModuleDetail
          module={(modulesQuery.data?.modules ?? []).find((m) => m.id === openModuleId) ?? null}
          recommendation={recommendationByModule.get(openModuleId) ?? null}
          historyRecord={historyByModule.get(openModuleId) ?? null}
          onBack={() => setOpenModuleId(null)}
          onComplete={() => completeMut.mutate(openModuleId)}
          completing={completeMut.isPending}
          translate={translate}
          translateParams={translateParams}
        />
      )}

      {tab === "modules" && !openModuleId && (
        isLoading ? (
          <p className="py-8 text-center text-sm font-medium" style={{ color: MUTED }}>{translate("common.loading")}</p>
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border bg-card p-8 text-center" style={{ borderColor: BORDER }}>
            <GraduationCap size={26} className="mx-auto mb-2" style={{ color: MUTED }} />
            <p className="text-sm font-medium" style={{ color: MUTED }}>{translate("training.noModules")}</p>
          </div>
        ) : (
          <div className="rounded-2xl border divide-y bg-card" style={{ borderColor: BORDER }}>
            {rows.map((row) => {
              const meta = rowStatusMeta(row);
              return (
                <button
                  key={row.module.id}
                  type="button"
                  onClick={() => setOpenModuleId(row.module.id)}
                  className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-cc-bg"
                >
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                    style={{ background: row.overdue ? "var(--cc-status-danger-bg)" : "var(--cc-soft)" }}
                  >
                    {row.overdue ? (
                      <Hourglass size={15} style={{ color: "var(--cc-status-danger)" }} />
                    ) : (
                      <GraduationCap size={15} style={{ color: PLUM }} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold truncate" style={{ color: TEXT }}>{row.module.title}</p>
                    <p className="text-xs mt-0.5 truncate" style={{ color: MUTED }}>
                      {row.status === "confirmed" && historyByModule.get(row.module.id)?.completed_at
                        ? translateParams("training.completedOn", { date: String(historyByModule.get(row.module.id)?.completed_at) })
                        : row.recommendation?.due_at
                          ? (row.overdue
                            ? translateParams("training.overdueSince", { date: format(parseISO(row.recommendation.due_at), "d MMM yyyy") })
                            : translateParams("training.dueBy", { date: format(parseISO(row.recommendation.due_at), "d MMM yyyy") }))
                          : row.module.description || translate("training.status.available")}
                    </p>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase"
                    style={{ background: meta.bg, color: meta.color }}
                  >
                    {translate(meta.label)}
                  </span>
                  <ChevronRight size={16} style={{ color: MUTED }} className="shrink-0" />
                </button>
              );
            })}
          </div>
        )
      )}

      {tab === "requests" && (
        <div className="space-y-3">
          {(requestsQuery.data?.requests ?? []).map((req: Record<string, unknown>) => {
            const status = String(req.status ?? "pending");
            const isPending = status === "pending";
            const statusKey = REQUEST_STATUS_KEYS[status];
            return (
              <div key={String(req.id)} className="rounded-2xl border bg-card p-4" style={{ borderColor: BORDER }}>
                <div className="flex items-center gap-2">
                  {isPending ? (
                    <Clock size={16} style={{ color: "#D97706" }} />
                  ) : status === "approved" ? (
                    <CheckCircle2 size={16} className="text-emerald-600" />
                  ) : (
                    <AlertCircle size={16} className="text-red-600" />
                  )}
                  <span className="text-xs font-black uppercase" style={{ color: MUTED }}>
                    {statusKey ? translate(statusKey) : status}
                  </span>
                  {Boolean(req.urgent) && (
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-black" style={{ background: "var(--cc-status-critical-bg)", color: CORAL }}>
                      {translate("training.urgent")}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm font-bold" style={{ color: TEXT }}>{String(req.request_text)}</p>
                <p className="mt-1 text-xs" style={{ color: MUTED }}>{String(req.reason)}</p>
                {req.coordinator_response != null && String(req.coordinator_response) !== "" && (
                  <p className="mt-2 rounded-lg bg-cc-bg p-2 text-xs font-medium" style={{ color: TEXT }}>
                    {String(req.coordinator_response)}
                  </p>
                )}
              </div>
            );
          })}
          {!requestsQuery.data?.requests?.length && (
            <p className="py-8 text-center text-sm font-medium" style={{ color: MUTED }}>
              {translate("training.noRequests")}
            </p>
          )}
        </div>
      )}

      {requestOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
            <h3 className="text-lg font-black" style={{ color: TEXT }}>{translate("training.request")}</h3>
            <label className="mt-4 block">
              <span className="text-xs font-black uppercase" style={{ color: MUTED }}>{translate("training.modalTitle")}</span>
              <textarea
                value={requestText}
                onChange={(e) => setRequestText(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: BORDER }}
              />
            </label>
            <label className="mt-3 block">
              <span className="text-xs font-black uppercase" style={{ color: MUTED }}>{translate("training.modalReason")}</span>
              <textarea
                value={requestReason}
                onChange={(e) => setRequestReason(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: BORDER }}
              />
            </label>
            <label className="mt-3 flex items-center gap-2 text-sm font-bold" style={{ color: TEXT }}>
              <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
              {translate("training.markUrgent")}
            </label>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setRequestOpen(false)}
                className="flex-1 rounded-full py-2.5 text-sm font-black"
                style={{ background: "var(--cc-active)", color: MUTED }}
              >
                {translate("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => requestMut.mutate()}
                disabled={requestMut.isPending || !requestText.trim() || !requestReason.trim()}
                className="flex-1 rounded-full py-2.5 text-sm font-black text-white"
                style={{ background: PLUM }}
              >
                {translate("training.sendRequest")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function TrainingModuleDetail({
  module,
  recommendation,
  historyRecord,
  onBack,
  onComplete,
  completing,
  translate,
  translateParams,
}: {
  module: TrainingModule | null;
  recommendation: TrainingRecommendation | null;
  historyRecord: Record<string, unknown> | null;
  onBack: () => void;
  onComplete: () => void;
  completing: boolean;
  translate: (key: string) => string;
  translateParams: (key: string, params: Record<string, string>) => string;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!module) return;
    void startTrainingModule(module.id).catch(() => {
      // Non-critical — the start timestamp is a best-effort audit log.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module?.id]);

  if (!module) {
    return (
      <div className="rounded-2xl border bg-card p-8 text-center" style={{ borderColor: BORDER }}>
        <p className="text-sm font-medium" style={{ color: MUTED }}>{translate("training.noModules")}</p>
        <button type="button" onClick={onBack} className="mt-4 inline-flex items-center gap-1.5 text-sm font-black" style={{ color: PLUM }}>
          <ArrowLeft size={14} /> {translate("common.back")}
        </button>
      </div>
    );
  }

  const status = String(historyRecord?.status ?? "not_started");
  const overdue = !!recommendation?.due_at && new Date(recommendation.due_at).getTime() < Date.now();
  const canSubmit = status === "not_started" || status === "rejected";

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-black" style={{ color: PLUM }}>
        <ArrowLeft size={14} /> {translate("training.backToModules")}
      </button>

      <section className="rounded-2xl border bg-card p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="flex items-start gap-3">
          <div
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
            style={{ background: overdue ? "var(--cc-status-danger-bg)" : "var(--cc-soft)" }}
          >
            {overdue ? <Hourglass size={17} style={{ color: "var(--cc-status-danger)" }} /> : <GraduationCap size={17} style={{ color: PLUM }} />}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-black" style={{ color: TEXT }}>{module.title}</h2>
            {module.description && (
              <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>{module.description}</p>
            )}
          </div>
        </div>

        {recommendation?.due_at && (
          <div
            className="mt-4 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-xs font-bold"
            style={{ background: overdue ? "var(--cc-status-danger-bg)" : "var(--cc-status-warning-bg)", color: overdue ? "var(--cc-status-danger)" : "var(--cc-status-warning)" }}
          >
            {overdue ? <ShieldAlert size={14} /> : <Clock size={14} />}
            {overdue
              ? translateParams("training.overdueBanner", { date: format(parseISO(recommendation.due_at), "d MMM yyyy") })
              : translateParams("training.dueBanner", { date: format(parseISO(recommendation.due_at), "d MMM yyyy") })}
          </div>
        )}

        {!!module.resources?.length && (
          <ul className="mt-4 space-y-2">
            {module.resources.map((res) => (
              <li key={res.id}>
                <a
                  href={res.external_url || "#"}
                  target={res.resource_type === "external_link" ? "_blank" : undefined}
                  rel="noreferrer"
                  className="flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition hover:bg-cc-bg"
                  style={{ color: PLUM, background: "var(--cc-bg)" }}
                >
                  {res.resource_type === "video" && <BookOpen size={16} />}
                  {res.resource_type === "pdf" && <FileText size={16} />}
                  {res.resource_type === "external_link" && <Send size={16} />}
                  {res.title}
                </a>
              </li>
            ))}
          </ul>
        )}

        {module.requires_certification ? (
          <p className="mt-5 text-xs font-medium" style={{ color: MUTED }}>{translate("training.requiresCertificationNote")}</p>
        ) : status === "confirmed" ? (
          <div className="mt-5 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-bold" style={{ background: "#ECFDF5", color: "#059669" }}>
            <CheckCircle2 size={16} /> {translate("training.completedConfirmed")}
          </div>
        ) : status === "awaiting_confirmation" ? (
          <div className="mt-5 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-bold" style={{ background: "#FFFBEB", color: "#D97706" }}>
            <Clock size={16} /> {translate("training.awaitingConfirmationNote")}
          </div>
        ) : (
          <div className="mt-5 border-t pt-4" style={{ borderColor: BORDER }}>
            {status === "rejected" && (
              <p className="mb-3 text-xs font-bold" style={{ color: CORAL }}>
                {translate("training.rejectedNote")}
                {historyRecord?.rejection_reason ? ` ${String(historyRecord.rejection_reason)}` : ""}
              </p>
            )}
            <label className="flex items-start gap-2.5 text-sm font-bold" style={{ color: TEXT }}>
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5"
              />
              {translate("training.acknowledgment")}
            </label>
            <button
              type="button"
              onClick={onComplete}
              disabled={!acknowledged || completing || !canSubmit}
              className="mt-4 w-full rounded-full py-2.5 text-sm font-black text-white disabled:opacity-50"
              style={{ background: PLUM }}
            >
              {completing ? translate("common.saving") : translate("training.markComplete")}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
