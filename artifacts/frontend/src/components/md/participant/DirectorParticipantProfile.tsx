import { useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Download,
  FileSignature,
  PauseCircle,
  PlayCircle,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { ParticipantRecordsTab } from "@/components/participants/ParticipantRecordsTab";
import { PortalAccessCard } from "@/components/participant-portal/PortalAccessCard";
import { ParticipantDetail, type ParticipantDetailTab } from "@/pages/patients";
import {
  getDirectorOverview,
  type Decision,
  type DecisionAction,
  type DirectorOverview,
  type ParticipantDocument,
} from "@/services/directorParticipantService";
import {
  AgreementPortalPanel,
  AuditPanel,
  BAD,
  BORDER,
  CareTeamPanel,
  DeliverySection,
  DocumentsSection,
  FundingSection,
  GOOD,
  MUTED,
  PLUM,
  RiskSection,
  SOFT,
  TEXT,
  WARN,
  formatDate,
  relativeDays,
} from "./DirectorParticipantSections";
import { ArchiveSheet, AuditSheet, ServicesSheet, TeamSheet, UploadSheet, type ServicesMode } from "./DirectorParticipantSheets";

/**
 * The managing director's participant profile. Built for oversight and
 * decisions rather than day-to-day care: what needs the director's call
 * first, then funding against time, delivery, quality and risk, the care
 * team, documents and the audit trail. Director-only powers (changing the
 * team, suspending or ending services, portal access, importing and exporting
 * records) sit here; the coordinator's working record opens in a side panel
 * for anything hands-on.
 */

const ACTION_LABEL: Record<DecisionAction, string> = {
  plan: "Review the plan",
  funding: "Review funding",
  incident: "Open the incident",
  complaint: "Open complaints",
  roster: "Open the schedule",
  team: "Change the team",
  agreement: "Open the agreement",
  quality: "Review notes",
  medication: "Check medication",
};

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
}

