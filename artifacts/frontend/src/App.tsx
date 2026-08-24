import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "@/lib/query-client";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import ForgotPassword from "@/pages/forgot-password";
import ResetPassword from "@/pages/reset-password";
import Signup from "@/pages/signup";
import AcceptInvite from "@/pages/accept-invite";
import OnboardingSignPage from "@/pages/onboarding-sign";
import ParticipantReferralPage from "@/pages/participant-referral";
import OnboardingWorkspace from "@/pages/md/onboarding-workspace";
import { AppLayout } from "@/components/layout/AppLayout";
import { HubLayout } from "@/components/layout/HubLayout";
import { useAuth } from "@/contexts/AuthContext";
import { AuthSessionGuards } from "@/components/auth/AuthSessionGuards";
import { WelcomeScreenGate } from "@/components/onboarding/WelcomeScreenGate";
import Dashboard from "@/pages/dashboard";
import Patients from "@/pages/patients";
import ParticipantNew from "@/pages/participant-new";
import ParticipantEdit from "@/pages/participant-edit";
import Sessions from "@/pages/sessions";
import SessionNew from "@/pages/session-new";
import SessionDetail from "@/pages/session-detail";
import Incidents from "@/pages/incidents";
import IncidentNew from "@/pages/incident-new";
import IncidentDetail from "@/pages/incident-detail";
import Compliance from "@/pages/compliance";
import Reports from "@/pages/reports";
import Billing from "@/pages/billing";
import Settings from "@/pages/settings";
import MyClients from "@/pages/my-clients";
import MyClientDetail from "@/pages/my-client-detail";
import MyCompliance from "@/pages/my-compliance";
import WorkerNdisPlan from "@/pages/worker-ndis-plan";
import Team from "@/pages/team";
import CoordinatorRosteringPage from "@/pages/coordinator-rostering";
import CoordinatorLivePage from "@/pages/coordinator-live";
import CoordinatorMonitorPage from "@/pages/coordinator-monitor";
import AuditPack from "@/pages/audit-pack";
import DesignSystem from "@/pages/design-system";
import SessionReview from "@/pages/session-review";
import CoordinatorShiftVerification from "@/pages/coordinator-shift-verification";
import Toolkit from "@/pages/toolkit";
import VerifyEmail from "@/pages/verify-email";
import ProfileCompletion from "@/pages/profile-completion";
import WorkerOnboarding from "@/pages/worker-onboarding";
import CoordinatorOnboarding from "@/pages/coordinator-onboarding";
import HubPage from "@/pages/hub/HubPage";
import MDExecutivePage from "@/pages/md/executive";
import MDSchedulePage from "@/pages/md/schedule";
import MDServiceDeliveryPage from "@/pages/md/service-delivery";
import MDStaffPage from "@/pages/md/staff";
import MDCompliancePage from "@/pages/md/compliance";
import MDFinancialPage from "@/pages/md/financial";
import MDOnboardingPage from "@/pages/md/onboarding";
import MDOnboardingTrainingPage from "@/pages/md/onboarding-training";
import DevProgressTestPage from "@/pages/dev-progress-test";
import SessionLive from "@/pages/session-live";
import MyShifts from "@/pages/my-shifts";
import MyShiftDetail from "@/pages/my-shift-detail";
import MyShiftBriefing from "@/pages/my-shift-briefing";
import MyShiftMessageOffice from "@/pages/my-shift-message-office";
import WorkerScheduleCalendar from "@/pages/worker-schedule-calendar";
import WorkerScheduleRequests from "@/pages/worker-schedule-requests";
import WorkerAvailabilityPage from "@/pages/worker-availability";
import WorkerMessages from "@/pages/worker-messages";
import WorkerNotificationsPage from "@/pages/worker-notifications";
import Tasks from "@/pages/tasks";
import WorkerProfile from "@/pages/worker-profile";
import WorkerSecurity from "@/pages/worker-security";
import WorkerPrivacy from "@/pages/worker-privacy";
import WorkerSyncStatus from "@/pages/worker-sync-status";
import WorkerHelp from "@/pages/worker-help";
import WorkerShiftHistory from "@/pages/worker-shift-history";
import WorkerPerformanceDashboard from "@/pages/worker-performance-dashboard";
import WorkerTraining from "@/pages/worker-training";
import WorkerInduction from "@/pages/worker-induction";
import WorkerFeedback from "@/pages/worker-feedback";
import WorkerTravelExpenses from "@/pages/worker-travel-expenses";
import CoordinatorTravelExpenses from "@/pages/coordinator-travel-expenses";
import WorkerAccessibility from "@/pages/worker-accessibility";
import AccountSecure from "@/pages/account-secure";
import { OfflineSyncProvider } from "@/contexts/OfflineSyncContext";
import { AccessibilityProvider } from "@/contexts/AccessibilityContext";

