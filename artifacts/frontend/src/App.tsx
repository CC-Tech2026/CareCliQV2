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
import { AppLayout } from "@/components/layout/AppLayout";
import { HubLayout } from "@/components/layout/HubLayout";
import { AuthSessionGuards } from "@/components/auth/AuthSessionGuards";
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
import CoordinatorGoals from "@/pages/coordinator-goals";
import CoordinatorLivePage from "@/pages/coordinator-live";
import AuditPack from "@/pages/audit-pack";
import SessionReview from "@/pages/session-review";
import Credentials from "@/pages/credentials";
import Toolkit from "@/pages/toolkit";
import VerifyEmail from "@/pages/verify-email";
import ProfileCompletion from "@/pages/profile-completion";
import WorkerOnboarding from "@/pages/worker-onboarding";
import CoordinatorOnboarding from "@/pages/coordinator-onboarding";
import HubPage from "@/pages/hub/HubPage";
import MDExecutivePage from "@/pages/md/executive";
import MDStaffPage from "@/pages/md/staff";
import MDCompliancePage from "@/pages/md/compliance";
import MDFinancialPage from "@/pages/md/financial";
import MDOnboardingPage from "@/pages/md/onboarding";
import DevProgressTestPage from "@/pages/dev-progress-test";
import SessionLive from "@/pages/session-live";
import MyShifts from "@/pages/my-shifts";
import MyShiftDetail from "@/pages/my-shift-detail";
import MyShiftBriefing from "@/pages/my-shift-briefing";
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
import WorkerFeedback from "@/pages/worker-feedback";
import WorkerTravelExpenses from "@/pages/worker-travel-expenses";
import CoordinatorTravelExpenses from "@/pages/coordinator-travel-expenses";
import WorkerAccessibility from "@/pages/worker-accessibility";
import AccountSecure from "@/pages/account-secure";
import { OfflineSyncProvider } from "@/contexts/OfflineSyncContext";
import { WorkerTutorialProvider } from "@/contexts/WorkerTutorialContext";
import { WorkerTutorialLauncher } from "@/components/help/WorkerTutorialLauncher";
import { AccessibilityProvider } from "@/contexts/AccessibilityContext";

// All authenticated roles
const ALL_ROLES = ["support_coordinator", "support_worker", "allied_health", "managing_director"] as const;

// Support Coordinator / CareCliQ Parent only — oversight, billing, team, compliance.
const COORDINATOR_ROLES = ["support_coordinator"] as const;

// Coordinator + allied health — reports contain clinical documentation allied health needs.
const COORDINATOR_AND_ALLIED = ["support_coordinator", "allied_health"] as const;
const WORKER_ROLES = ["support_worker"] as const;

// Managing Director only
const MD_ROLES = ["managing_director"] as const;

function Router() {
  return (
    <Switch>
      {/* ── Public routes ─────────────────────────────────────────────────── */}
      <Route path="/login" component={Login} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/signup" component={Signup} />
      <Route path="/accept-invite" component={AcceptInvite} />
      <Route path="/account/secure" component={AccountSecure} />
      <Route path="/" component={() => <Redirect to="/dashboard" />} />

      <Route path="/verify-email">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <AppLayout><VerifyEmail /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/profile-completion">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <AppLayout><ProfileCompletion /></AppLayout>
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

      {/* ── Dashboard — all roles ─────────────────────────────────────────── */}
      <Route path="/dashboard">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <AppLayout><Dashboard /></AppLayout>
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
          <AppLayout><WorkerAccessibility /></AppLayout>
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

      <Route path="/worker/feedback/:id">
        {(params) => (
          <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
            <AppLayout><WorkerFeedback /></AppLayout>
          </ProtectedRoute>
        )}
      </Route>

      <Route path="/calendar">
        <ProtectedRoute allowedRoles={[...WORKER_ROLES]}>
          <AppLayout><WorkerScheduleCalendar /></AppLayout>
        </ProtectedRoute>
      </Route>

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

      <Route path="/credentials">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <AppLayout><Credentials /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/toolkit">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <AppLayout><Toolkit /></AppLayout>
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

      <Route path="/coordinator/travel">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><CoordinatorTravelExpenses /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/coordinator-goals">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><CoordinatorGoals /></AppLayout>
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

      <Route path="/patients">
        <ProtectedRoute allowedRoles={[...COORDINATOR_AND_ALLIED]}>
          <AppLayout><Patients /></AppLayout>
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
        <ProtectedRoute allowedRoles={[...COORDINATOR_AND_ALLIED]}>
          <AppLayout><Sessions /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/sessions/new">
        <ProtectedRoute allowedRoles={[...COORDINATOR_AND_ALLIED]}>
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
            <AppLayout><SessionDetail id={params.id} /></AppLayout>
          </ProtectedRoute>
        )}
      </Route>

      {/* ── Incidents ────────────────────────────────────────────────────── */}
      {/* All roles — backend scopes to own incidents for workers */}
      <Route path="/incidents">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <AppLayout><Incidents /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/incidents/new">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <AppLayout><IncidentNew /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/incidents/:id">
        {(params) => (
          <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
            <AppLayout><IncidentDetail id={params.id} /></AppLayout>
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
        <ProtectedRoute allowedRoles={[...COORDINATOR_AND_ALLIED]}>
          <AppLayout><Reports /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/documents">
        <ProtectedRoute allowedRoles={[...COORDINATOR_AND_ALLIED]}>
          <AppLayout><Reports /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/billing">
        <ProtectedRoute allowedRoles={[...COORDINATOR_AND_ALLIED]}>
          <AppLayout><Billing /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/worker/profile">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <AppLayout><WorkerProfile /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/worker/security">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <AppLayout><WorkerSecurity /></AppLayout>
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
          <AppLayout><Settings /></AppLayout>
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
              <WorkerTutorialProvider>
                <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                  <WorkerTutorialLauncher />
                  <AuthSessionGuards />
                  <Router />
                </WouterRouter>
              </WorkerTutorialProvider>
            </OfflineSyncProvider>
            <Toaster />
          </AccessibilityProvider>
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
