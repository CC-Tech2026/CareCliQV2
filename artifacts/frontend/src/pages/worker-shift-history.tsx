import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Filter,
  MessageSquare,
  Share2,
  X,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { Link } from "wouter";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useMutation } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { SectionInfo } from "@/components/ui/section-info";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import { ShiftShareSheet } from "@/components/shifts/ShiftShareSheet";
import {
  exportShiftPdf,
  downloadShiftExportFile,
  getShiftHistory,
  getShiftHistoryDetail,
  getShiftHistoryTrend,
  type ComplianceBand,
  type ShiftHistoryRow,
} from "@/services/workerPerformanceService";
import { apiFetch } from "@/lib/api-fetch";
import { cn } from "@/lib/utils";
import { BORDER, CORAL, MUTED, PLUM, SOFT, TEXT } from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { CC_STATUS } from "@/lib/brand-tokens";

const BAND_STYLES: Record<ComplianceBand, { bg: string; text: string; labelKey: string }> = {
  green: { bg: CC_STATUS.successBg, text: CC_STATUS.success, labelKey: "shiftHistory.band.excellent" },
  amber: { bg: CC_STATUS.warningBg, text: CC_STATUS.warning, labelKey: "shiftHistory.band.good" },
  red: { bg: CC_STATUS.criticalBg, text: CC_STATUS.critical, labelKey: "shiftHistory.band.needsAttention" },
  unknown: { bg: "var(--cc-bg)", text: MUTED, labelKey: "" },
};

function formatShiftDate(value?: string) {
  if (!value) return "N/A";
  try {
    return format(parseISO(value), "EEE d MMM yyyy");
  } catch {
    return value.slice(0, 10);
  }
}

function isBrowsableImageUrl(url?: string | null): url is string {
  if (!url) return false;
  const value = url.trim().toLowerCase();
  return (
    value.startsWith("http://") ||
    value.startsWith("https://") ||
    value.startsWith("data:") ||
    value.startsWith("blob:")
  );
}

function resolveEvidencePreviewUrl(url: string) {
  if (url.includes("images.unsplash.com") && /[?&]w=\d+/.test(url)) {
    return url.replace(/([?&])w=\d+/, "$1w=1200");
  }
  return url;
}

function EvidenceLightboxImage({
  displayUrl,
  evidenceId,
  label,
}: {
  displayUrl?: string;
  evidenceId?: string | null;
  label: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let objectUrl: string | undefined;
    let cancelled = false;

    async function load() {
      setError(false);
      setSrc(null);

      if (displayUrl && isBrowsableImageUrl(displayUrl)) {
        setSrc(resolveEvidencePreviewUrl(displayUrl));
        return;
      }

      if (evidenceId) {
        try {
          const response = await apiFetch(
            `/api/worker/evidence/${encodeURIComponent(evidenceId)}/download`,
          );
          if (!response.ok) throw new Error("Failed to load evidence");
          const blob = await response.blob();
          objectUrl = URL.createObjectURL(blob);
          if (!cancelled) setSrc(objectUrl);
        } catch {
          if (!cancelled) setError(true);
        }
        return;
      }

      setError(true);
    }

    void load();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [displayUrl, evidenceId]);

  if (error) {
    return (
      <div
        className="flex min-h-[12rem] items-center justify-center rounded-xl p-6 text-sm font-medium"
        style={{ background: 'var(--cc-bg)', color: MUTED }}
      >
        Unable to load image evidence.
      </div>
    );
  }

  if (!src) {
    return (
      <div
        className="flex min-h-[12rem] items-center justify-center rounded-xl p-6 text-sm font-medium"
        style={{ background: 'var(--cc-bg)', color: MUTED }}
      >
        Loading image…
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={label}
      className="mx-auto max-h-[70vh] w-full rounded-lg object-contain"
    />
  );
}

function formatDuration(minutes?: number | null) {
  if (!minutes) return "N/A";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h && m) return `${h}h ${m}m`;
  if (h) return `${h}h`;
  return `${m}m`;
}

