import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import NotFound from "@/pages/not-found";
import Login from "@/pages/login";
import Signup from "@/pages/signup";
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

const ALL_ROLES = ["admin", "support_worker", "allied_health"] as const;

function Router() {
  return (
    <Switch>
      {/* Public */}
      <Route path="/login" component={Login} />
      <Route path="/signup" component={Signup} />
      <Route path="/" component={() => <Redirect to="/dashboard" />} />

      {/* Protected */}
      <Route path="/dashboard">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <AppLayout><Dashboard /></AppLayout>
        </ProtectedRoute>
      </Route>

      {/* Participants — /new must come before /:id */}
      <Route path="/patients">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <AppLayout><Patients /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/participants/new">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <AppLayout><ParticipantNew /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/participants/:id/edit">
        {(params) => (
          <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
            <AppLayout><ParticipantEdit id={params.id} /></AppLayout>
          </ProtectedRoute>
        )}
      </Route>

      {/* Sessions */}
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

      {/* Incidents — /new must come before /:id */}
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

      {/* Compliance */}
      <Route path="/compliance">
        <ProtectedRoute allowedRoles={[...ALL_ROLES]}>
          <AppLayout><Compliance /></AppLayout>
        </ProtectedRoute>
      </Route>

      <Route path="/settings">
        <ProtectedRoute allowedRoles={["admin", "support_worker"]}>
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
