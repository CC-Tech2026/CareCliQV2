import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CalendarPlus,
  CheckCircle2,
  ChevronDown,
  Download,
  FileSignature,
  PauseCircle,
  PlayCircle,
  XCircle,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { AddShiftMenu } from "@/components/coordinator/AddShiftMenu";
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
  AuditPanel,
  BAD,
  BORDER,
  CareTeamPanel,
  DeliverySection,
  DocumentsSection,
  FundingSection,
  GOOD,
  MUTED,
  RiskSection,
  SOFT,
  Section,
  TEXT,
  WARN,
  formatDate,
} from "./DirectorParticipantSections";
import { AgreementsSection, ProfileHeader, RecentShiftsSection, SupportNeedsSection } from "./DirectorParticipantCards";
import { ArchiveSheet, AuditSheet, ServicesSheet, TeamSheet, UploadSheet, type ServicesMode } from "./DirectorParticipantSheets";

/**
 * The managing director's participant profile: one page per participant.
 * A plain header (who they are, where the NDIS plan stands, the main actions),
 * one row of sections, and one surface for the section open. The Summary is
 * the director's view (what needs a decision, budget against time, delivery,
 * safety, the support team); every other section is the same record the
 * coordinators work from, shown in place rather than in a side panel.
 */

type ProfileTab = "summary" | "documents" | Exclude<ParticipantDetailTab, "records">;

const TABS: { id: ProfileTab; label: string }[] = [
  { id: "summary", label: "Summary" },
  { id: "overview", label: "Details & contacts" },
  { id: "care_profile", label: "Support needs" },
  { id: "plan_goals", label: "NDIS plan & goals" },
  { id: "sessions", label: "Progress notes" },
  { id: "compliance", label: "Compliance" },
  { id: "documents", label: "Documents & agreements" },
  { id: "plan_meetings", label: "Plan reviews & meetings" },
];
const TAB_IDS = new Set<string>(TABS.map((t) => t.id));

const ACTION_LABEL: Record<DecisionAction, string> = {
  plan: "Review the plan",
  funding: "Review the budget",
  incident: "Open the incident",
  complaint: "Open complaints",
  roster: "Open the roster",
  team: "Change the support team",
  agreement: "Open the agreement",
  quality: "Review progress notes",
  medication: "Check medication",
};

// The section open is kept in the address (?section=), so a refresh, a link
// or Back returns to it.
function readSection(): ProfileTab {
  try {
    const s = new URLSearchParams(window.location.search).get("section");
    return s && TAB_IDS.has(s) ? (s as ProfileTab) : "summary";
  } catch {
    return "summary";
  }
}

function writeSection(tab: ProfileTab) {
  try {
    const url = new URL(window.location.href);
    if (tab === "summary") url.searchParams.delete("section");
    else url.searchParams.set("section", tab);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  } catch {
    /* only a convenience */
  }
}

function Decisions({ decisions, firstName, onAct }: { decisions: Decision[]; firstName: string; onAct: (d: Decision) => void }) {
  if (decisions.length === 0) {
    return (
      <p className="flex items-center gap-2.5 text-sm" style={{ color: TEXT }}>
        <CheckCircle2 size={18} aria-hidden className="shrink-0" style={{ color: GOOD }} />
        <span>
          <span className="font-semibold">Nothing needs your decision.</span>{" "}
          <span style={{ color: MUTED }}>The plan, funding, support team and paperwork for {firstName} are on track.</span>
        </span>
      </p>
    );
  }
  return (
    <Section title="Needs your decision" count={decisions.length}>
      <ul className="divide-y" style={{ borderColor: BORDER }}>
        {decisions.map((d) => (
          <li key={d.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-3">
            <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: d.tone === "danger" ? BAD : WARN }} />
            <div className="min-w-0 flex-1 basis-60">
              <p className="text-sm font-semibold" style={{ color: TEXT }}>
                <span className="sr-only">{d.tone === "danger" ? "Urgent: " : "Check: "}</span>
                {d.title}
              </p>
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
          </li>
        ))}
      </ul>
    </Section>
  );
}

function StatusBanner({ overview, onResume }: { overview: DirectorOverview; onResume: () => void }) {
  const intake = overview.intake;
  if (!intake || (intake.status !== "inactive" && intake.status !== "exited")) return null;
  const suspended = intake.status === "inactive";
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 border-l-4 px-4 py-3"
      style={{ borderColor: suspended ? WARN : MUTED, background: suspended ? "var(--cc-amber-tint)" : SOFT }}
    >
      {suspended ? <PauseCircle size={18} aria-hidden style={{ color: WARN }} /> : <XCircle size={18} aria-hidden style={{ color: MUTED }} />}
      <p className="min-w-0 flex-1 text-sm" style={{ color: TEXT }}>
        {suspended ? (
          <>
            <span className="font-semibold">Services suspended{intake.suspended_at ? ` since ${formatDate(intake.suspended_at)}` : ""}.</span>{" "}
            {intake.suspended_reason && <span style={{ color: MUTED }}>{intake.suspended_reason}</span>}
          </>
        ) : (
          <>
            <span className="font-semibold">Services ended{intake.last_service_date ? ` on ${formatDate(intake.last_service_date)}` : ""}.</span>{" "}
            {intake.exit_reason && <span style={{ color: MUTED }}>{intake.exit_reason}</span>}{" "}
            <span style={{ color: MUTED }}>The record is kept for the retention period.</span>
          </>
        )}
      </p>
      {suspended && (
        <Button size="sm" onClick={onResume} className="rounded-full text-white" style={{ background: "var(--cc-cta)" }}>
          Resume services
        </Button>
      )}
    </div>
  );
}