function StatStrip({ overview }: { overview: DirectorOverview }) {
  const f = overview.funding;
  const days = relativeDays(overview.participant.plan_end_date);
  const score = overview.quality.average_score;
  const openIncidents = overview.risk.incidents_open.length;
  const items: { value: ReactNode; label: string; color: string }[] = [
    {
      value: f.percent_used == null ? "N/A" : `${Math.round(f.percent_used)}%`,
      label: "of funding used",
      color: f.ahead_by != null && f.ahead_by >= 25 ? BAD : f.ahead_by != null && f.ahead_by >= 10 ? WARN : TEXT,
    },
    {
      value: days == null ? "N/A" : days < 0 ? "Ended" : days,
      label: days == null ? "plan dates not set" : days < 0 ? `plan ended ${formatDate(overview.participant.plan_end_date)}` : "days left in the plan",
      color: days == null ? MUTED : days < 0 || days <= 30 ? BAD : days <= 90 ? WARN : TEXT,
    },
    {
      value: score == null ? "N/A" : `${Math.round(score)}%`,
      label: "note quality",
      color: score == null ? MUTED : score >= 90 ? GOOD : score >= 75 ? WARN : BAD,
    },
    { value: openIncidents, label: openIncidents === 1 ? "open incident" : "open incidents", color: openIncidents ? BAD : GOOD },
    {
      value: overview.delivery.upcoming_14d,
      label: "shifts in the next 14 days",
      color: overview.delivery.unfilled_14d ? WARN : TEXT,
    },
  ];
  return (
    <div className="flex flex-wrap items-stretch gap-x-2 gap-y-3">
      {items.map((item, index) => (
        <div key={item.label} className="flex items-center gap-2">
          {index > 0 && <span aria-hidden className="mr-2 hidden h-6 w-px sm:block" style={{ background: BORDER }} />}
          <span className="flex items-baseline gap-2 px-1">
            <span className="text-2xl font-semibold tabular-nums tracking-tight" style={{ color: item.color }}>{item.value}</span>
            <span className="text-sm" style={{ color: MUTED }}>{item.label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function Decisions({ decisions, firstName, onAct }: { decisions: Decision[]; firstName: string; onAct: (d: Decision) => void }) {
  if (decisions.length === 0) {
    return (
      <div className="flex items-center gap-3 rounded-3xl bg-cc-surface px-5 py-4 sm:px-6">
        <CheckCircle2 size={20} style={{ color: GOOD }} aria-hidden />
        <p className="text-sm" style={{ color: TEXT }}>
          <span className="font-semibold">Nothing needs your decision.</span>{" "}
          <span style={{ color: MUTED }}>Funding, delivery, the team and the paperwork for {firstName} are all on track.</span>
        </p>
      </div>
    );
  }
  return (
    <section aria-labelledby="decisions-heading" className="overflow-hidden rounded-3xl bg-cc-surface">
      <div className="flex items-center justify-between gap-3 px-5 pb-2 pt-5 sm:px-6">
        <h2 id="decisions-heading" className="text-base font-semibold" style={{ color: TEXT }}>Needs your decision</h2>
        <span className="text-sm tabular-nums" style={{ color: MUTED }}>{decisions.length}</span>
      </div>
      <ul>
        {decisions.map((d) => (
          <li key={d.key} className="border-t" style={{ borderColor: BORDER }}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6">
              <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.tone === "danger" ? BAD : WARN }} />
              <div className="min-w-[min(100%,16rem)] flex-1">
                <p className="text-sm font-semibold" style={{ color: TEXT }}>{d.title}</p>
                {d.detail && <p className="mt-0.5 text-sm" style={{ color: MUTED }}>{d.detail}</p>}
              </div>
              <button
                type="button"
                onClick={() => onAct(d)}
                className="ml-6 inline-flex min-h-10 items-center gap-1.5 rounded-full border border-cc-border px-4 text-sm font-medium transition hover:bg-cc-soft sm:ml-0"
                style={{ color: TEXT }}
              >
                {ACTION_LABEL[d.action]} <ArrowRight size={14} aria-hidden />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function StatusBanner({ overview, onResume }: { overview: DirectorOverview; onResume: () => void }) {
  const intake = overview.intake;
  if (!intake) return null;
  if (intake.status === "inactive") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-3xl px-5 py-4 sm:px-6" style={{ background: "var(--cc-amber-tint)" }}>
        <PauseCircle size={20} style={{ color: WARN }} aria-hidden />
        <p className="min-w-0 flex-1 text-sm" style={{ color: TEXT }}>
          <span className="font-semibold">Services suspended{intake.suspended_at ? ` since ${formatDate(intake.suspended_at)}` : ""}.</span>{" "}
          {intake.suspended_reason && <span style={{ color: MUTED }}>{intake.suspended_reason}</span>}
        </p>
        <Button size="sm" onClick={onResume} className="rounded-full text-white" style={{ background: "var(--cc-green)" }}>Resume services</Button>
      </div>
    );
  }
  if (intake.status === "exited") {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-3xl px-5 py-4 sm:px-6" style={{ background: SOFT }}>
        <XCircle size={20} style={{ color: MUTED }} aria-hidden />
        <p className="min-w-0 flex-1 text-sm" style={{ color: TEXT }}>
          <span className="font-semibold">Services ended{intake.last_service_date ? ` on ${formatDate(intake.last_service_date)}` : ""}.</span>{" "}
          {intake.exit_reason && <span style={{ color: MUTED }}>{intake.exit_reason}</span>}{" "}
          <span style={{ color: MUTED }}>The record is kept for the retention period.</span>
        </p>
      </div>
    );
  }
  return null;
}

export function DirectorParticipantProfile({
  participantId,
  onBack,
  intakeForm,
  onIntakeChanged,
}: {
  participantId: string;
  onBack: () => void;
  intakeForm: ReactNode;
  onIntakeChanged: () => void;
}) {
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { user } = useAuth();
  const overviewQuery = useOrgQuery(["director-participant", participantId, "overview"], {
    queryFn: () => getDirectorOverview(participantId),
  });

  const [careRecordTab, setCareRecordTab] = useState<ParticipantDetailTab | null>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [archiveDoc, setArchiveDoc] = useState<ParticipantDocument | null>(null);
  const [servicesMode, setServicesMode] = useState<ServicesMode | null>(null);

  function refresh() {
    void qc.invalidateQueries({ queryKey: [user?.organizationId ?? "__no_org__", "director-participant", participantId] });
    void qc.invalidateQueries({ queryKey: [user?.organizationId ?? "__no_org__", "participant", participantId] });
  }

  const back = (
    <button
      onClick={onBack}
      className="-ml-2 inline-flex min-h-10 items-center gap-1.5 rounded-full px-2 text-sm font-medium transition-colors hover:bg-cc-soft"
      style={{ color: MUTED }}
    >
      <ArrowLeft size={15} /> Participants
    </button>
  );

  if (overviewQuery.isLoading) {
    return (
      <div className="space-y-6 pb-10">
        {back}
        <Skeleton className="h-16 w-2/3 rounded-2xl" />
        <Skeleton className="h-10 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-3xl" />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Skeleton className="h-80 rounded-3xl" />
          <Skeleton className="h-80 rounded-3xl" />
        </div>
      </div>
    );
  }
  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <div className="space-y-6 pb-10">
        {back}
        <div role="alert" className="rounded-3xl bg-cc-surface px-6 py-14 text-center">
          <AlertTriangle size={26} className="mx-auto mb-3" style={{ color: WARN }} />
          <h2 className="text-base font-semibold" style={{ color: TEXT }}>This participant couldn't be loaded</h2>
          <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: MUTED }}>{(overviewQuery.error as Error | null)?.message ?? "Try again in a moment."}</p>
          <button type="button" onClick={() => void overviewQuery.refetch()} className="mt-5 min-h-11 rounded-full border border-cc-border px-5 text-sm font-semibold" style={{ color: TEXT }}>Try again</button>
        </div>
      </div>
    );
  }

  const o = overviewQuery.data;
  const p = o.participant;
  const firstName = (p.preferred_name || p.full_name).split(" ")[0];
  const status = o.intake?.status ?? "active";
  const exited = status === "exited";

  function act(d: Decision) {
    switch (d.action) {
      case "plan":
      case "funding":
      case "agreement":
        setCareRecordTab("plan_goals");
        break;
      case "quality":
        setCareRecordTab("compliance");
        break;
      case "medication":
        setCareRecordTab("care_profile");
        break;
      case "team":
        setTeamOpen(true);
        break;
      case "roster":
        navigate("/md/schedule");
        break;
      case "complaint":
        navigate("/onboard-participant/complaints");
        break;
      case "incident":
        navigate(d.key.startsWith("incident_") ? `/incidents/${d.key.slice("incident_".length)}` : "/incidents");
        break;
    }
  }

  const meta = [
    p.service_category === "aged_care" ? "Aged Care" : "Disability",
    p.ndis_number ? `NDIS ${p.ndis_number}` : null,
    p.plan_start_date && p.plan_end_date ? `Plan ${formatDate(p.plan_start_date)} to ${formatDate(p.plan_end_date)}` : null,
    o.intake?.activated_at ? `With you since ${formatDate(o.intake.activated_at)}` : null,
  ].filter(Boolean).join(" · ");

  return (
    <div className="space-y-6 pb-10">
      <header className="space-y-4">
        {back}
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 items-center gap-4">
            <div
              aria-hidden
              className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-lg font-semibold"
              style={{ background: SOFT, color: TEXT }}
            >
              {initials(p.full_name)}
            </div>
            <div className="min-w-0">
              <h1 className="text-3xl font-semibold tracking-tight" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>
                {p.full_name}
              </h1>
              <p className="mt-1 text-sm" style={{ color: MUTED }}>{meta}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCareRecordTab("overview")}
              className="inline-flex min-h-11 items-center gap-2 rounded-full px-5 text-sm font-medium text-white transition hover:opacity-90"
              style={{ background: PLUM }}
            >
              <ClipboardList size={16} aria-hidden /> Open care record
            </button>
            <button
              type="button"
              onClick={() => setIntakeOpen(true)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-cc-border bg-cc-surface px-5 text-sm font-medium transition hover:bg-cc-soft"
              style={{ color: TEXT }}
            >
              <FileSignature size={16} aria-hidden /> Intake form
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-cc-border bg-cc-surface px-4 text-sm font-medium transition hover:bg-cc-soft"
                  style={{ color: TEXT }}
                >
                  Director actions <ChevronDown size={15} aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                <DropdownMenuItem onSelect={() => setTeamOpen(true)} disabled={exited}>Change the care team</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setPortalOpen(true)}>Manage portal access</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setUploadOpen(true)}>Import a document</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setExportOpen(true)}>
                  <Download size={14} className="mr-2" /> Export records
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setAuditOpen(true)}>View the audit trail</DropdownMenuItem>
                {!exited && <DropdownMenuSeparator />}
                {status === "inactive" && (
                  <DropdownMenuItem onSelect={() => setServicesMode("resume")}>
                    <PlayCircle size={14} className="mr-2" /> Resume services
                  </DropdownMenuItem>
                )}
                {status === "active" && (
                  <DropdownMenuItem onSelect={() => setServicesMode("suspend")}>
                    <PauseCircle size={14} className="mr-2" /> Suspend services
                  </DropdownMenuItem>
                )}
                {!exited && (
                  <DropdownMenuItem onSelect={() => setServicesMode("end")} style={{ color: BAD }}>
                    <XCircle size={14} className="mr-2" /> End services
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      <StatusBanner overview={o} onResume={() => setServicesMode("resume")} />
      <StatStrip overview={o} />
      {!exited && <Decisions decisions={o.decisions} firstName={firstName} onAct={act} />}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-5">
          <FundingSection overview={o} onReview={() => setCareRecordTab("plan_goals")} />
          <DeliverySection overview={o} onOpenSchedule={() => navigate("/md/schedule")} onOpenShifts={() => setCareRecordTab("sessions")} />
          <RiskSection
            overview={o}
            onOpenIncident={(id) => navigate(id ? `/incidents/${id}` : "/incidents")}
            onOpenComplaints={() => navigate("/onboard-participant/complaints")}
            onOpenMedication={() => setCareRecordTab("care_profile")}
          />
          <DocumentsSection participantId={participantId} onUpload={() => setUploadOpen(true)} onExport={() => setExportOpen(true)} onArchive={setArchiveDoc} />
        </div>
        <div className="min-w-0 space-y-5 xl:sticky xl:top-24">
          <CareTeamPanel overview={o} onChange={() => setTeamOpen(true)} />
          <AgreementPortalPanel overview={o} onOpenAgreement={() => setCareRecordTab("plan_goals")} onManagePortal={() => setPortalOpen(true)} />
          <AuditPanel participantId={participantId} onSeeAll={() => setAuditOpen(true)} />
        </div>
      </div>

      {/* The coordinator's working record, for anything hands-on. */}
      <Sheet open={careRecordTab !== null} onOpenChange={(v) => { if (!v) { setCareRecordTab(null); refresh(); } }}>
        <SheetContent className="w-full overflow-y-auto p-0 sm:max-w-5xl">
          <SheetHeader className="sr-only">
            <SheetTitle>Care record for {p.full_name}</SheetTitle>
            <SheetDescription>Personal details, care, plan and goals, shifts, compliance and meetings.</SheetDescription>
          </SheetHeader>
          {careRecordTab && (
            <ParticipantDetail key={careRecordTab} id={participantId} onRefreshList={refresh} initialTab={careRecordTab} syncUrl={false} />
          )}
        </SheetContent>
      </Sheet>

      <Sheet open={intakeOpen} onOpenChange={(v) => { setIntakeOpen(v); if (!v) onIntakeChanged(); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Intake form</SheetTitle>
            <SheetDescription>What was captured when {firstName} was referred. Changes here update the intake record.</SheetDescription>
          </SheetHeader>
          <div className="mt-4">{intakeForm}</div>
        </SheetContent>
      </Sheet>

      <Sheet open={portalOpen} onOpenChange={(v) => { setPortalOpen(v); if (!v) refresh(); }}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>Portal access</SheetTitle>
            <SheetDescription>Who can sign in to see {firstName}'s schedule, plan and documents. Only you can give or remove access.</SheetDescription>
          </SheetHeader>
          <div className="mt-4"><PortalAccessCard participantId={participantId} /></div>
        </SheetContent>
      </Sheet>

      <Sheet open={exportOpen} onOpenChange={setExportOpen}>
        <SheetContent className="flex w-full flex-col p-0 sm:max-w-3xl">
          <SheetHeader className="border-b border-cc-border p-5 pr-12">
            <SheetTitle>Export records</SheetTitle>
            <SheetDescription>Download {firstName}'s profile, shift history, invoices and documents on file as one PDF or ZIP.</SheetDescription>
          </SheetHeader>
          <ParticipantRecordsTab key={participantId} participantId={participantId} participantName={p.full_name} />
        </SheetContent>
      </Sheet>

      <TeamSheet open={teamOpen} onOpenChange={setTeamOpen} participantId={participantId} overview={o} onSaved={refresh} />
      <UploadSheet open={uploadOpen} onOpenChange={setUploadOpen} participantId={participantId} onSaved={refresh} />
      <ArchiveSheet doc={archiveDoc} onOpenChange={(v) => { if (!v) setArchiveDoc(null); }} participantId={participantId} onSaved={refresh} />
      <AuditSheet open={auditOpen} onOpenChange={setAuditOpen} participantId={participantId} />
      {servicesMode && (
        <ServicesSheet
          open={servicesMode !== null}
          onOpenChange={(v) => { if (!v) setServicesMode(null); }}
          mode={servicesMode}
          participantId={participantId}
          overview={o}
          onSaved={() => { refresh(); onIntakeChanged(); }}
        />
      )}
    </div>
  );
}
