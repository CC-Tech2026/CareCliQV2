import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  AlertCircle,
  ArrowLeft,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileText,
  GraduationCap,
  Hourglass,
  Plus,
  Send,
  ShieldAlert,
  Search,
  PlayCircle,
  ExternalLink,
  LockKeyhole,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { WorkerResourceLibrary } from "@/components/training/WorkerResourceLibrary";
import { CourseCover } from "@/components/training/CourseCover";
import { latestTrainingHistory, safeMaterialUrl } from "@/lib/training";
import { useAuth } from "@/contexts/AuthContext";
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

function rowStatusMeta(row: ModuleRow): {
  label: string;
  bg: string;
  color: string;
} {
  if (row.overdue)
    return {
      label: "training.status.overdueLabel",
      bg: "var(--cc-status-danger-bg)",
      color: "var(--cc-status-danger)",
    };
  if (row.status === "confirmed")
    return {
      label: "training.status.current",
      bg: "#ECFDF5",
      color: "#059669",
    };
  if (row.status === "awaiting_confirmation")
    return {
      label: "training.status.pendingReview",
      bg: "#FFFBEB",
      color: "#D97706",
    };
  if (row.status === "rejected")
    return {
      label: "training.status.rejected",
      bg: "#FEF2F2",
      color: "#DC2626",
    };
  if (row.recommendation)
    return {
      label: "training.status.assigned",
      bg: "var(--cc-status-warning-bg)",
      color: "var(--cc-status-warning)",
    };
  return {
    label: "training.status.available",
    bg: "var(--cc-soft)",
    color: MUTED,
  };
}

