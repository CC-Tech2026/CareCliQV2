import { Switch, Route, Router as WouterRouter, Redirect } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/AppLayout";
import Dashboard from "@/pages/dashboard";
import Patients from "@/pages/patients";
import Sessions from "@/pages/sessions";
import SessionNew from "@/pages/session-new";
import SessionDetail from "@/pages/session-detail";
import SessionLive from "@/pages/session-live";
import Compliance from "@/pages/compliance";
import Settings from "@/pages/settings";

const queryClient = new QueryClient();

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => <Redirect to="/dashboard" />} />
      <Route path="/dashboard">
        <AppLayout>
          <Dashboard />
        </AppLayout>
      </Route>
      <Route path="/patients">
        <AppLayout>
          <Patients />
        </AppLayout>
      </Route>
      <Route path="/sessions">
        <AppLayout>
          <Sessions />
        </AppLayout>
      </Route>
      <Route path="/sessions/new">
        <AppLayout>
          <SessionNew />
        </AppLayout>
      </Route>
      <Route path="/sessions/:id/live">
        {params => <SessionLive />}
      </Route>
      <Route path="/sessions/:id">
        {params => (
          <AppLayout>
            <SessionDetail id={params.id} />
          </AppLayout>
        )}
      </Route>
      <Route path="/compliance">
        <AppLayout>
          <Compliance />
        </AppLayout>
      </Route>
      <Route path="/settings">
        <AppLayout>
          <Settings />
        </AppLayout>
      </Route>
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
