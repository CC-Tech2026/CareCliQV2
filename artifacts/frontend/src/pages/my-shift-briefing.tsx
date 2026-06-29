import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { Link, useLocation, useParams } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ClipboardList,
  Loader2,
  MessageCircle,
  Phone,
  ScrollText,
  Sparkles,
  User,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import {
  acknowledgeBriefingAlert,
  completeShiftBriefing,
  getShiftBriefing,
  type ShiftBriefingPayload,
} from "@/services/shiftService";
import { cn } from "@/lib/utils";
import { useWorkerTutorialOptional } from "@/hooks/useWorkerTutorial";

function formatNoteDate(value?: string | null) {
  if (!value) return "";
  try {
    return format(parseISO(value), "d MMM yyyy");
  } catch {
    return value;
  }
}

function formatUpdatedDate(value?: string | null) {
  if (!value) return "";
  try {
    return format(parseISO(value), "d MMM yyyy");
  } catch {
    return value;
  }
}

export default function MyShiftBriefing() {
  const params = useParams<{ id: string }>();
  const [location, navigate] = useLocation();
  const shiftId = (params.id || "").trim();
  const { toast } = useToast();
  const { translate } = useAccessibility();
  const tutorial = useWorkerTutorialOptional();
  const isTutorial = useMemo(
    () => location.includes("tutorial=1") || (tutorial?.isTutorialMode ?? false),
    [location, tutorial?.isTutorialMode],
  );
  const isReview = useMemo(() => location.includes("review=1"), [location]);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrolledToBottom, setScrolledToBottom] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const { data: briefing, isLoading, error, refetch } = useOrgQuery(
    ["worker", "shift", shiftId, "briefing"],
    { queryFn: () => getShiftBriefing(shiftId), enabled: Boolean(shiftId) },
  );

  useEffect(() => {
    if (briefing?.briefing_complete && !isTutorial && !isReview) {
      navigate(`/my-shifts/${shiftId}`);
    }
  }, [briefing?.briefing_complete, isTutorial, isReview, navigate, shiftId]);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const threshold = 48;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    setScrolledToBottom(atBottom);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    checkScroll();
    el.addEventListener("scroll", checkScroll, { passive: true });
    return () => el.removeEventListener("scroll", checkScroll);
  }, [briefing, checkScroll]);

  const handleAckAlert = async (alertId: string) => {
    setBusy(`alert-${alertId}`);
    try {
      await acknowledgeBriefingAlert(shiftId, alertId);
      await refetch();
    } catch (err) {
      toast({
        title: translate("shift.briefing.ackFailed"),
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  const handleComplete = async () => {
    if (!briefing?.all_alerts_acknowledged) {
      toast({
        title: translate("shift.briefing.alertsRequired"),
        variant: "destructive",
      });
      return;
    }
    if (!scrolledToBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      toast({
        title: translate("shift.briefing.scrollRequired"),
        variant: "destructive",
      });
      return;
    }
    setBusy("complete");
    try {
      await completeShiftBriefing(shiftId, true);
      toast({ title: translate("shift.briefing.readyConfirmed") });
      if (isTutorial && tutorial?.activeStep?.key === "pre_shift_briefing_complete") {
        const marker = document.createElement("div");
        marker.setAttribute("data-tutorial", "briefing-complete-marker");
        marker.className = "sr-only";
        document.body.appendChild(marker);
        await tutorial.nextStep();
        return;
      }
      navigate(`/my-shifts/${shiftId}`);
    } catch (err) {
      toast({
        title: translate("shift.briefing.completeFailed"),
        description: (err as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  if (!shiftId) {
    return (
      <div className="p-6 text-sm" style={{ color: MUTED }}>
        Shift not found.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: PLUM }} />
      </div>
    );
  }

  if (error || !briefing) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <Link
          href="/my-shifts"
          className="inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ color: PLUM }}
        >
          <ArrowLeft size={16} aria-hidden />
          {translate("shift.briefing.backToList")}
        </Link>
        <p className="text-sm font-semibold text-red-700">
          {(error as Error)?.message || "Could not load briefing."}
        </p>
      </div>
    );
  }

  const canComplete = briefing.all_alerts_acknowledged && scrolledToBottom;

  return (
    <div
      className="flex min-h-[calc(100vh-4rem)] flex-col bg-[var(--cc-bg)]"
      data-tutorial="briefing-page"
    >
      <header
        className="shrink-0 border-b bg-[var(--cc-surface)]"
        style={{ borderColor: BORDER }}
      >
        <div className="mx-auto max-w-2xl px-4 pb-4 pt-3">
          <Link
            href="/my-shifts"
            className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold transition-colors hover:opacity-80"
            style={{ color: PLUM }}
          >
            <ArrowLeft size={15} strokeWidth={2.25} aria-hidden />
            {translate("shift.briefing.backToList")}
          </Link>

          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-sm"
              style={{ background: `linear-gradient(135deg, ${PLUM} 0%, #5B21B6 100%)` }}
            >
              <ClipboardList size={18} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-black tracking-tight" style={{ color: TEXT }}>
                {translate("shift.briefing")}
              </h1>
              <p className="mt-0.5 text-[13px] font-medium leading-snug" style={{ color: MUTED }}>
                {translate("shift.briefing.subtitle")}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto max-w-2xl space-y-3.5 pb-36">
          {briefing.requires_rebrief && (
            <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-700" aria-hidden />
              <p className="text-[13px] font-semibold leading-relaxed text-amber-900">
                {translate("shift.briefing.rebrief")}
              </p>
            </div>
          )}

          {briefing.critical_alerts.length > 0 && (
            <section className="space-y-2.5" aria-label="Critical alerts">
              {briefing.critical_alerts.map((alert) => (
                <CriticalAlertBanner
                  key={alert.id}
                  alert={alert}
                  busy={busy === `alert-${alert.id}`}
                  onAcknowledge={() => void handleAckAlert(alert.id)}
                />
              ))}
            </section>
          )}

          <AboutCard briefing={briefing} />
          <PreviousNotesCard briefing={briefing} />
          <CommunicationCard briefing={briefing} />
          {briefing.special_instructions && (
            <SpecialInstructionsCard text={briefing.special_instructions} />
          )}
          <EmergencyContactsCard contacts={briefing.emergency_contacts} />

          <div ref={bottomRef} className="h-1" aria-hidden />
        </div>
      </div>

      <footer
        className="shrink-0 border-t bg-[var(--cc-surface)]/95 px-4 py-4 backdrop-blur-sm"
        style={{ borderColor: BORDER, boxShadow: "0 -8px 24px rgba(15, 23, 42, 0.06)" }}
      >
        <div className="mx-auto max-w-2xl space-y-2">
          {!canComplete && (
            <p className="text-center text-[12px] font-medium" style={{ color: MUTED }}>
              {!briefing.all_alerts_acknowledged
                ? translate("shift.briefing.alertsRequired")
                : translate("shift.briefing.scrollHint")}
            </p>
          )}
          <Button
            type="button"
            className={cn(
              "touch-target h-[3.25rem] w-full rounded-2xl border-0 text-[15px] font-bold text-white shadow-md transition-all",
              canComplete ? "hover:brightness-105" : "cursor-not-allowed opacity-60",
            )}
            style={{
              background: canComplete
                ? "linear-gradient(135deg, #7C3AED 0%, #5B21B6 100%)"
                : "#94A3B8",
            }}
            disabled={busy !== null || !canComplete}
            data-tutorial="briefing-complete"
            onClick={() => void handleComplete()}
          >
            {busy === "complete" ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              translate("shift.briefing.readyToStart")
            )}
          </Button>
        </div>
      </footer>
    </div>
  );
}

function BriefingCard({
  icon: Icon,
  title,
  accent = false,
  children,
}: {
  icon: LucideIcon;
  title: string;
  accent?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "overflow-hidden rounded-2xl border bg-[var(--cc-surface)] shadow-[0_1px_3px_rgba(15,23,42,0.06)]",
        accent ? "border-violet-200" : "border-[var(--cc-border)]",
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2.5 border-b px-4 py-3",
          accent ? "border-violet-100 bg-violet-50/60" : "border-[var(--cc-border)] bg-[var(--cc-bg)]/50",
        )}
      >
        <span
          className={cn(
            "grid h-7 w-7 place-items-center rounded-lg",
            accent ? "bg-violet-100 text-violet-700" : "bg-white text-violet-600 shadow-sm",
          )}
        >
          <Icon size={14} aria-hidden />
        </span>
        <h2 className="text-[13px] font-bold tracking-tight" style={{ color: TEXT }}>
          {title}
        </h2>
      </div>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="text-[13px] font-medium leading-relaxed" style={{ color: MUTED }}>
      {children}
    </p>
  );
}

function CriticalAlertBanner({
  alert,
  busy,
  onAcknowledge,
}: {
  alert: ShiftBriefingPayload["critical_alerts"][number];
  busy: boolean;
  onAcknowledge: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-red-200 bg-white shadow-[0_1px_3px_rgba(220,38,38,0.12)]">
      <div className="flex items-center gap-2 border-b border-red-100 bg-red-50 px-4 py-2.5">
        <AlertTriangle size={15} className="text-red-600" aria-hidden />
        <p className="text-[12px] font-bold uppercase tracking-wide text-red-800">Critical alert</p>
      </div>
      <div className="px-4 py-3.5">
        <p className="text-[14px] font-semibold leading-relaxed text-red-950">{alert.text}</p>
        {alert.acknowledged ? (
          <p className="mt-3 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-bold text-emerald-700">
            <CheckCircle2 size={13} aria-hidden />
            Acknowledged
          </p>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="mt-3 h-10 w-full rounded-xl border-red-200 bg-white text-[13px] font-bold text-red-800 hover:bg-red-50"
            disabled={busy}
            onClick={onAcknowledge}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Tap to acknowledge"}
          </Button>
        )}
      </div>
    </div>
  );
}

function AboutCard({ briefing }: { briefing: ShiftBriefingPayload }) {
  const name = briefing.participant_first_name;
  return (
    <BriefingCard icon={User} title={`About ${name}`} accent>
      {briefing.background_summary.text ? (
        <>
          <p className="text-[14px] font-medium leading-[1.65]" style={{ color: TEXT }}>
            {briefing.background_summary.text}
          </p>
          {briefing.background_summary.show_updated_badge && briefing.background_summary.updated_at && (
            <p className="mt-2.5 inline-flex items-center gap-1 rounded-md bg-violet-50 px-2 py-0.5 text-[11px] font-bold text-violet-700">
              <Sparkles size={11} aria-hidden />
              Updated {formatUpdatedDate(briefing.background_summary.updated_at)}
            </p>
          )}
        </>
      ) : (
        <EmptyState>No background summary recorded yet.</EmptyState>
      )}
    </BriefingCard>
  );
}

function PreviousNotesCard({ briefing }: { briefing: ShiftBriefingPayload }) {
  const note = briefing.previous_shift_note;
  return (
    <BriefingCard icon={ScrollText} title="Previous shift notes">
      {note ? (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: MUTED }}>
            {note.author_first_name} · {formatNoteDate(note.date)}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-[14px] font-medium leading-[1.65]" style={{ color: TEXT }}>
            {note.content}
          </p>
        </div>
      ) : (
        <EmptyState>No previous shift notes for this participant</EmptyState>
      )}
    </BriefingCard>
  );
}

