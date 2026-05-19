import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
import AcceptInvite from "@/pages/accept-invite";
import { AppLayout } from "@/components/layout/AppLayout";
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
import Settings from "@/pages/settings";

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
const ALL_ROLES = ["admin", "support_worker", "allied_health", "support_coordinator"] as const;

// Admin + coordinator only — compliance dashboards, billing, reports, participant management
const COORDINATOR_ROLES = ["admin", "support_coordinator"] as const;

// Coordinator + allied health — reports contain clinical documentation allied health needs
const COORDINATOR_AND_ALLIED = ["admin", "support_coordinator", "allied_health"] as const;

function Router() {
  return (
    <Switch>
      {/* ── Public routes ─────────────────────────────────────────────────── */}
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/accept-invite" component={AcceptInvite} />
      <Route path="/" component={() => <Redirect to="/dashboard" />} />

      {/* ── Dashboard — all roles ─────────────────────────────────────────── */}
      <Route path="/dashboard">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <AppLayout><Dashboard /></AppLayout>
        </ProtectedRoute>
      </Route>

      {/* ── Participants ──────────────────────────────────────────────────── */}
      {/* List: all roles (backend scopes to allocated for workers) */}
      <Route path="/patients">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
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
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <AppLayout><Sessions /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/sessions/new">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
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

      {/* ── Compliance — coordinator/admin only ──────────────────────────── */}
      <Route path="/compliance">
        <ProtectedRoute allowedRoles={[...COORDINATOR_ROLES]}>
          <AppLayout><Compliance /></AppLayout>
        </ProtectedRoute>
      </Route>

      {/* ── Reports — coordinator/admin + allied health ───────────────────── */}
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
            <Router />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
