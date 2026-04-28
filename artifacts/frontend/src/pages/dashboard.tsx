import { useGetDashboardStats, useGetRecentSessions, useGetUnreadAlerts, useMarkAllAlertsRead, useMarkAlertRead } from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, CalendarDays, FileWarning, ShieldAlert, CheckCircle2, AlertTriangle, Info, Clock, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: recentSessions, isLoading: sessionsLoading } = useGetRecentSessions({ limit: 5 });
  const { data: unreadAlerts, isLoading: alertsLoading } = useGetUnreadAlerts();
  
  const markAllRead = useMarkAllAlertsRead();
  const markRead = useMarkAlertRead();

  const handleMarkAllRead = () => {
    markAllRead.mutate(undefined);
  };

  const handleMarkRead = (id: string) => {
    markRead.mutate({ alertId: id });
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-slate-500 dark:text-slate-400">Welcome back. Here's what's happening with your participants today.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/sessions/new">
            <Button data-testid="button-new-session">New Session</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Active Participants</CardTitle>
            <Users className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className="text-2xl font-bold">{stats?.active_participants || 0}</div>
                <p className="text-xs text-slate-500 mt-1">Out of {stats?.total_participants || 0} total</p>
              </>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Sessions This Week</CardTitle>
            <CalendarDays className="h-4 w-4 text-slate-500" />
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold">{stats?.sessions_this_week || 0}</div>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Missing Notes</CardTitle>
            <FileWarning className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className="text-2xl font-bold">{stats?.notes_missing || 0}</div>
                {stats?.notes_missing ? (
                  <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Needs attention
                  </p>
                ) : (
                  <p className="text-xs text-emerald-600 mt-1 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> All caught up
                  </p>
                )}
              </>
            )}
          </CardContent>
        </Card>
        
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium">Compliance Alerts</CardTitle>
            <ShieldAlert className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold">{stats?.compliance_alerts || 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card className="col-span-1">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Sessions</CardTitle>
              <CardDescription>Your latest participant interactions</CardDescription>
            </div>
            <Link href="/sessions">
              <Button variant="ghost" size="sm" className="text-slate-500">View all</Button>
            </Link>
          </CardHeader>
          <CardContent>
            {sessionsLoading ? (
              <div className="space-y-4">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex justify-between items-center">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-32" />
                      <Skeleton className="h-3 w-24" />
                    </div>
                    <Skeleton className="h-6 w-16" />
                  </div>
                ))}
              </div>
            ) : recentSessions?.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <CalendarDays className="h-8 w-8 mx-auto mb-3 opacity-20" />
                <p>No recent sessions found</p>
                <Link href="/sessions/new">
                  <Button variant="link" className="mt-2">Record a session</Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {recentSessions?.map((session) => (
                  <Link key={session.id} href={`/sessions/${session.id}`}>
                    <div className="flex items-center justify-between p-3 -mx-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors cursor-pointer group">
                      <div className="flex flex-col gap-1">
                        <span className="font-medium text-sm group-hover:text-primary transition-colors">
                          {session.participants?.full_name || "Unknown Participant"}
                        </span>
                        <span className="text-xs text-slate-500 flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(parseISO(session.session_date), 'MMM d, h:mm a')} • {session.duration_minutes} min
                        </span>
                      </div>
                      <div className="flex items-center gap-3">
                        {session.status === 'draft' ? (
                          <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">Draft</Badge>
                        ) : session.compliance_score ? (
                          <Badge variant="outline" className={
                            session.compliance_score >= 80 ? "bg-emerald-50 text-emerald-700 border-emerald-200" :
                            session.compliance_score >= 60 ? "bg-amber-50 text-amber-700 border-amber-200" :
                            "bg-destructive/10 text-destructive border-destructive/20"
                          }>
                            {session.compliance_score}% Score
                          </Badge>
                        ) : (
                          <Badge variant="secondary">Completed</Badge>
                        )}
                        <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-primary transition-colors" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-1">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Action Required</CardTitle>
              <CardDescription>Alerts and compliance notices</CardDescription>
            </div>
            {unreadAlerts && unreadAlerts.length > 0 && (
              <Button variant="ghost" size="sm" onClick={handleMarkAllRead} className="text-slate-500" disabled={markAllRead.isPending}>
                Mark all read
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {alertsLoading ? (
              <div className="space-y-4">
                {[1, 2].map((i) => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="h-8 w-8 rounded-full" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-3 w-3/4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : unreadAlerts?.length === 0 ? (
              <div className="text-center py-8 text-slate-500">
                <CheckCircle2 className="h-8 w-8 mx-auto mb-3 opacity-20 text-emerald-500" />
                <p>You're all caught up!</p>
                <p className="text-xs mt-1">No pending alerts</p>
              </div>
            ) : (
              <div className="space-y-4">
                {unreadAlerts?.map((alert) => (
                  <div key={alert.id} className="flex gap-3 p-3 -mx-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors group">
                    <div className="mt-0.5">
                      {alert.severity === 'high' ? (
                        <AlertTriangle className="h-5 w-5 text-destructive" />
                      ) : alert.severity === 'medium' ? (
                        <FileWarning className="h-5 w-5 text-amber-500" />
                      ) : (
                        <Info className="h-5 w-5 text-blue-500" />
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex justify-between items-start gap-2">
                        <span className="font-medium text-sm text-slate-900 dark:text-slate-100">{alert.title}</span>
                        <span className="text-xs text-slate-400 whitespace-nowrap">
                          {alert.created_at ? format(parseISO(alert.created_at), 'MMM d') : ''}
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-1">{alert.message}</p>
                      {alert.participant_id && (
                        <div className="mt-2 flex justify-between items-center">
                          <span className="text-xs font-medium text-primary">
                            {alert.participants?.full_name}
                          </span>
                          <Button 
                            variant="ghost" 
                            size="sm" 
                            className="h-6 text-xs px-2 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => handleMarkRead(alert.id)}
                            disabled={markRead.isPending}
                          >
                            Dismiss
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