function CommunicationCard({ briefing }: { briefing: ShiftBriefingPayload }) {
  return (
    <BriefingCard icon={MessageCircle} title="Communication preferences">
      {briefing.communication_preferences ? (
        <p className="whitespace-pre-wrap text-[14px] font-medium leading-[1.65]" style={{ color: TEXT }}>
          {briefing.communication_preferences}
        </p>
      ) : (
        <EmptyState>Not recorded</EmptyState>
      )}
    </BriefingCard>
  );
}

function SpecialInstructionsCard({ text }: { text: string }) {
  return (
    <BriefingCard icon={ClipboardList} title="Special instructions for this shift" accent>
      <p className="whitespace-pre-wrap text-[14px] font-semibold leading-[1.65] text-amber-950">{text}</p>
    </BriefingCard>
  );
}

function EmergencyContactsCard({
  contacts,
}: {
  contacts: ShiftBriefingPayload["emergency_contacts"];
}) {
  return (
    <BriefingCard icon={Phone} title="Emergency contacts">
      {contacts.length === 0 ? (
        <EmptyState>No emergency contacts on file.</EmptyState>
      ) : (
        <ul className="space-y-2">
          {contacts.map((contact) => (
            <li key={`${contact.role}-${contact.phone}`}>
              <a
                href={`tel:${contact.phone.replace(/\s/g, "")}`}
                className="group flex items-center justify-between gap-3 rounded-xl border border-rose-100 bg-gradient-to-r from-rose-50/80 to-white px-3.5 py-3 transition-all hover:border-rose-200 hover:shadow-sm"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-bold text-rose-950">{contact.name}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-rose-600/80">
                    {contact.role}
                  </span>
                </span>
                <span className="shrink-0 rounded-lg bg-white px-2.5 py-1 text-[13px] font-bold text-rose-700 shadow-sm ring-1 ring-rose-100 group-hover:ring-rose-200">
                  {contact.phone}
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </BriefingCard>
  );
}