function ComplianceBadge({ score, band }: { score?: number | null; band: ComplianceBand }) {
  const { translate } = useAccessibility();
  const style = BAND_STYLES[band] ?? BAND_STYLES.unknown;
  const label = style.labelKey ? translate(style.labelKey) : "N/A";
  const Icon =
    band === "green" ? CheckCircle2 : band === "amber" ? AlertCircle : band === "red" ? AlertCircle : HelpCircle;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-black"
      style={{ background: style.bg, color: style.text }}
      aria-label={`Compliance ${score ?? "unknown"} percent, ${label}`}
    >
      <Icon size={14} aria-hidden />
      {score != null ? `${score}%` : "N/A"}
      <span className="font-bold opacity-80">{label}</span>
    </span>
  );
}

function ShiftTrendChart({
  data,
  onPointClick,
}: {
  data: Array<{ label: string; score: number | null; shift_id: string }>;
  onPointClick?: (shiftId: string) => void;
}) {
  const { translate } = useAccessibility();
  return (
    <section className="rounded-2xl border bg-card p-5 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-4">
        <h2 className="text-sm font-black" style={{ color: TEXT }}>{translate("shiftHistory.trend")}</h2>
        <p className="text-xs font-medium" style={{ color: MUTED }}>
          {translate("shiftHistory.trendHint")}
        </p>
      </div>
      <div className="h-52 w-full">
        {data.every((p) => p.score == null) ? (
          <div
            className="flex h-full items-center justify-center rounded-xl text-sm font-medium"
            style={{ background: SOFT, color: MUTED }}
          >
            {translate("shifts.empty")}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#EDE3FC" />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} />
              <ReferenceLine y={90} stroke="#10B981" strokeDasharray="4 4" />
              <ReferenceLine y={70} stroke="#F59E0B" strokeDasharray="4 4" />
              <Tooltip
                formatter={(v: number) => [`${v}%`, "Score"]}
                contentStyle={{ borderRadius: 12, border: '1px solid var(--cc-border)', fontSize: 12 }}
              />
              <Line
                type="monotone"
                dataKey="score"
                stroke={PLUM}
                strokeWidth={2.5}
                dot={(props) => {
                  const { cx, cy, payload } = props;
                  const row = payload as { shift_id?: string };
                  return (
                    <circle
                      cx={cx}
                      cy={cy}
                      r={4}
                      fill={PLUM}
                      strokeWidth={0}
                      style={{ cursor: "pointer" }}
                      onClick={() => {
                        if (row?.shift_id) onPointClick?.(row.shift_id);
                      }}
                    />
                  );
                }}
                activeDot={{ r: 6 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  );
}

function ShiftDetailPanel({ shiftId, onClose }: { shiftId: string; onClose: () => void }) {
  const { toast } = useToast();
  const [shareOpen, setShareOpen] = useState(false);
  const [lightbox, setLightbox] = useState<{
    displayUrl?: string;
    evidenceId?: string | null;
    label: string;
  } | null>(null);
  const { data, isLoading } = useOrgQuery(["worker", "shift-history", shiftId], {
    queryFn: () => getShiftHistoryDetail(shiftId),
  });

  const exportMut = useMutation({
    mutationFn: () => exportShiftPdf(shiftId),
    onSuccess: async (res) => {
      toast({
        title: "Export ready",
        description: "Your PDF is ready to download.",
      });
      if (res.file_url) {
        window.open(res.file_url, "_blank");
        return;
      }
      if (res.export_id) {
        try {
          await downloadShiftExportFile(res.export_id, `shift-${shiftId.slice(0, 8)}.pdf`);
        } catch (e) {
          toast({
            title: "Download failed",
            description: (e as Error).message,
            variant: "destructive",
          });
        }
      }
    },
    onError: (e: Error) => toast({ title: "Export failed", description: e.message, variant: "destructive" }),
  });

  if (isLoading || !data) {
    return (
      <div className="rounded-2xl border bg-card p-6 text-sm font-bold" style={{ borderColor: BORDER, color: MUTED }}>
        Loading shift details…
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-2xl border bg-card p-5 shadow-md" style={{ borderColor: BORDER }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wider" style={{ color: CORAL }}>
            Shift detail
          </p>
          <h3 className="mt-1 text-lg font-black" style={{ color: TEXT }}>
            {data.participant_first_name} · {formatShiftDate(data.shift_date)}
          </h3>
          <div className="mt-2">
            <ComplianceBadge score={data.compliance_score} band={data.compliance_band} />
          </div>
        </div>
        <UiTooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition hover:bg-cc-bg"
              style={{ color: MUTED }}
            >
              <X size={18} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Close</TooltipContent>
        </UiTooltip>
      </div>

      <p className="rounded-xl p-3 text-sm font-medium leading-relaxed" style={{ background: 'var(--cc-bg)', color: TEXT }}>
        {data.compliance_explanation}
      </p>

      {data.notes && (
        <section>
          <h4 className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>Notes</h4>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed" style={{ color: TEXT }}>{data.notes}</p>
        </section>
      )}

      {!!data.evidence?.length && (
        <section>
          <h4 className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>Evidence</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            {data.evidence.map((ev, i) => {
              const imageUrl = ev.thumbnail_url || (isBrowsableImageUrl(ev.url) ? ev.url : undefined);
              const isPhoto = ev.type === "photo" && (imageUrl || ev.evidence_id);

              if (isPhoto) {
                return (
                  <button
                    key={`${ev.task_id}-${i}`}
                    type="button"
                    onClick={() =>
                      setLightbox({
                        displayUrl: imageUrl,
                        evidenceId: ev.evidence_id || (!isBrowsableImageUrl(ev.url) ? ev.url : undefined),
                        label: ev.label || "Evidence",
                      })
                    }
                    className="group flex w-[4.5rem] flex-col items-stretch overflow-hidden rounded-lg border text-left transition hover:shadow-md"
                    style={{ borderColor: BORDER }}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={ev.label}
                        className="h-14 w-full object-cover transition group-hover:opacity-90"
                      />
                    ) : (
                      <div
                        className="flex h-14 items-center justify-center text-[10px] font-bold"
                        style={{ background: 'var(--cc-bg)', color: MUTED }}
                      >
                        Photo
                      </div>
                    )}
                    <p className="truncate px-1 py-0.5 text-[9px] font-bold leading-tight" style={{ color: TEXT }}>
                      {ev.label}
                    </p>
                  </button>
                );
              }

              return (
                <a
                  key={`${ev.task_id}-${i}`}
                  href={ev.url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex w-[4.5rem] flex-col items-stretch overflow-hidden rounded-lg border"
                  style={{ borderColor: BORDER }}
                >
                  <div
                    className="flex h-14 items-center justify-center bg-cc-bg text-[10px] font-bold uppercase"
                    style={{ color: MUTED }}
                  >
                    {ev.type}
                  </div>
                  <p className="truncate px-1 py-0.5 text-[9px] font-bold leading-tight" style={{ color: TEXT }}>
                    {ev.label}
                  </p>
                </a>
              );
            })}
          </div>
        </section>
      )}

      <Dialog open={!!lightbox} onOpenChange={(open) => !open && setLightbox(null)}>
        <DialogContent
          overlayClassName="bg-[#1E1640]/35"
          className="max-w-3xl gap-3 border bg-card p-4 sm:p-5"
          style={{ borderColor: BORDER }}
        >
          <DialogTitle className="text-center text-sm font-black" style={{ color: TEXT }}>
            {lightbox?.label ?? "Evidence"}
          </DialogTitle>
          {lightbox && (
            <EvidenceLightboxImage
              displayUrl={lightbox.displayUrl}
              evidenceId={lightbox.evidenceId}
              label={lightbox.label}
            />
          )}
        </DialogContent>
      </Dialog>

      {!!data.feedback?.length && (
        <section>
          <h4 className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>Coordinator feedback</h4>
          <div className="mt-2 space-y-3">
            {data.feedback.map((fb) => (
              <div key={fb.id} className="rounded-xl border p-4" style={{ borderColor: BORDER }}>
                <p className="text-xs font-bold" style={{ color: MUTED }}>
                  {fb.coordinator_name} · {formatShiftDate(fb.submitted_at)}
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  <div>
                    <p className="text-[10px] font-black uppercase" style={{ color: "#059669" }}>Strengths</p>
                    <p className="mt-1 text-sm" style={{ color: TEXT }}>{fb.strengths}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase" style={{ color: "#D97706" }}>Focus areas</p>
                    <p className="mt-1 text-sm" style={{ color: TEXT }}>{fb.areas_to_improve}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase" style={{ color: PLUM }}>Action items</p>
                    <p className="mt-1 text-sm" style={{ color: TEXT }}>{fb.action_items}</p>
                  </div>
                </div>
                {!fb.acknowledged_at && (
                  <Link href={`/worker/feedback/${fb.id}`}>
                    <span className="mt-3 inline-block text-xs font-black" style={{ color: PLUM }}>
                      Review & acknowledge →
                    </span>
                  </Link>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => exportMut.mutate()}
          disabled={exportMut.isPending}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 py-2.5 text-sm font-black text-white shadow-sm"
          style={{ background: PLUM }}
        >
          <Download size={16} />
          {exportMut.isPending ? "Generating PDF…" : "Export shift PDF"}
        </button>
        <button
          type="button"
          onClick={() => setShareOpen(true)}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-black shadow-sm"
          style={{ borderColor: BORDER, color: PLUM }}
        >
          <Share2 size={16} />
          Share
        </button>
      </div>

      <ShiftShareSheet
        shiftId={shiftId}
        coordinatorEmail={data.coordinator_email}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </div>
  );
}

function HistoryRow({
  row,
  expanded,
  onToggle,
}: {
  row: ShiftHistoryRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-3 rounded-2xl border bg-card p-4 text-left shadow-sm transition hover:shadow-md",
        expanded && "ring-2 ring-[#EDEAFF]",
      )}
      style={{ borderColor: BORDER }}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: 'var(--cc-bg)' }}>
        {expanded ? <ChevronDown size={18} color={PLUM} /> : <ChevronRight size={18} color={MUTED} />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-black" style={{ color: TEXT }}>{formatShiftDate(row.shift_date)}</p>
          {row.has_unread_feedback && (
            <span className="h-2 w-2 rounded-full" style={{ background: CORAL }} title="Unread feedback" />
          )}
          {row.has_feedback && (
            <MessageSquare size={14} style={{ color: PLUM }} />
          )}
        </div>
        <p className="text-xs font-bold" style={{ color: MUTED }}>
          {row.participant_first_name} · {formatDuration(row.duration_minutes)}
        </p>
      </div>
      <ComplianceBadge score={row.compliance_score} band={row.compliance_band} />
    </button>
  );
}

export default function WorkerShiftHistoryPage() {
  const { translate } = useAccessibility();
  const [participantFilter, setParticipantFilter] = useState<string[]>([]);
  const [bandFilter, setBandFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const filterKey = [participantFilter.join(","), bandFilter, dateFrom, dateTo].join("|");

  const { data, isLoading, error } = useOrgQuery(["worker", "shift-history", filterKey], {
    queryFn: () =>
      getShiftHistory({
        participant_id: participantFilter.length ? participantFilter : undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
        compliance_band: bandFilter,
      }),
  });

  const trendQuery = useOrgQuery(["worker", "shift-history-trend"], {
    queryFn: () => getShiftHistoryTrend(30),
  });

  const chartData = useMemo(() => {
    return (trendQuery.data?.trend ?? []).map((p) => ({
      label: p.date?.slice(5) ?? "",
      score: p.score,
      shift_id: p.shift_id,
    }));
  }, [trendQuery.data]);

  const toggleParticipant = (id: string) => {
    setParticipantFilter((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  if (error) {
    return <div className="p-6 text-sm font-bold text-red-600">{(error as Error).message}</div>;
  }

  return (
    <div className="w-full space-y-6 pb-12 text-safe">
      <header>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
          {translate("nav.performance")}
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-3xl font-black tracking-tight" style={{ color: TEXT }}>
          {translate("shiftHistory.title")}
          <SectionInfo text={translate("shiftHistory.subtitle")} />
        </h1>
      </header>

      <ShiftTrendChart
        data={chartData}
        onPointClick={(id) => setExpandedId(id)}
      />

      <section className="rounded-2xl border bg-card shadow-sm" style={{ borderColor: BORDER }}>
        <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: BORDER }}>
          <div className="flex items-center gap-2">
            <FileText size={18} style={{ color: PLUM }} />
            <h2 className="text-sm font-black" style={{ color: TEXT }}>Last 60 shifts</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((v) => !v)}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-black"
            style={{ background: showFilters ? "#EDEAFF" : "#F8F6FE", color: PLUM }}
          >
            <Filter size={14} />
            Filters
          </button>
        </div>

        {showFilters && (
          <div className="space-y-4 border-b p-4" style={{ borderColor: BORDER }}>
            <div>
              <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>Participant</p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(data?.participants ?? []).map((p) => {
                  const active = participantFilter.includes(p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => toggleParticipant(p.id)}
                      className="rounded-full px-3 py-1.5 text-xs font-bold transition"
                      style={{
                        background: active ? PLUM : "#F8F6FE",
                        color: active ? 'var(--cc-surface)' : MUTED,
                      }}
                    >
                      {p.first_name}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>From</span>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: BORDER }}
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>To</span>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  style={{ borderColor: BORDER }}
                />
              </label>
              <label className="block">
                <span className="text-[10px] font-black uppercase tracking-wider" style={{ color: MUTED }}>Score band</span>
                <select
                  value={bandFilter}
                  onChange={(e) => setBandFilter(e.target.value)}
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm font-bold"
                  style={{ borderColor: BORDER, color: TEXT }}
                >
                  <option value="all">All</option>
                  <option value="green">Green (≥90%)</option>
                  <option value="amber">Amber (70–89%)</option>
                  <option value="red">Red (&lt;70%)</option>
                </select>
              </label>
            </div>
          </div>
        )}

        <div className="space-y-3 p-4">
          {isLoading && (
            <p className="py-8 text-center text-sm font-bold" style={{ color: MUTED }}>Loading shift history…</p>
          )}
          {!isLoading && !(data?.shifts?.length) && (
            <p className="py-8 text-center text-sm font-medium" style={{ color: MUTED }}>
              No completed shifts match your filters.
            </p>
          )}
          {(data?.shifts ?? []).map((row) => (
            <div key={row.id} className="space-y-3">
              <HistoryRow
                row={row}
                expanded={expandedId === row.id}
                onToggle={() => setExpandedId((id) => (id === row.id ? null : row.id))}
              />
              {expandedId === row.id && (
                <ShiftDetailPanel shiftId={row.id} onClose={() => setExpandedId(null)} />
              )}
            </div>
          ))}
        </div>
      </section>

      <p className="text-center text-xs font-medium" style={{ color: MUTED }}>
        <Link href="/worker/performance" className="font-black" style={{ color: PLUM }}>
          View performance dashboard →
        </Link>
      </p>
    </div>
  );
}
