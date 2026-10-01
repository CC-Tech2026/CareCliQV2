import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Languages,
  Loader2,
  MapPin,
} from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import {
  confirmShiftVerification,
  getShiftPriceItemOptions,
  getShiftVerificationQueue,
  sendShiftMessage,
  type ShiftVerificationQueueItem,
} from "@/services/coordinatorService";
import {
  ScheduleStatusPill,
  WorkerAvatar,
} from "@/components/coordinator/ScheduleLiveCard";
import { appLocalDateKey, formatAppDate, formatAppTime } from "@/lib/datetime";

type Approved = { item: ShiftVerificationQueueItem; billed: number };

const money = (value: number) =>
  new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" }).format(value);

export function formatDuration(minutes?: number | null) {
  if (minutes == null || !Number.isFinite(minutes)) return null;
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function actualMinutes(item: ShiftVerificationQueueItem) {
  if (item.clocked_in_at && item.clocked_out_at) {
    return (Date.parse(item.clocked_out_at) - Date.parse(item.clocked_in_at)) / 60000;
  }
  return item.checks?.hours_sanity?.actual_minutes ?? item.duration_minutes ?? null;
}

function taskLabel(task: NonNullable<ShiftVerificationQueueItem["tasks"]>[number]) {
  return task.label || task.name || task.title || "";
}

function timeRange(start?: string | null, end?: string | null, tz?: string | null) {
  if (!start) return null;
  return `${formatAppTime(start, tz)}${end ? ` – ${formatAppTime(end, tz)}` : ""}`;
}

function humanise(value?: string | null) {
  if (!value) return null;
  return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

export default function CoordinatorVerificationPage() {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const initial = new URLSearchParams(useSearch()).get("shiftId");
  const [selectedId, setSelectedId] = useState<string | null>(initial);
  const [statusFilter, setStatusFilter] = useState<"review" | "all">("review");
  const [workerFilter, setWorkerFilter] = useState("all");
  const [approved, setApproved] = useState<Record<string, Approved>>({});
  const query = useOrgQuery(["shift-verification-queue"], {
    queryFn: getShiftVerificationQueue,
  });
  const queue = query.data ?? [];

  // Shifts approved here drop out of the server queue; keep them listed for
  // this visit so the coordinator can see what they just did.
  const items = useMemo(() => {
    const ids = new Set(queue.map((item) => item.shift_id));
    return [
      ...queue,
      ...Object.values(approved)
        .filter((a) => !ids.has(a.item.shift_id))
        .map((a) => a.item),
    ];
  }, [queue, approved]);
  const workers = useMemo(
    () =>
      [...new Map(items.filter((i) => i.worker_id).map((i) => [i.worker_id!, i.worker_name || ""])).entries()]
        .sort((a, b) => a[1].localeCompare(b[1])),
    [items],
  );
  const filtered = items.filter(
    (item) =>
      (statusFilter === "all" || !approved[item.shift_id]) &&
      (workerFilter === "all" || item.worker_id === workerFilter),
  );
  const selected =
    items.find((item) => item.shift_id === selectedId) ??
    (!selectedId ? filtered[0] : undefined);
  const todayKey = appLocalDateKey(new Date().toISOString());

  return (
    <div className="space-y-5 pb-8">
      <nav className="text-sm text-cc-muted">
        <Link href="/coordinator/rostering" className="hover:text-cc-plum">
          {translate("nav.schedule")}
        </Link>
        <span aria-hidden> / </span>
        {translate("schedule.verification")}
      </nav>
      <header>
        <h1 className="text-2xl font-bold text-cc-text">{translate("schedule.verification")}</h1>
        <p className="mt-1 text-sm text-cc-muted">{translate("schedule.verifyDescription")}</p>
      </header>
      {query.isLoading ? (
        <p role="status" className="text-sm text-cc-muted">{translate("common.loading")}</p>
      ) : query.isError ? (
        <div role="alert" className="rounded-xl border border-red-200 bg-cc-surface p-4 text-sm">
          <p>{translate("schedule.loadFailed")}</p>
          <button className="mt-2 min-h-11 font-semibold text-cc-plum" onClick={() => query.refetch()}>
            {translate("coordinator.live.refresh")}
          </button>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(260px,340px)_minmax(0,1fr)]">
          <aside className="self-start overflow-hidden rounded-2xl border border-cc-border bg-cc-surface lg:sticky lg:top-4">
            <div className="grid grid-cols-2 gap-2 border-b border-cc-border p-3">
              <label className="text-[11px] font-semibold text-cc-muted">
                <span className="sr-only">{translate("schedule.filterStatus")}</span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "review" | "all")}
                  className="min-h-10 w-full rounded-lg border border-cc-border bg-cc-surface px-2 text-sm font-semibold text-cc-text"
                >
                  <option value="review">{translate("schedule.status.review")}</option>
                  <option value="all">{translate("schedule.allShifts")}</option>
                </select>
              </label>
              <label className="text-[11px] font-semibold text-cc-muted">
                <span className="sr-only">{translate("schedule.filterWorker")}</span>
                <select
                  value={workerFilter}
                  onChange={(e) => setWorkerFilter(e.target.value)}
                  className="min-h-10 w-full rounded-lg border border-cc-border bg-cc-surface px-2 text-sm font-semibold text-cc-text"
                >
                  <option value="all">{translate("schedule.allWorkersFilter")}</option>
                  {workers.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </label>
            </div>
            <ul className="max-h-[40vh] divide-y divide-cc-border overflow-y-auto lg:max-h-[68vh]">
              {filtered.map((item) => {
                const active = selected?.shift_id === item.shift_id;
                const start = item.clocked_in_at ?? item.scheduled_start;
                const end = item.clocked_out_at ?? item.scheduled_end;
                const day = start
                  ? appLocalDateKey(start, item.timezone) === todayKey
                    ? translate("schedule.today")
                    : formatAppDate(start, item.timezone, { weekday: "short", day: "numeric", month: "short" })
                  : null;
                return (
                  <li key={item.shift_id}>
                    <button
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSelectedId(item.shift_id)}
                      className={
                        "flex w-full items-start gap-3 border-l-[3px] px-3 py-3 text-left transition-colors " +
                        (active ? "border-l-cc-plum bg-cc-soft" : "border-l-transparent hover:bg-cc-soft/60")
                      }
                    >
                      <WorkerAvatar name={item.worker_name} stage="completed" size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-cc-text">
                          {item.worker_name} · {item.participant_name}
                        </span>
                        <span className="mt-0.5 block text-xs text-cc-muted">
                          {[day, timeRange(start, end, item.timezone)].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <ScheduleStatusPill stage={approved[item.shift_id] ? "approved" : "review"} />
                    </button>
                  </li>
                );
              })}
              {!filtered.length && (
                <li className="p-4 text-sm text-cc-muted">{translate("schedule.nothingToReview")}</li>
              )}
            </ul>
          </aside>
          <section aria-live="polite" className="min-w-0">
            {selected ? (
              <ShiftReview
                key={selected.shift_id}
                item={selected}
                approved={approved[selected.shift_id]}
                onApproved={(billed) => {
                  setApproved((prev) => ({ ...prev, [selected.shift_id]: { item: selected, billed } }));
                  void qc.invalidateQueries({ queryKey: [orgId, "shift-verification-queue"] });
                  void qc.invalidateQueries({ queryKey: [orgId, "live-shifts", orgId] });
                  toast({
                    title: translate("schedule.approvedToast"),
                    description: translateParams("schedule.approvedToastDetail", {
                      amount: money(billed),
                      participant: selected.participant_name || "",
                    }),
                  });
                }}
              />
            ) : (
              <p className="rounded-2xl border border-cc-border bg-cc-surface p-6 text-sm text-cc-muted">
                {translate(selectedId ? "schedule.notInQueue" : "schedule.nothingToReview")}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function ShiftReview({
  item,
  approved,
  onApproved,
}: {
  item: ShiftVerificationQueueItem;
  approved?: Approved;
  onApproved: (billed: number) => void;
}) {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const tz = item.timezone;
  const [priceItemCode, setPriceItemCode] = useState("");
  const [priceTouched, setPriceTouched] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [changesText, setChangesText] = useState("");

  const priceItems = useOrgQuery(["shift-price-items", item.shift_id], {
    queryFn: () => getShiftPriceItemOptions(item.shift_id),
    enabled: !approved,
    staleTime: 60_000,
  });
  const options = priceItems.data ?? [];
  useEffect(() => {
    if (priceTouched || priceItemCode) return;
    const expected = item.expected_price_item_code;
    if (expected && options.some((o) => o.item_code === expected)) setPriceItemCode(expected);
    else if (options.length === 1) setPriceItemCode(options[0].item_code);
  }, [options, item.expected_price_item_code, priceTouched, priceItemCode]);

  const approve = useMutation({
    mutationFn: () => confirmShiftVerification(item.shift_id, priceItemCode),
    onSuccess: (result) => {
      onApproved(result.billed_amount);
      const warning = result.expected_item_warning || result.day_type_warning;
      if (warning) toast({ title: translate("schedule.checkFirst"), description: warning });
    },
    onError: (err: unknown) =>
      toast({
        title: translate("schedule.approveFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
  });
  const requestChanges = useMutation({
    mutationFn: () =>
      sendShiftMessage(item.shift_id, item.worker_id!, changesText.trim(), "action_required"),
    onSuccess: () => {
      setChangesOpen(false);
      setChangesText("");
      toast({
        title: translate("schedule.changesRequested"),
        description: translateParams("schedule.changesRequestedDetail", {
          worker: item.worker_name || translate("common.worker"),
        }),
      });
    },
    onError: (err: unknown) =>
      toast({
        title: translate("schedule.messageFailed"),
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      }),
  });

  const tasks = (item.tasks ?? []).filter((t) => taskLabel(t));
  const doneCount = tasks.filter((t) => t.completed).length;
  const gps = !!item.clock_in_location_verified;
  const day = item.scheduled_start
    ? formatAppDate(item.scheduled_start, tz, { weekday: "short", day: "numeric", month: "short" })
    : null;
  const translated =
    !!item.original_language_input &&
    !!item.detected_language &&
    !["en", "english"].includes(item.detected_language.toLowerCase());
  const score = item.compliance_score;
  const { evidence, hours_sanity, force_ended } = item.checks ?? ({} as ShiftVerificationQueueItem["checks"]);
  const warnings = [
    evidence?.mandatory_without_evidence
      ? translateParams("schedule.mandatoryNoEvidence", { count: String(evidence.mandatory_without_evidence) })
      : null,
    evidence?.flagged
      ? `${translate("schedule.lowCompliance")}${evidence.compliance_score != null ? ` (${Math.round(evidence.compliance_score)}%)` : ""}`
      : null,
    hours_sanity?.flagged ? hours_sanity.reason || null : null,
    force_ended?.force_ended ? force_ended.reason || translate("schedule.systemEnded") : null,
  ].filter((w): w is string => !!w);

  const strip: Array<{ label: string; value: string; tone?: string; icon?: boolean }> = [
    {
      label: translate("schedule.status.scheduled"),
      value: timeRange(item.scheduled_start, item.scheduled_end, tz) ?? translate("schedule.notRecorded"),
    },
    {
      label: translate("schedule.actual"),
      value: timeRange(item.clocked_in_at, item.clocked_out_at, tz) ?? translate("schedule.notRecorded"),
    },
    {
      label: translate("schedule.duration"),
      value: formatDuration(actualMinutes(item)) ?? translate("schedule.notRecorded"),
    },
    {
      label: translate("schedule.clockInCheck"),
      value: translate(gps ? "schedule.gpsVerified" : "schedule.notVerified"),
      tone: gps ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300",
      icon: gps,
    },
  ];

  return (
    <article className="overflow-hidden rounded-2xl border border-cc-border bg-cc-surface shadow-sm">
      <header className="flex flex-wrap items-start gap-3 p-5">
        <WorkerAvatar name={item.worker_name} stage="completed" />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-cc-text">{item.worker_name}</h2>
          <p className="mt-0.5 text-sm text-cc-muted">
            {[
              translateParams("schedule.withParticipant", { participant: item.participant_name || "" }),
              day,
              humanise(item.shift_type),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <ScheduleStatusPill stage={approved ? "approved" : "review"} />
      </header>

      <dl className="grid grid-cols-2 gap-px border-y border-cc-border bg-cc-border sm:grid-cols-4">
        {strip.map(({ label, value, tone, icon }) => (
          <div key={label} className="bg-cc-panel px-4 py-3">
            <dt className="text-[11px] text-cc-muted">{label}</dt>
            <dd className={`mt-0.5 flex items-center gap-1 text-sm font-semibold tabular-nums ${tone ?? "text-cc-text"}`}>
              {icon && <MapPin size={13} aria-hidden />}
              {value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="space-y-6 p-5">
        {warnings.length > 0 && !approved && (
          <div role="note" className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
            <p className="flex items-center gap-1.5 font-semibold">
              <AlertTriangle size={14} aria-hidden /> {translate("schedule.checkFirst")}
            </p>
            <ul className="mt-1 list-disc ps-6">
              {warnings.map((w) => <li key={w}>{w}</li>)}
            </ul>
          </div>
        )}

        <section>
          <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-cc-muted">
            {tasks.length
              ? translateParams("schedule.tasksDone", { done: String(doneCount), total: String(tasks.length) })
              : translate("schedule.tasks")}
          </h3>
          {tasks.length ? (
            <ul className="mt-2 divide-y divide-cc-border rounded-xl border border-cc-border">
              {tasks.map((task, index) => (
                <li key={task.id ?? index} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  {task.completed ? (
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <Check size={12} strokeWidth={3} aria-hidden />
                    </span>
                  ) : (
                    <Circle size={20} aria-hidden className="shrink-0 text-cc-border" />
                  )}
                  <span className={`min-w-0 flex-1 ${task.completed ? "text-cc-text" : "text-cc-muted"}`}>
                    {taskLabel(task)}
                    <span className="sr-only">
                      {" "}({translate(task.completed ? "schedule.status.completed" : "schedule.notRecorded")})
                    </span>
                  </span>
                  {task.completed_at && (
                    <span className="shrink-0 text-xs tabular-nums text-cc-muted">
                      {formatAppTime(task.completed_at, tz)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-cc-muted">{translate("schedule.noTasks")}</p>
          )}
        </section>

        <section>
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-[11px] font-bold uppercase tracking-[0.14em] text-cc-muted">
              {translate("schedule.note")}
            </h3>
            {translated && (
              <span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800 dark:bg-violet-950 dark:text-violet-200">
                <Languages size={11} aria-hidden />
                {translateParams("schedule.translated", { language: item.detected_language! })}
              </span>
            )}
          </div>
          <div className="mt-2 rounded-xl border border-cc-border p-4">
            <p className="whitespace-pre-wrap break-words text-sm leading-6 text-cc-text">
              {item.session_note || translate("schedule.noteMissing")}
            </p>
            {translated && (
              <p className="mt-3 whitespace-pre-wrap break-words border-t border-cc-border pt-3 text-sm italic text-cc-muted">
                {translate("schedule.original")}: {item.original_language_input}
              </p>
            )}
          </div>
        </section>

        {score != null && (
          <section>
            <div className="flex items-center justify-between text-sm">
              <h3 className="font-semibold text-cc-text">{translate("schedule.quality")}</h3>
              <span className="font-bold tabular-nums text-cc-text">{Math.round(score)}%</span>
            </div>
            <div
              role="progressbar"
              aria-label={translate("schedule.quality")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(score)}
              className="mt-2 h-2 overflow-hidden rounded-full bg-cc-soft"
            >
              <div
                className={`h-full rounded-full ${score >= 80 ? "bg-emerald-500" : score >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
              />
            </div>
          </section>
        )}

        {!approved && (
          <label className="block text-sm font-semibold text-cc-text">
            {translate("schedule.priceItem")}
            <select
              value={priceItemCode}
              onChange={(e) => {
                setPriceTouched(true);
                setPriceItemCode(e.target.value);
              }}
              disabled={priceItems.isLoading || approve.isPending}
              className="mt-1.5 min-h-11 w-full rounded-lg border border-cc-border bg-cc-surface px-3 text-sm font-normal"
            >
              <option value="">
                {translate(priceItems.isLoading ? "schedule.loadingPriceItems" : "schedule.pickPriceItem")}
              </option>
              {options.map((o) => (
                <option key={o.item_code} value={o.item_code}>
                  {o.item_code}: {o.name || o.support_purpose || ""}
                  {o.price_national != null
                    ? ` (${money(o.price_national)}${o.unit === "E" ? "" : "/hr"})`
                    : ""}
                </option>
              ))}
            </select>
          </label>
        )}

        {changesOpen && !approved && (
          <div className="rounded-xl border border-cc-border p-3">
            <label className="block text-sm font-semibold text-cc-text">
              {translate("schedule.requestChangesPrompt")}
              <textarea
                value={changesText}
                onChange={(e) => setChangesText(e.target.value)}
                rows={3}
                className="mt-1.5 w-full rounded-lg border border-cc-border bg-cc-surface p-2 text-sm font-normal"
              />
            </label>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setChangesOpen(false)}
                className="min-h-11 rounded-full px-4 text-sm font-semibold text-cc-muted"
              >
                {translate("common.cancel")}
              </button>
              <button
                type="button"
                disabled={!changesText.trim() || requestChanges.isPending}
                onClick={() => requestChanges.mutate()}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-cc-text px-4 text-sm font-bold text-cc-surface disabled:opacity-50"
              >
                {requestChanges.isPending && <Loader2 size={14} className="animate-spin" aria-hidden />}
                {translate("schedule.requestChangesSend")}
              </button>
            </div>
          </div>
        )}
      </div>

      <footer className="flex flex-wrap justify-end gap-2 border-t border-cc-border bg-cc-panel px-5 py-3">
        {approved ? (
          <span className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-emerald-600 px-5 text-sm font-bold text-white">
            <CheckCircle2 size={16} aria-hidden /> {translate("schedule.status.approved")} · {money(approved.billed)}
          </span>
        ) : (
          <>
            {item.worker_id && (
              <button
                type="button"
                onClick={() => setChangesOpen(true)}
                disabled={changesOpen}
                className="min-h-11 rounded-full border border-cc-border bg-cc-surface px-5 text-sm font-semibold text-cc-text disabled:opacity-50"
              >
                {translate("schedule.requestChanges")}
              </button>
            )}
            <button
              type="button"
              onClick={() => approve.mutate()}
              disabled={!priceItemCode || approve.isPending}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-cc-plum px-5 text-sm font-bold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {approve.isPending ? (
                <Loader2 size={16} className="animate-spin" aria-hidden />
              ) : (
                <Check size={16} aria-hidden />
              )}
              {translate("schedule.approveShift")}
            </button>
          </>
        )}
      </footer>
    </article>
  );
}