const outlineButton =
  "inline-flex min-h-10 items-center gap-2 rounded-full border border-cc-border bg-cc-surface px-4 text-sm font-medium transition hover:bg-cc-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-cc-plum";

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

  const [tab, setTabState] = useState<ProfileTab>(readSection);
  const tabsRef = useRef<HTMLElement>(null);
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [portalOpen, setPortalOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [auditOpen, setAuditOpen] = useState(false);
  const [archiveDoc, setArchiveDoc] = useState<ParticipantDocument | null>(null);
  const [servicesMode, setServicesMode] = useState<ServicesMode | null>(null);

  // A different participant opens on their Summary.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    setTabState("summary");
    writeSection("summary");
  }, [participantId]);

  function setTab(next: ProfileTab) {
    setTabState(next);
    writeSection(next);
  }
  // On a narrow screen the row of sections scrolls: keep the open one in view.
  useEffect(() => {
    tabsRef.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
  }, [tab]);
  // From a link inside the page (a decision, "All support needs"): open the
  // section and bring its tab into view.
  function openTab(next: ProfileTab) {
    setTab(next);
    tabsRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }

  function refresh() {
    void qc.invalidateQueries({ queryKey: [user?.organizationId ?? "__no_org__", "director-participant", participantId] });
    void qc.invalidateQueries({ queryKey: [user?.organizationId ?? "__no_org__", "participant", participantId] });
  }

  const back = (
    <button
      type="button"
      onClick={onBack}
      className="-ml-2 inline-flex min-h-10 items-center gap-1.5 rounded-full px-2 text-sm font-medium transition-colors hover:bg-cc-soft"
      style={{ color: MUTED }}
    >
      <ArrowLeft size={15} aria-hidden /> Participants
    </button>
  );

  if (overviewQuery.isLoading) {
    return (
      <div className="space-y-5 pb-10" role="status" aria-label="Loading the participant">
        {back}
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-8 w-64" />
            <Skeleton className="h-4 w-full max-w-xl" />
          </div>
        </div>
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-96 w-full rounded-2xl" />
      </div>
    );
  }
  if (overviewQuery.isError || !overviewQuery.data) {
    return (
      <div className="space-y-5 pb-10">
        {back}
        <div role="alert" className="rounded-2xl border border-cc-border bg-cc-surface px-6 py-14 text-center">
          <AlertTriangle size={26} className="mx-auto mb-3" style={{ color: WARN }} aria-hidden />
          <h2 className="text-base font-semibold" style={{ color: TEXT }}>This participant couldn't be loaded</h2>
          <p className="mx-auto mt-2 max-w-md text-sm" style={{ color: MUTED }}>{(overviewQuery.error as Error | null)?.message ?? "Try again in a moment."}</p>
          <button type="button" onClick={() => void overviewQuery.refetch()} className={`${outlineButton} mt-5`} style={{ color: TEXT }}>Try again</button>
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
        openTab("plan_goals");
        break;
      case "quality":
        openTab("compliance");
        break;
      case "medication":
        openTab("care_profile");
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

  // A shift still in review opens where it's reviewed; any other opens its
  // detail on the schedule.
  function openShift(shiftId: string, review: string | null) {
    if (review && review !== "verified") navigate(`/coordinator/verification?shiftId=${encodeURIComponent(shiftId)}`);
    else navigate(`/md/schedule?shiftId=${encodeURIComponent(shiftId)}`);
  }

  const actions = (
    <>
      {!exited && (
        <AddShiftMenu participant={{ id: participantId, full_name: p.full_name }}>
          <button
            type="button"
            className="inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-sm font-medium text-white transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum"
            style={{ background: "var(--cc-cta)" }}
          >
            <CalendarPlus size={16} aria-hidden /> Add a shift
          </button>
        </AddShiftMenu>
      )}
      <button type="button" onClick={() => setIntakeOpen(true)} className={outlineButton} style={{ color: TEXT }}>
        <FileSignature size={16} aria-hidden /> Intake form
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" className={outlineButton} style={{ color: TEXT }}>
            More actions <ChevronDown size={15} aria-hidden />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onSelect={() => setTeamOpen(true)} disabled={exited}>Change the support team</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setPortalOpen(true)}>Manage participant portal access</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setUploadOpen(true)}>Import a document</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setExportOpen(true)}>
            <Download size={14} className="mr-2" aria-hidden /> Export records
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setAuditOpen(true)}>View the audit trail</DropdownMenuItem>
          {!exited && <DropdownMenuSeparator />}
          {status === "inactive" && (
            <DropdownMenuItem onSelect={() => setServicesMode("resume")}>
              <PlayCircle size={14} className="mr-2" aria-hidden /> Resume services
            </DropdownMenuItem>
          )}
          {status === "active" && (
            <DropdownMenuItem onSelect={() => setServicesMode("suspend")}>
              <PauseCircle size={14} className="mr-2" aria-hidden /> Suspend services
            </DropdownMenuItem>
          )}
          {!exited && (
            <DropdownMenuItem onSelect={() => setServicesMode("end")} style={{ color: BAD }}>
              <XCircle size={14} className="mr-2" aria-hidden /> End services
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );

  const summary = (
    <div className="space-y-8">
      {!exited && <Decisions decisions={o.decisions} firstName={firstName} onAct={act} />}
      <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-2">
        <div className="min-w-0 space-y-8">
          <FundingSection overview={o} onReview={() => openTab("plan_goals")} />
          <DeliverySection overview={o} onOpenSchedule={() => navigate("/md/schedule")} onOpenShifts={() => openTab("sessions")} />
          <SupportNeedsSection overview={o} onOpenNeeds={() => openTab("care_profile")} onOpenMedication={() => openTab("care_profile")} />
        </div>
        <div className="min-w-0 space-y-8">
          <CareTeamPanel overview={o} onChange={exited ? undefined : () => setTeamOpen(true)} />
          <RiskSection
            overview={o}
            onOpenIncident={(incidentId) => navigate(incidentId ? `/incidents/${incidentId}` : "/incidents")}
            onOpenComplaints={() => navigate("/onboard-participant/complaints")}
            onOpenMedication={() => openTab("care_profile")}
            onOpenNotes={() => openTab("compliance")}
          />
          <RecentShiftsSection overview={o} onOpenShift={openShift} onSeeAll={() => navigate("/md/schedule")} />
          <AuditPanel participantId={participantId} onSeeAll={() => setAuditOpen(true)} />
        </div>
      </div>
    </div>
  );

  const documents = (
    <div className="space-y-8">
      <AgreementsSection
        overview={o}
        onOpenAgreement={() => openTab("plan_goals")}
        onOpenIntake={() => setIntakeOpen(true)}
        onManagePortal={() => setPortalOpen(true)}
      />
      <DocumentsSection participantId={participantId} onUpload={() => setUploadOpen(true)} onExport={() => setExportOpen(true)} onArchive={setArchiveDoc} />
    </div>
  );

  const current = TABS.find((t) => t.id === tab) ?? TABS[0];

  return (
    <div className="space-y-5 pb-10">
      {back}
      <ProfileHeader overview={o} actions={actions} />
      <StatusBanner overview={o} onResume={() => setServicesMode("resume")} />

      <nav
        ref={tabsRef}
        aria-label={`Sections of ${p.full_name}'s profile`}
        className="sticky top-0 z-20 -mx-1 scroll-mt-4 overflow-x-auto border-b px-1"
        style={{ borderColor: BORDER, background: "var(--cc-bg)" }}
      >
        <ul className="flex min-w-max gap-1">
          {TABS.map((t) => {
            const active = t.id === tab;
            return (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => setTab(t.id)}
                  aria-current={active ? "page" : undefined}
                  className="relative min-h-11 md:min-h-9 whitespace-nowrap px-3 text-sm font-medium transition-colors hover:text-cc-text focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-cc-plum"
                  style={{ color: active ? TEXT : MUTED }}
                >
                  {t.label}
                  {active && <span aria-hidden className="absolute inset-x-3 -bottom-px h-0.5 rounded-full" style={{ background: "var(--cc-plum)" }} />}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>

      <div
        role="region"
        aria-label={current.label}
        className="min-w-0 rounded-2xl border bg-cc-surface p-4 sm:p-6"
        style={{ borderColor: BORDER }}
      >
        {tab === "summary" ? (
          summary
        ) : tab === "documents" ? (
          documents
        ) : (
          <ParticipantDetail
            key={participantId}
            id={participantId}
            onRefreshList={refresh}
            syncUrl={false}
            bare
            tab={tab}
            onTabChange={(next) => setTab(next === "records" ? "documents" : next)}
          />
        )}
      </div>

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
            <SheetTitle>Participant portal access</SheetTitle>
            <SheetDescription>Who can sign in to see {firstName}'s schedule, plan and documents: the participant, their nominee or family. Only you can give or remove access.</SheetDescription>
          </SheetHeader>
          <div className="mt-4"><PortalAccessCard participantId={participantId} /></div>
        </SheetContent>
      </Sheet>

      <Sheet open={exportOpen} onOpenChange={setExportOpen}>
        <SheetContent className="flex w-full flex-col p-0 sm:max-w-2xl">
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