// All authenticated roles
const ALL_ROLES = ["support_coordinator", "support_worker", "managing_director"] as const;

// Support Coordinator / CareCliQ Parent only — oversight, billing, team, compliance.
const COORDINATOR_ROLES = ["support_coordinator"] as const;
const WORKER_ROLES = ["support_worker"] as const;

// Managing Director only
const MD_ROLES = ["managing_director"] as const;

// Managing directors live in HubLayout everywhere (a distinct shell befitting
// their org-wide privileges); everyone else uses the standard AppLayout
// sidebar. Used for shared pages like Settings that both reach.
function RoleAwareShell({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.role === "managing_director") {
    return <HubLayout>{children}</HubLayout>;
  }
  return <AppLayout>{children}</AppLayout>;
}

function Router() {
  return (
    <Switch>
      {/* ── Public routes ─────────────────────────────────────────────────── */}
      <Route path="/login" component={Login} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/signup" component={Signup} />
      <Route path="/accept-invite" component={AcceptInvite} />
      <Route path="/onboarding-sign" component={OnboardingSignPage} />
      <Route path="/participant-referral" component={ParticipantReferralPage} />
      <Route path="/account/secure" component={AccountSecure} />
      <Route path="/" component={() => <Redirect to="/dashboard" />} />

      <Route path="/design-system">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <RoleAwareShell><DesignSystem /></RoleAwareShell>
        </ProtectedRoute>
      </Route>

      <Route path="/verify-email">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <RoleAwareShell><VerifyEmail /></RoleAwareShell>
        </ProtectedRoute>
      </Route>

      <Route path="/profile-completion">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <RoleAwareShell><ProfileCompletion /></RoleAwareShell>
        </ProtectedRoute>
      </Route>

      <Route path="/worker-onboarding">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><WorkerOnboarding /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/getting-started">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <CoordinatorOnboarding />
        </ProtectedRoute>
      </Route>

      {/* ── Hub — org intelligence layer, all roles ───────────────────────── */}
      <Route path="/hub">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <HubLayout><HubPage /></HubLayout>
        </ProtectedRoute>
      </Route>

      {/* ── Managing Director Workspaces ──────────────────────────────────── */}
      <Route path="/md/executive">
        <ProtectedRoute allowedRoles={[...MD_ROLES]}>
          <MDExecutivePage />
        </ProtectedRoute>
      </Route>

      <Route path="/md/schedule">
        <ProtectedRoute allowedRoles={[...MD_ROLES]}>
          <MDSchedulePage />
        </ProtectedRoute>
      </Route>

      <Route path="/md/service-delivery">
        <ProtectedRoute allowedRoles={[...MD_ROLES]}>
          <MDServiceDeliveryPage />
        </ProtectedRoute>
      </Route>

      <Route path="/md/staff">
        <ProtectedRoute allowedRoles={[...MD_ROLES]}>
          <MDStaffPage />
        </ProtectedRoute>
      </Route>

      <Route path="/md/compliance">
        <ProtectedRoute allowedRoles={[...MD_ROLES]}>
          <MDCompliancePage />
        </ProtectedRoute>
      </Route>

      <Route path="/md/financial">
        <ProtectedRoute allowedRoles={[...MD_ROLES]}>
          <MDFinancialPage />
        </ProtectedRoute>
      </Route>

      <Route path="/md/onboarding">
        <ProtectedRoute allowedRoles={[...MD_ROLES]}>
          <MDOnboardingPage />
        </ProtectedRoute>
      </Route>

      <Route path="/md/onboarding/training">
        <ProtectedRoute allowedRoles={[...MD_ROLES]}>
          <MDOnboardingTrainingPage />
        </ProtectedRoute>
      </Route>

      {/* ── Staff / Participant Onboarding — both routes render the same
             OnboardingWorkspace shell so HubLayout mounts once and the
             Staff/Participants toggle switches without remounting the
             sidebar. Coordinators and MD both get staff read access;
             participant onboarding is MD-only. ─────────────────────────── */}
      <Route path="/md/staff-onboarding">
        <ProtectedRoute allowedRoles={["support_coordinator", "managing_director"]}>
          <OnboardingWorkspace />
        </ProtectedRoute>
      </Route>

      <Route path="/onboard-participant">
        <ProtectedRoute allowedRoles={[...MD_ROLES]}>
          <OnboardingWorkspace />
        </ProtectedRoute>
      </Route>

      <Route path="/onboard-participant/active">
        <ProtectedRoute allowedRoles={[...MD_ROLES]}>
          <OnboardingWorkspace />
        </ProtectedRoute>
      </Route>

      {/* ── Dashboard — all roles ─────────────────────────────────────────── */}
      <Route path="/dashboard">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <RoleAwareShell><Dashboard /></RoleAwareShell>
        </ProtectedRoute>
      </Route>

      {/* ── Participants ──────────────────────────────────────────────────── */}
      {/* List: all roles (backend scopes to allocated for workers) */}
      <Route path="/my-clients">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><MyClients /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/my-clients/:id">
        {(params) => (
          <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
            <AppLayout><MyClientDetail id={params.id} /></AppLayout>
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/my-compliance">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><MyCompliance /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/worker/shift-history">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><WorkerShiftHistory /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/worker/travel">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><WorkerTravelExpenses /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/worker/accessibility">
        <Redirect to="/accessibility" />
      </Route>

      <Route path="/accessibility">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <RoleAwareShell><WorkerAccessibility /></RoleAwareShell>
        </ProtectedRoute>
      </Route>

      <Route path="/worker/performance">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><WorkerPerformanceDashboard /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/worker/training">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><WorkerTraining /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/worker-induction">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><WorkerInduction /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/worker/feedback/:id">
        {(params) => (
          <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
            <AppLayout><WorkerFeedback /></AppLayout>
          </ProtectedRoute>
        )}
      </Route>

      {/* <Route path="/calendar">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><WorkerScheduleCalendar /></AppLayout>
        </ProtectedRoute>
      </Route> */}

      <Route path="/my-shifts/requests">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><WorkerScheduleRequests /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/my-shifts/:id/briefing">
        {(params) => (
          <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
            <AppLayout><MyShiftBriefing /></AppLayout>
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/my-shifts/:id/message-office">
        {(params) => (
          <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
            <AppLayout><MyShiftMessageOffice /></AppLayout>
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/my-shifts/:id">
        {(params) => (
          <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
            <AppLayout><MyShiftDetail id={params.id} /></AppLayout>
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/my-shifts">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><MyShifts /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/tasks">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><Tasks /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/worker/messages">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><WorkerMessages /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/worker/availability">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><WorkerAvailabilityPage /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/worker/help">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><WorkerHelp /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/worker/sync-status">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><WorkerSyncStatus /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/worker/notifications">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><WorkerNotificationsPage /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/worker-ndis-plan">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><WorkerNdisPlan /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/toolkit">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <RoleAwareShell><Toolkit /></RoleAwareShell>
        </ProtectedRoute>
      </Route>

      <Route path="/team">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><Team /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/coordinator/rostering">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><CoordinatorRosteringPage /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/coordinator/live">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><CoordinatorLivePage /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/coordinator/monitor">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><CoordinatorMonitorPage /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/coordinator/travel">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><CoordinatorTravelExpenses /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/audit-pack">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><AuditPack /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/session-review">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><SessionReview /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/coordinator/shift-verification">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><CoordinatorShiftVerification /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/patients">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES, ...MD_ROLES]}>
          <RoleAwareShell><Patients /></RoleAwareShell>
        </ProtectedRoute>
      </Route>

      {/* Create/Edit: coordinator only — workers cannot add or edit participants */}
      <Route path="/participants/new">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><ParticipantNew /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/participants/:id/edit">
        {(params) => (
          <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
            <AppLayout><ParticipantEdit id={params.id} /></AppLayout>
          </ProtectedRoute>
        )}
      </Route>

      {/* ── Sessions ─────────────────────────────────────────────────────── */}
      {/* All roles — backend scopes to allocated for workers */}
      <Route path="/sessions">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><Sessions /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/sessions/new">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><SessionNew /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/sessions/:id/live">
        {(params) => (
          <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
            <SessionLive />
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/sessions/:id">
        {(params) => (
          <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
            <RoleAwareShell><SessionDetail id={params.id} /></RoleAwareShell>
          </ProtectedRoute>
        )}
      </Route>

      {/* ── Incidents ────────────────────────────────────────────────────── */}
      {/* All roles — backend scopes to own incidents for workers */}
      <Route path="/incidents">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <RoleAwareShell><Incidents /></RoleAwareShell>
        </ProtectedRoute>
      </Route>

      <Route path="/incidents/new">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <RoleAwareShell><IncidentNew /></RoleAwareShell>
        </ProtectedRoute>
      </Route>

      {/* Legacy nav links still point here — keep redirect so workers don't hit a blank 404 */}
      <Route path="/incident-new">
        <Redirect to="/incidents/new" />
      </Route>

      <Route path="/incidents/:id">
        {(params) => (
          <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
            <RoleAwareShell><IncidentDetail id={params.id} /></RoleAwareShell>
          </ProtectedRoute>
        )}
      </Route>

      {/* ── Compliance — support coordinator only ────────────────────────── */}
      <Route path="/compliance">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><Compliance /></AppLayout>
        </ProtectedRoute>
      </Route>

      {/* ── Reports — support coordinator + allied health ────────────────── */}
      <Route path="/reports">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><Reports /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/documents">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><Reports /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/billing">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><Billing /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/worker/profile">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <RoleAwareShell><WorkerProfile /></RoleAwareShell>
        </ProtectedRoute>
      </Route>

      <Route path="/worker/security">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <RoleAwareShell><WorkerSecurity /></RoleAwareShell>
        </ProtectedRoute>
      </Route>

      <Route path="/worker/privacy">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><WorkerPrivacy /></AppLayout>
        </ProtectedRoute>
      </Route>

      {/* ── Settings — all roles (workers can manage their own settings) ─── */}
      <Route path="/settings">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <RoleAwareShell><Settings /></RoleAwareShell>
        </ProtectedRoute>
      </Route>

      <Route path="/dev/progress-test">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <DevProgressTestPage />
        </ProtectedRoute>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <AccessibilityProvider>
            <OfflineSyncProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                <AuthSessionGuards />
                <WelcomeScreenGate />
                <Router />
              </WouterRouter>
            </OfflineSyncProvider>
            <Toaster />
          </AccessibilityProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