export default function WorkerTrainingPage() {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const { user } = useAuth();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"modules" | "resources" | "requests">(
    "modules",
  );
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [openModuleId, setOpenModuleId] = useState<string | null>(null);

  const modulesQuery = useOrgQuery(["worker", "training-modules"], {
    queryFn: getTrainingModules,
    refetchInterval: 15000,
  });
  const requestsQuery = useOrgQuery(["worker", "training-requests"], {
    queryFn: getTrainingRequests,
  });
  const historyQuery = useOrgQuery(["worker", "training-history"], {
    queryFn: getTrainingHistory,
  });
  const recommendationsQuery = useOrgQuery(
    ["worker", "training-recommendations"],
    { queryFn: getTrainingRecommendations },
  );

  const historyByModule = useMemo(
    () => latestTrainingHistory(historyQuery.data?.history ?? []),
    [historyQuery.data],
  );
  const recommendationByModule = useMemo(
    () =>
      new Map(
        [...(recommendationsQuery.data?.recommendations ?? [])]
          .reverse()
          .map((r) => [r.training_module_id, r]),
      ),
    [recommendationsQuery.data],
  );

  const rows: ModuleRow[] = useMemo(
    () =>
      (modulesQuery.data?.modules ?? [])
        .map((module) => {
          const recommendation = recommendationByModule.get(module.id) ?? null;
          const status = String(
            historyByModule.get(module.id)?.status ??
              (recommendation?.started_at ? "in_progress" : "not_started"),
          );
          const overdue =
            !!recommendation?.due_at &&
            new Date(recommendation.due_at).getTime() < Date.now() &&
            !module.is_locked &&
            status !== "confirmed" &&
            status !== "awaiting_confirmation";
          return { module, recommendation, status, overdue };
        })
        .sort((a, b) => {
          const rank = (r: ModuleRow) =>
            r.overdue
              ? 0
              : r.recommendation && r.status === "not_started"
                ? 1
                : r.status === "confirmed"
                  ? 3
                  : 2;
          return rank(a) - rank(b);
        }),
    [modulesQuery.data, recommendationByModule, historyByModule],
  );

  const filteredRows = rows.filter(
    (row) =>
      (row.module.title + " " + (row.module.description ?? ""))
        .toLowerCase()
        .includes(search.toLowerCase()) &&
      (statusFilter === "all" ||
        (statusFilter === "locked"
          ? row.module.is_locked
          : !row.module.is_locked && row.status === statusFilter)),
  );
  const continuing = rows.filter(
    (row) => row.status === "in_progress" && !row.module.is_locked,
  );
  const hasError =
    modulesQuery.isError ||
    recommendationsQuery.isError ||
    historyQuery.isError;
  const assignedCount = rows.filter(
    (r) => r.recommendation && r.status !== "confirmed",
  ).length;
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
      void queryClient.invalidateQueries({
        queryKey: [user?.organizationId, "worker", "training-history"],
      });
      void queryClient.invalidateQueries({
        queryKey: [user?.organizationId, "worker", "training-recommendations"],
      });
    },
    onError: (e: Error) =>
      toast({
        title: translate("training.toast.failed"),
        description: e.message,
        variant: "destructive",
      }),
  });

  const requestMut = useMutation({
    mutationFn: () =>
      createTrainingRequest({
        request_text: requestText,
        reason: requestReason,
        urgent,
      }),
    onSuccess: () => {
      toast({
        title: translate("training.toast.requestSentTitle"),
        description: translate("training.toast.requestSentDesc"),
      });
      setRequestOpen(false);
      setRequestText("");
      setRequestReason("");
      setUrgent(false);
      void queryClient.invalidateQueries({
        queryKey: [user?.organizationId, "worker", "training-requests"],
      });
    },
    onError: (e: Error) =>
      toast({
        title: translate("training.toast.failed"),
        description: e.message,
        variant: "destructive",
      }),
  });

  const isLoading =
    modulesQuery.isLoading ||
    recommendationsQuery.isLoading ||
    historyQuery.isLoading;

  const tabs = [
    {
      id: "modules" as const,
      label: translate("training.tab.training"),
      badge: assignedCount,
    },
    { id: "resources" as const, label: "Resource library" },
    { id: "requests" as const, label: translate("training.tab.requests") },
  ];

  if (openModuleId)
    return (
      <div className="w-full pb-10">
        <TrainingModuleDetail
          key={openModuleId}
          module={
            (modulesQuery.data?.modules ?? []).find(
              (m) => m.id === openModuleId,
            ) ?? null
          }
          recommendation={recommendationByModule.get(openModuleId) ?? null}
          historyRecord={historyByModule.get(openModuleId) ?? null}
          onBack={() => setOpenModuleId(null)}
          onComplete={() => completeMut.mutate(openModuleId)}
          completing={completeMut.isPending}
          translate={translate}
          translateParams={translateParams}
        />
      </div>
    );

  return (
    <div className="w-full space-y-5 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p
            className="text-xs font-black uppercase tracking-[0.2em]"
            style={{ color: CORAL }}
          >
            {translate("performance.eyebrow")}
          </p>
          <h1
            className="mt-1 flex items-center gap-2 text-3xl font-black tracking-tight"
            style={{ color: TEXT }}
          >
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

      {
        <div
          className="grid grid-cols-3 divide-x rounded-2xl border bg-card"
          style={{ borderColor: BORDER }}
        >
          <div className="px-4 py-3.5">
            <p
              className="text-[10px] font-black uppercase tracking-wide"
              style={{ color: MUTED }}
            >
              {translate("training.stat.assigned")}
            </p>
            <p
              className="text-lg font-black tabular-nums mt-0.5"
              style={{ color: TEXT }}
            >
              {assignedCount}
            </p>
          </div>
          <div className="px-4 py-3.5">
            <p
              className="text-[10px] font-black uppercase tracking-wide"
              style={{ color: MUTED }}
            >
              {translate("training.stat.overdue")}
            </p>
            <p
              className="text-lg font-black tabular-nums mt-0.5"
              style={{
                color: overdueCount > 0 ? "var(--cc-status-danger)" : TEXT,
              }}
            >
              {overdueCount}
            </p>
          </div>
          <div className="px-4 py-3.5">
            <p
              className="text-[10px] font-black uppercase tracking-wide"
              style={{ color: MUTED }}
            >
              {translate("training.stat.completed")}
            </p>
            <p
              className="text-lg font-black tabular-nums mt-0.5"
              style={{ color: TEXT }}
            >
              {completedCount}
            </p>
          </div>
        </div>
      }

      {!isLoading && !hasError && rows.length > 0 && (
        <section
          className="rounded-2xl border bg-card p-5"
          style={{ borderColor: BORDER }}
        >
          <div className="mb-3 flex justify-between text-sm">
            <span className="font-bold" style={{ color: TEXT }}>
              Your learning journey
            </span>
            <span style={{ color: MUTED }}>
              {completedCount} of {rows.length} completed
            </span>
          </div>
          <div
            role="progressbar"
            aria-label="Confirmed training completion"
            aria-valuemin={0}
            aria-valuemax={rows.length}
            aria-valuenow={completedCount}
            className="h-2 overflow-hidden rounded-full bg-cc-bg"
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${(completedCount / rows.length) * 100}%`,
                background: PLUM,
              }}
            />
          </div>
        </section>
      )}

      {
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
      }

      {tab === "modules" &&
        (isLoading ? (
          <p
            className="py-8 text-center text-sm font-medium"
            style={{ color: MUTED }}
          >
            {translate("common.loading")}
          </p>
        ) : hasError ? (
          <div
            role="alert"
            className="rounded-2xl border bg-card p-8 text-center"
          >
            <p>Unable to load your training.</p>
            <button
              className="mt-3 font-bold underline"
              onClick={() => {
                void modulesQuery.refetch();
                void historyQuery.refetch();
                void recommendationsQuery.refetch();
              }}
            >
              Try again
            </button>
          </div>
        ) : rows.length === 0 ? (
          <div
            className="rounded-2xl border bg-card p-8 text-center"
            style={{ borderColor: BORDER }}
          >
            <GraduationCap
              size={26}
              className="mx-auto mb-2"
              style={{ color: MUTED }}
            />
            <p className="text-sm font-medium" style={{ color: MUTED }}>
              {translate("training.noModules")}
            </p>
          </div>
        ) : (
          <div className="space-y-7">
            {continuing.length > 0 && (
              <section>
                <h2 className="mb-3 text-lg font-bold" style={{ color: TEXT }}>
                  Continue learning
                </h2>
                <div className="grid gap-3 md:grid-cols-2">
                  {continuing.slice(0, 2).map(({ module }) => (
                    <button
                      key={module.id}
                      onClick={() => setOpenModuleId(module.id)}
                      className="flex items-center gap-4 rounded-2xl border bg-card p-5 text-left transition hover:shadow-md focus-visible:ring-2"
                      style={{ borderColor: BORDER }}
                    >
                      <div className="rounded-xl bg-violet-100 p-3 text-violet-700">
                        <PlayCircle size={28} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className="text-xs font-medium"
                          style={{ color: MUTED }}
                        >
                          In progress
                        </p>
                        <h3 className="mt-1 font-bold" style={{ color: TEXT }}>
                          {module.title}
                        </h3>
                        <p className="mt-2 text-xs" style={{ color: MUTED }}>
                          {module.resources?.length ?? 0} learning materials
                        </p>
                      </div>
                      <ChevronRight size={18} />
                    </button>
                  ))}
                </div>
              </section>
            )}
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold" style={{ color: TEXT }}>
                  All materials{" "}
                  <span
                    className="ml-2 text-sm font-medium"
                    style={{ color: MUTED }}
                  >
                    {rows.length}
                  </span>
                </h2>
                <label
                  className="flex items-center gap-2 rounded-xl border bg-card px-3 py-2"
                  style={{ borderColor: BORDER }}
                >
                  <Search size={16} style={{ color: MUTED }} />
                  <input
                    aria-label="Search training modules"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search your learning"
                    className="w-48 bg-transparent text-sm outline-none"
                  />
                </label>
              </div>
              <div className="flex flex-wrap gap-2" aria-label="Filter modules">
                {[
                  ["all", "All status"],
                  ["not_started", "Not started"],
                  ["in_progress", "In progress"],
                  ["awaiting_confirmation", "Pending review"],
                  ["confirmed", "Completed"],
                  ["rejected", "Needs revision"],
                  ["locked", "Under maintenance"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    aria-pressed={statusFilter === value}
                    onClick={() => setStatusFilter(value)}
                    className="rounded-full px-4 py-2 text-xs font-semibold transition"
                    style={{
                      background:
                        statusFilter === value ? PLUM : "var(--cc-soft)",
                      color: statusFilter === value ? "white" : MUTED,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {filteredRows.map((row) => {
                  const meta = rowStatusMeta(row);
                  return (
                    <button
                      key={row.module.id}
                      onClick={() => setOpenModuleId(row.module.id)}
                      className="group flex flex-col rounded-2xl border bg-card p-2 text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:ring-2"
                      style={{ borderColor: BORDER }}
                    >
                      <CourseCover
                        title={row.module.title}
                        count={row.module.resources?.length}
                        color={row.module.cover_color}
                        imageUrl={row.module.cover_url}
                      />
                      <div className="flex flex-1 flex-col p-3">
                        <p
                          className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold"
                          style={{ color: PLUM }}
                        >
                          <BookOpen size={13} />{" "}
                          {row.module.requires_certification
                            ? "Certification course"
                            : "Learning module"}
                        </p>
                        <h3
                          className="text-sm font-bold leading-relaxed"
                          style={{ color: TEXT }}
                        >
                          {row.module.title}
                        </h3>
                        <p
                          className="mt-2 line-clamp-2 text-xs leading-relaxed"
                          style={{ color: MUTED }}
                        >
                          {row.module.description ||
                            "Explore the materials and build your skills."}
                        </p>
                        <div className="mt-4 flex flex-wrap gap-2">
                          <span
                            className="rounded-md px-2 py-1 text-[10px] font-semibold"
                            style={{ background: meta.bg, color: meta.color }}
                          >
                            {row.module.is_locked
                              ? "Under maintenance"
                              : row.status === "in_progress" && !row.overdue
                                ? "In progress"
                                : translate(meta.label)}
                          </span>
                          {row.recommendation && (
                            <span className="rounded-md bg-cc-bg px-2 py-1 text-[10px] font-semibold">
                              Assigned
                            </span>
                          )}
                        </div>
                        <div className="mt-auto flex items-center justify-between gap-2 pt-4 text-xs">
                          <span
                            style={{
                              color: row.overdue
                                ? "var(--cc-status-danger)"
                                : MUTED,
                            }}
                          >
                            {row.recommendation?.due_at
                              ? "Due " +
                                format(
                                  parseISO(row.recommendation.due_at),
                                  "d MMM yyyy",
                                )
                              : "Self-paced learning"}
                          </span>
                          <span
                            className="rounded-lg border px-3 py-1.5 font-bold"
                            style={{ borderColor: BORDER, color: TEXT }}
                          >
                            {row.module.is_locked
                              ? "View notice"
                              : row.status === "in_progress"
                                ? "Continue"
                                : row.status === "not_started"
                                  ? "Start"
                                  : "View"}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
              {filteredRows.length === 0 && (
                <p
                  className="rounded-xl border border-dashed p-8 text-center text-sm"
                  style={{ color: MUTED }}
                >
                  No modules match your search or status filter.
                </p>
              )}
            </section>
          </div>
        ))}

      {tab === "resources" && (
        <WorkerResourceLibrary modules={modulesQuery.data?.modules ?? []} />
      )}

      {tab === "requests" && (
        <div className="space-y-3">
          {(requestsQuery.data?.requests ?? []).map(
            (req: Record<string, unknown>) => {
              const status = String(req.status ?? "pending");
              const isPending = status === "pending";
              const statusKey = REQUEST_STATUS_KEYS[status];
              return (
                <div
                  key={String(req.id)}
                  className="rounded-2xl border bg-card p-4"
                  style={{ borderColor: BORDER }}
                >
                  <div className="flex items-center gap-2">
                    {isPending ? (
                      <Clock size={16} style={{ color: "#D97706" }} />
                    ) : status === "approved" ? (
                      <CheckCircle2 size={16} className="text-emerald-600" />
                    ) : (
                      <AlertCircle size={16} className="text-red-600" />
                    )}
                    <span
                      className="text-xs font-black uppercase"
                      style={{ color: MUTED }}
                    >
                      {statusKey ? translate(statusKey) : status}
                    </span>
                    {Boolean(req.urgent) && (
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-black"
                        style={{
                          background: "var(--cc-status-critical-bg)",
                          color: CORAL,
                        }}
                      >
                        {translate("training.urgent")}
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-sm font-bold" style={{ color: TEXT }}>
                    {String(req.request_text)}
                  </p>
                  <p className="mt-1 text-xs" style={{ color: MUTED }}>
                    {String(req.reason)}
                  </p>
                  {req.coordinator_response != null &&
                    String(req.coordinator_response) !== "" && (
                      <p
                        className="mt-2 rounded-lg bg-cc-bg p-2 text-xs font-medium"
                        style={{ color: TEXT }}
                      >
                        {String(req.coordinator_response)}
                      </p>
                    )}
                </div>
              );
            },
          )}
          {requestsQuery.isLoading && <p role="status">Loading requests...</p>}
          {requestsQuery.isError && (
            <p role="alert">
              Unable to load requests.{" "}
              <button
                className="underline"
                onClick={() => void requestsQuery.refetch()}
              >
                Try again
              </button>
            </p>
          )}
          {!requestsQuery.isLoading &&
            !requestsQuery.isError &&
            !requestsQuery.data?.requests?.length && (
              <p
                className="py-8 text-center text-sm font-medium"
                style={{ color: MUTED }}
              >
                {translate("training.noRequests")}
              </p>
            )}
        </div>
      )}

      {requestOpen && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !requestMut.isPending) setRequestOpen(false);
          }}
        >
          <DialogContent
            hideCloseButton
            aria-describedby={undefined}
            className="max-h-[90dvh] overflow-y-auto p-0"
          >
            <div className="w-full max-w-md rounded-2xl bg-card p-6 shadow-xl">
              <DialogTitle
                className="text-lg font-black"
                style={{ color: TEXT }}
              >
                {translate("training.request")}
              </DialogTitle>
              <label className="mt-4 block">
                <span
                  className="text-xs font-black uppercase"
                  style={{ color: MUTED }}
                >
                  {translate("training.modalTitle")}
                </span>
                <textarea
                  value={requestText}
                  onChange={(e) => setRequestText(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: BORDER }}
                />
              </label>
              <label className="mt-3 block">
                <span
                  className="text-xs font-black uppercase"
                  style={{ color: MUTED }}
                >
                  {translate("training.modalReason")}
                </span>
                <textarea
                  value={requestReason}
                  onChange={(e) => setRequestReason(e.target.value)}
                  rows={2}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: BORDER }}
                />
              </label>
              <label
                className="mt-3 flex items-center gap-2 text-sm font-bold"
                style={{ color: TEXT }}
              >
                <input
                  type="checkbox"
                  checked={urgent}
                  onChange={(e) => setUrgent(e.target.checked)}
                />
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
                  disabled={
                    requestMut.isPending ||
                    !requestText.trim() ||
                    !requestReason.trim()
                  }
                  className="flex-1 rounded-full py-2.5 text-sm font-black text-white"
                  style={{ background: PLUM }}
                >
                  {translate("training.sendRequest")}
                </button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
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
  const queryClient = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    document.getElementById("training-course-title")?.focus();
    setAcknowledged(false);
    if (!module || module.is_locked) return;
    void startTrainingModule(module.id)
      .then(() =>
        queryClient.invalidateQueries({
          queryKey: [
            user?.organizationId,
            "worker",
            "training-recommendations",
          ],
        }),
      )
      .catch(() => {
        // Non-critical — the start timestamp is a best-effort audit log.
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [module?.id, module?.is_locked]);

  if (!module) {
    return (
      <div
        className="rounded-2xl border bg-card p-8 text-center"
        style={{ borderColor: BORDER }}
      >
        <p className="text-sm font-medium" style={{ color: MUTED }}>
          {translate("training.noModules")}
        </p>
        <button
          type="button"
          onClick={onBack}
          className="mt-4 inline-flex items-center gap-1.5 text-sm font-black"
          style={{ color: PLUM }}
        >
          <ArrowLeft size={14} /> {translate("common.back")}
        </button>
      </div>
    );
  }

  const status = String(historyRecord?.status ?? "not_started");
  const overdue =
    !module.is_locked &&
    !!recommendation?.due_at &&
    new Date(recommendation.due_at).getTime() < Date.now() &&
    status !== "confirmed" &&
    status !== "awaiting_confirmation";
  const canSubmit =
    !module.is_locked && (status === "not_started" || status === "rejected");

  const step =
    status === "confirmed" ? 3 : status === "awaiting_confirmation" ? 2 : 1;
  const stageLabel =
    step === 3
      ? "Completion confirmed"
      : step === 2
        ? "Awaiting completion review"
        : "Work through the learning materials";
  return (
    <div>
      <section className="mb-6 rounded-2xl border bg-card p-5 sm:p-7">
        <button
          type="button"
          disabled={completing}
          onClick={onBack}
          className="mb-5 inline-flex h-8 items-center gap-2 text-xs font-semibold text-muted-foreground"
        >
          <ArrowLeft size={14} />
          {translate("training.backToModules")}
        </button>
        {
          <div className="mb-5">
            <CourseCover
              title={module.title}
              count={module.resources?.length}
              imageUrl={module.cover_url}
              color={module.cover_color}
              className="h-44 sm:h-52"
            />
          </div>
        }
        <p className="mb-2 text-[11px] font-bold uppercase tracking-[0.16em] text-[var(--cc-plum)]">
          CareCliQ learning
        </p>
        <h1
          id="training-course-title"
          tabIndex={-1}
          className="outline-none text-2xl font-bold tracking-tight text-foreground sm:text-3xl"
        >
          {module.title}
        </h1>
        {module.description && (
          <p className="mt-3 text-sm leading-relaxed text-slate-600">
            {module.description}
          </p>
        )}
        {!module.is_locked && (
          <>
            <nav
              aria-label="Course sections"
              className="my-5 flex flex-wrap gap-3"
            >
              <a
                href="#training-course-materials"
                className="inline-flex h-9 min-w-24 items-center justify-center rounded-full border border-[var(--cc-plum)] bg-[var(--cc-plum-soft)] px-4 text-xs font-semibold text-[var(--cc-plum)]"
              >
                Materials
              </a>
              <a
                href="#training-course-completion"
                className="inline-flex h-9 min-w-24 items-center justify-center rounded-full border border-border px-4 text-xs font-semibold text-muted-foreground"
              >
                Completion
              </a>
            </nav>
            <div className="flex items-center justify-between gap-3 text-xs font-medium text-slate-700">
              <span>Step {step} of 3</span>
              <span>{stageLabel}</span>
            </div>
            <div
              role="progressbar"
              aria-label="Course completion steps"
              aria-valuemin={0}
              aria-valuemax={3}
              aria-valuenow={step}
              className="mt-2 h-2.5 overflow-hidden rounded-full bg-[var(--cc-soft)]"
            >
              <div
                className="h-full bg-[var(--cc-plum)] transition-all"
                style={{ width: (step / 3) * 100 + "%" }}
              />
            </div>
          </>
        )}
      </section>
      <section className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {!module.is_locked && recommendation?.due_at && (
          <div
            className="flex items-center gap-2 rounded-xl xl:col-span-2 px-3.5 py-2.5 text-xs font-bold"
            style={{
              background: overdue
                ? "var(--cc-status-danger-bg)"
                : "var(--cc-status-warning-bg)",
              color: overdue
                ? "var(--cc-status-danger)"
                : "var(--cc-status-warning)",
            }}
          >
            {overdue ? <ShieldAlert size={14} /> : <Clock size={14} />}
            {overdue
              ? translateParams("training.overdueBanner", {
                  date: format(parseISO(recommendation.due_at), "d MMM yyyy"),
                })
              : translateParams("training.dueBanner", {
                  date: format(parseISO(recommendation.due_at), "d MMM yyyy"),
                })}
          </div>
        )}

        {module.is_locked ? (
          <div
            role="status"
            className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-5 text-amber-950"
          >
            <div className="flex items-center gap-2 font-bold">
              <LockKeyhole size={19} />
              This module is being updated
            </div>
            <p className="mt-2 text-sm leading-relaxed">
              {module.lock_reason ||
                "Your managing director is updating the content. Materials and completion will be available when the module is unlocked."}
            </p>
            <p className="mt-3 text-xs">
              Your previous completion is kept. You can still use the shared
              resource library.
            </p>
          </div>
        ) : (
          <div
            id="training-course-materials"
            className="scroll-mt-5 rounded-2xl border bg-card p-5 sm:p-6"
          >
            <div className="mb-4 flex items-center justify-between">
              <h3 className="font-bold" style={{ color: TEXT }}>
                Learning materials
              </h3>
              <span className="text-xs" style={{ color: MUTED }}>
                {module.resources?.length ?? 0} materials
              </span>
            </div>
            <p
              className="mb-4 text-xs leading-relaxed"
              style={{ color: MUTED }}
            >
              Work through each resource, then submit your completion for
              review.
            </p>
            <ul className="space-y-4">
              {(module.resources ?? []).map((res, index) => {
                const url = safeMaterialUrl(res.access_url || res.external_url);
                const Icon =
                  res.resource_type === "video"
                    ? PlayCircle
                    : res.resource_type === "pdf"
                      ? FileText
                      : BookOpen;
                return (
                  <li
                    key={res.id}
                    className="grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-3 gap-y-3 rounded-xl border border-border bg-card p-4 shadow-sm sm:grid-cols-[44px_minmax(0,1fr)_96px]"
                    style={{ borderColor: BORDER }}
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-400 text-slate-800">
                      <Icon size={23} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-bold leading-5 text-foreground">
                        {res.title}
                      </h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {res.resource_type === "pdf"
                          ? "Reading"
                          : res.resource_type === "video"
                            ? "Video"
                            : "Online resource"}{" "}
                        / Material {index + 1}
                      </p>
                    </div>
                    {url ? (
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="col-start-2 inline-flex h-9 w-24 items-center justify-center gap-2 rounded-md bg-[var(--cc-plum)] px-3 text-xs font-bold text-white hover:opacity-90 sm:col-start-auto"
                        aria-label={"Open " + res.title + " in a new tab"}
                      >
                        {res.resource_type === "video"
                          ? "Watch"
                          : res.resource_type === "pdf"
                            ? "Read"
                            : "Open"}{" "}
                        <ExternalLink size={13} />
                      </a>
                    ) : (
                      <span className="text-xs" style={{ color: MUTED }}>
                        Link unavailable. Contact your coordinator.
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {!module.resources?.length && (
              <p
                className="rounded-xl bg-cc-bg p-5 text-sm"
                style={{ color: MUTED }}
              >
                No materials have been added yet. Your coordinator can provide
                the course resources.
              </p>
            )}
          </div>
        )}

        <div
          id="training-course-completion"
          hidden={module.is_locked}
          className="scroll-mt-5 rounded-2xl border bg-card p-5 xl:sticky xl:top-6"
        >
          <h2 className="text-base font-bold text-foreground">
            Course completion
          </h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Review the materials, acknowledge your learning, then submit for
            confirmation.
          </p>
          {!module.is_locked &&
            (module.requires_certification &&
            status !== "confirmed" &&
            status !== "awaiting_confirmation" ? (
              <p className="mt-5 text-xs font-medium" style={{ color: MUTED }}>
                {translate("training.requiresCertificationNote")}
              </p>
            ) : status === "confirmed" ? (
              <div
                className="mt-5 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-bold"
                style={{ background: "#ECFDF5", color: "#059669" }}
              >
                <CheckCircle2 size={16} />{" "}
                {translate("training.completedConfirmed")}
              </div>
            ) : status === "awaiting_confirmation" ? (
              <div
                className="mt-5 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-bold"
                style={{ background: "#FFFBEB", color: "#D97706" }}
              >
                <Clock size={16} />{" "}
                {translate("training.awaitingConfirmationNote")}
              </div>
            ) : (
              <div
                className="mt-5 border-t pt-4"
                style={{ borderColor: BORDER }}
              >
                {status === "rejected" && (
                  <p
                    className="mb-3 text-xs font-bold"
                    style={{ color: CORAL }}
                  >
                    {translate("training.rejectedNote")}
                    {historyRecord?.rejection_reason
                      ? ` ${String(historyRecord.rejection_reason)}`
                      : ""}
                  </p>
                )}
                <label
                  className="flex items-start gap-2.5 text-sm font-bold"
                  style={{ color: TEXT }}
                >
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
                  className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-lg bg-[var(--cc-plum)] px-4 text-sm font-bold text-white hover:opacity-90 disabled:opacity-50"
                >
                  {completing
                    ? translate("common.saving")
                    : translate("training.markComplete")}
                </button>
              </div>
            ))}
        </div>
      </section>
    </div>
  );
}
