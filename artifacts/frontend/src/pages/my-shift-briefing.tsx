import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { format, parseISO } from "date-fns";
import { Link, useLocation, useParams } from "wouter";
import {
  AlertTriangle,
  ArrowLeft,
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
import { PLUM } from "@/lib/shift-utils";
import {
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
  const [busy, setBusy] = useState(false);

  const { data: briefing, isLoading, error } = useOrgQuery(
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

  const handleComplete = async () => {
    if (!scrolledToBottom) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      toast({
        title: translate("shift.briefing.scrollRequired"),
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
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
      setBusy(false);
    }
  };

  if (!shiftId) {
    return (
      <div className="p-6 text-sm text-cc-muted">
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
      <div className="w-full space-y-4 p-6">
        <Link
          href="/my-shifts"
          className="inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ color: PLUM }}
        >
          <ArrowLeft size={16} aria-hidden />
          {translate("shift.briefing.backToList")}
        </Link>
        <p className="text-sm font-semibold text-cc-coral">
          {(error as Error)?.message || "Could not load briefing."}
        </p>
      </div>
    );
  }

  return (
    <div
      className="flex min-h-[calc(100vh-4rem)] flex-col bg-cc-bg"
      data-tutorial="briefing-page"
    >
      <header className="shrink-0 border-b border-cc-border bg-card">
        <div className="w-full px-4 pb-4 pt-3">
          <Link
            href="/my-shifts"
            className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold transition-colors hover:opacity-80 text-cc-plum"
          >
            <ArrowLeft size={15} strokeWidth={2.25} aria-hidden />
            {translate("shift.briefing.backToList")}
          </Link>

          <div className="flex items-start gap-3">
            <span
              className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl text-white shadow-sm"
              style={{ background: PLUM }}
            >
              <ClipboardList size={18} aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <h1 className="text-lg font-black tracking-tight text-cc-text">
                {translate("shift.briefing")}
              </h1>
              <p className="mt-0.5 text-[13px] font-medium leading-snug text-cc-muted">
                {translate("shift.briefing.subtitle")}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5">
        <div className="w-full space-y-3.5 pb-8 md:pb-36">
          {briefing.requires_rebrief && (
            <div className="flex items-start gap-2.5 rounded-xl border cc-status-warning px-3.5 py-3">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
              <p className="text-[13px] font-semibold leading-relaxed">
                {translate("shift.briefing.rebrief")}
              </p>
            </div>
          )}

          {briefing.critical_alerts.length > 0 && (
            <CriticalAlertsCard alerts={briefing.critical_alerts} />
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

      <footer className="shrink-0 border-t border-cc-border bg-card/95 px-4 py-4 backdrop-blur-sm">
        <div className="w-full space-y-2">
          {!scrolledToBottom && (
            <p className="text-center text-[12px] font-medium text-cc-muted">
              {translate("shift.briefing.scrollHint")}
            </p>
          )}
          <Button
            type="button"
            className={cn(
              "touch-target cc-btn-primary h-[3.25rem] w-full rounded-2xl text-[15px] font-bold shadow-md",
              !scrolledToBottom && "cursor-not-allowed opacity-60",
            )}
            disabled={busy || !scrolledToBottom}
            data-tutorial="briefing-complete"
            onClick={() => void handleComplete()}
          >
            {busy ? (
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
    <section className="overflow-hidden rounded-2xl border border-cc-border bg-card shadow-sm">
      <div
        className={cn(
          "flex items-center gap-2.5 border-b border-cc-border px-4 py-3",
          accent ? "bg-cc-active-bg" : "bg-cc-soft/60",
        )}
      >
        <span
          className={cn(
            "grid h-7 w-7 place-items-center rounded-lg text-cc-plum",
            accent ? "bg-card ring-1 ring-cc-border" : "bg-card shadow-sm",
          )}
        >
          <Icon size={14} aria-hidden />
        </span>
        <h2 className="text-[13px] font-bold tracking-tight text-cc-text">{title}</h2>
      </div>
      <div className="px-4 py-3.5">{children}</div>
    </section>
  );
}

function EmptyState({ children }: { children: ReactNode }) {
  return (
    <p className="text-[13px] font-medium leading-relaxed text-cc-muted">{children}</p>
  );
}

function CriticalAlertsCard({
  alerts,
}: {
  alerts: ShiftBriefingPayload["critical_alerts"];
}) {
  const { translate } = useAccessibility();

  return (
    <section
      className="overflow-hidden rounded-2xl border cc-status-critical shadow-sm"
      aria-label={translate("shift.briefing.criticalAlerts")}
    >
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <AlertTriangle size={15} aria-hidden />
        <p className="text-[12px] font-bold uppercase tracking-wide">
          {translate("shift.briefing.criticalAlerts")}
        </p>
      </div>
      <ul className="divide-y divide-[color-mix(in_srgb,var(--cc-status-critical)_18%,transparent)]">
        {alerts.map((alert, index) => (
          <li key={alert.id} className="flex gap-3 px-4 py-3.5">
            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-[color-mix(in_srgb,var(--cc-status-critical)_20%,transparent)] text-[10px] font-black">
              {index + 1}
            </span>
            <p className="text-[14px] font-semibold leading-relaxed">{alert.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AboutCard({ briefing }: { briefing: ShiftBriefingPayload }) {
  const name = briefing.participant_first_name;
  return (
    <BriefingCard icon={User} title={`About ${name}`} accent>
      {briefing.background_summary.text ? (
        <>
          <p className="text-[14px] font-medium leading-[1.65] text-cc-text">
            {briefing.background_summary.text}
          </p>
          {briefing.background_summary.show_updated_badge && briefing.background_summary.updated_at && (
            <p className="mt-2.5 inline-flex items-center gap-1 rounded-md bg-cc-active-bg px-2 py-0.5 text-[11px] font-bold text-cc-plum">
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
          <p className="text-[11px] font-bold uppercase tracking-wide text-cc-muted">
            {note.author_first_name} · {formatNoteDate(note.date)}
          </p>
          <p className="mt-2 whitespace-pre-wrap text-[14px] font-medium leading-[1.65] text-cc-text">
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
        <p className="whitespace-pre-wrap text-[14px] font-medium leading-[1.65] text-cc-text">
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
      <p className="whitespace-pre-wrap text-[14px] font-semibold leading-[1.65] text-cc-text">{text}</p>
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
                className="group flex items-center justify-between gap-3 rounded-xl border border-cc-border bg-cc-soft px-3.5 py-3 transition-all hover:border-cc-plum hover:bg-cc-active-bg"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-bold text-cc-text">{contact.name}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-cc-muted">
                    {contact.role}
                  </span>
                </span>
                <span className="shrink-0 rounded-lg bg-card px-2.5 py-1 text-[13px] font-bold text-cc-coral ring-1 ring-cc-border group-hover:ring-cc-plum">
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
