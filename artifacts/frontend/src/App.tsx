import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { AuthSessionGuards } from "@/components/auth/AuthSessionGuards";
import Dashboard from "@/pages/dashboard";
import Patients from "@/pages/patients";
import ParticipantNew from "@/pages/participant-new";
import ParticipantEdit from "@/pages/participant-edit";
import Sessions from "@/pages/sessions";
import SessionNew from "@/pages/session-new";
import SessionDetail from "@/pages/session-detail";
import SessionLive from "@/pages/session-live";
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
import AuditPack from "@/pages/audit-pack";
import Credentials from "@/pages/credentials";
import Toolkit from "@/pages/toolkit";
import VerifyEmail from "@/pages/verify-email";
import ProfileCompletion from "@/pages/profile-completion";
import WorkerOnboarding from "@/pages/worker-onboarding";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error: unknown) => {
        if (error && typeof error === "object" && "status" in error) {
          const s = (error as { status: number }).status;
          if (s === 401 || s === 403) return false;
        }
        return failureCount < 2;
      },
    },
  },
});

// All authenticated roles
const ALL_ROLES = ["support_coordinator", "support_worker", "allied_health"] as const;

// Support Coordinator / CareScribe Parent only — oversight, billing, team, compliance.
const COORDINATOR_ROLES = ["support_coordinator"] as const;

// Coordinator + allied health — reports contain clinical documentation allied health needs.
const COORDINATOR_AND_ALLIED = ["support_coordinator", "allied_health"] as const;
const WORKER_ROLES = ["support_worker"] as const;

function Router() {
  return (
    <Switch>
      {/* ── Public routes ─────────────────────────────────────────────────── */}
      <Route path="/login" component={Login} />
      <Route path="/forgot-password" component={ForgotPassword} />
      <Route path="/reset-password" component={ResetPassword} />
      <Route path="/signup" component={Signup} />
      <Route path="/accept-invite" component={AcceptInvite} />
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

      <Route path="/audit-pack">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><AuditPack /></AppLayout>
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
        {() => (
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
        <ProtectedRoute allowedRoles={[...COORDINATOR_AND_ALLIED]}>
          <AppLayout><Incidents /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/incidents/new">
        <ProtectedRoute allowedRoles={[...COORDINATOR_AND_ALLIED]}>
          <AppLayout><IncidentNew /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/incidents/:id">
        {(params) => (
          <ProtectedRoute allowedRoles={[...COORDINATOR_AND_ALLIED]}>
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

      {/* ── Settings — all roles (workers can manage their own settings) ─── */}
      <Route path="/settings">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <AppLayout><Settings /></AppLayout>
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
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <AuthSessionGuards />
            <Router />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
