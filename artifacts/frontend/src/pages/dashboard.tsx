import {
  useGetDashboardStats,
  useGetRecentSessions,
  useGetUnreadAlerts,
  useMarkAllAlertsRead,
  useMarkAlertRead,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Users,
  CalendarDays,
  FileWarning,
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  Info,
  Clock,
  ChevronRight,
  PlusCircle,
  FileText,
  Receipt,
  Upload,
  MapPin,
  Eye,
  FileSignature,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: recentSessions, isLoading: sessionsLoading } =
    useGetRecentSessions({ limit: 5 });
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
    <div className="space-y-6 max-w-7xl mx-auto p-2 sm:p-0">
      {/* Greeting and Top Quick Actions */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-white dark:bg-slate-950 p-5 md:p-6 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Good morning, Emma!
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Here's what's happening today.
          </p>
        </div>

        {/* Action Ribbon — 2-col grid on mobile, row on larger */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full xl:w-auto">
          <Link href="/sessions/new" className="col-span-2 sm:col-span-1">
            <Button className="bg-violet-600 hover:bg-violet-700 text-white gap-2 shadow-sm w-full sm:w-auto">
              <PlusCircle className="h-4 w-4" /> Start New Session
            </Button>
          </Link>
          <Button
            variant="outline"
            className="gap-2 border-slate-200 hover:bg-slate-50 text-slate-700 text-sm"
          >
            <FileText className="h-4 w-4 text-slate-500" /> Add Case Note
          </Button>
          <Button
            variant="outline"
            className="gap-2 border-slate-200 hover:bg-slate-50 text-slate-700 text-sm"
          >
            <Receipt className="h-4 w-4 text-slate-500" /> Create Invoice
          </Button>
          <Button
            variant="outline"
            className="gap-2 border-slate-200 hover:bg-slate-50 text-slate-700 text-sm"
          >
            <Upload className="h-4 w-4 text-slate-500" /> Upload Evidence
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border border-slate-100/80 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Active Participants
            </CardTitle>
            <Users className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold text-slate-900">
                  {stats?.active_participants || 0}
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Out of {stats?.total_participants || 0} total
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border border-slate-100/80 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Sessions This Week
            </CardTitle>
            <CalendarDays className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold text-slate-900">
                {stats?.sessions_this_week || 0}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border border-slate-100/80 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Missing Notes
            </CardTitle>
            <FileWarning className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <>
                <div className="text-2xl font-bold text-slate-900">
                  {stats?.notes_missing || 0}
                </div>
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

        <Card className="border border-slate-100/80 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-500">
              Compliance Alerts
            </CardTitle>
            <ShieldAlert className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold text-slate-900">
                {stats?.compliance_alerts || 0}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main UI Grids */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left Hand Container - Sessions and Focus */}
        <div className="lg:col-span-2 space-y-6">
          {/* Today's Sessions */}
          <Card className="border border-slate-100/80 shadow-sm bg-white">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="text-lg text-slate-900">
                  Today's Sessions
                </CardTitle>
                <CardDescription>
                  Keep track of today's schedule
                </CardDescription>
              </div>
              <Link href="/calendar">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-slate-500 hover:text-primary"
                >
                  View calendar
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              {sessionsLoading ? (
                <div className="space-y-4">
                  {[1, 2].map((i) => (
                    <Skeleton key={i} className="h-16 w-full" />
                  ))}
                </div>
              ) : recentSessions?.length === 0 ? (
                <div className="text-center py-12 text-slate-400">
                  <CalendarDays className="h-8 w-8 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No sessions scheduled for today</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {/* Mocked today's sessions layout to reflect your reference image */}
                  {[
                    {
                      id: "1",
                      time: "10:00 AM - 12:00 PM",
                      name: "John Smith",
                      ndis: "12345678",
                      location: "123 High St, Brisbane",
                      duration: "2h 00m",
                      status: "In Progress",
                      initials: "JS",
                    },
                    {
                      id: "2",
                      time: "1:00 PM - 2:30 PM",
                      name: "Sarah Lee",
                      ndis: "87654321",
                      location: "At Home",
                      duration: "1h 30m",
                      status: "Upcoming",
                      initials: "SL",
                    },
                    {
                      id: "3",
                      time: "3:30 PM - 4:30 PM",
                      name: "Michael Brown",
                      ndis: "11223344",
                      location: "Online (Telehealth)",
                      duration: "1h 00m",
                      status: "Upcoming",
                      initials: "MB",
                    },
                  ].map((s) => (
                    <div
                      key={s.id}
                      className="flex flex-wrap md:flex-row items-center justify-between py-4 first:pt-0 last:pb-0 group"
                    >
                      <div className="flex items-center gap-4 mb-3 md:mb-0">
                        <div className="h-10 w-10 bg-slate-100 rounded-full flex items-center justify-center text-sm font-semibold text-slate-600">
                          {s.initials}
                        </div>
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {s.name}
                          </p>
                          <p className="text-xs text-slate-400 mt-0.5">
                            NDIS: {s.ndis}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-4 items-center text-slate-500 text-xs mb-3 md:mb-0">
                        <div>
                          <p className="text-slate-400">Time</p>
                          <p className="font-medium text-slate-700 mt-0.5">
                            {s.time}
                          </p>
                        </div>
                        <div className="w-[1px] h-8 bg-slate-100 hidden sm:block" />
                        <div>
                          <p className="text-slate-400">Location</p>
                          <p className="font-medium text-slate-700 mt-0.5 flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-slate-400" />{" "}
                            {s.location}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-start">
                        <Badge
                          variant="outline"
                          className={
                            s.status === "In Progress"
                              ? "bg-violet-50 text-violet-700 border-violet-100"
                              : "bg-slate-50 text-slate-600 border-slate-200"
                          }
                        >
                          {s.status}
                        </Badge>
                        <Button
                          size="sm"
                          variant={
                            s.status === "In Progress" ? "default" : "outline"
                          }
                          className="h-8"
                        >
                          {s.status === "In Progress"
                            ? "Continue Session"
                            : "View Session"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Participant Focus */}
          <Card className="border border-slate-100/80 shadow-sm bg-white">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="text-lg text-slate-900">
                  Participant Focus
                </CardTitle>
                <CardDescription>
                  Keep participants at the center of every session
                </CardDescription>
              </div>
              <Link href="/participants/plan">
                <Button
                  variant="link"
                  className="text-xs text-indigo-600 h-auto p-0"
                >
                  View John's Plan &rarr;
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="grid md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 bg-indigo-50 text-indigo-700 rounded-full flex items-center justify-center font-bold">
                    JS
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      John Smith
                    </p>
                    <p className="text-xs text-slate-400">NDIS: 12345678</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between text-xs font-medium text-slate-600 mb-1">
                      <span>Increase independence</span>
                      <span>75%</span>
                    </div>
                    <Progress value={75} className="h-2 bg-slate-100" />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs font-medium text-slate-600 mb-1">
                      <span>Build confidence</span>
                      <span>50%</span>
                    </div>
                    <Progress value={50} className="h-2 bg-slate-100" />
                  </div>
                  <div>
                    <div className="flex justify-between text-xs font-medium text-slate-600 mb-1">
                      <span>Improve daily living skills</span>
                      <span>30%</span>
                    </div>
                    <Progress value={30} className="h-2 bg-slate-100" />
                  </div>
                </div>
              </div>

              <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 flex flex-col justify-between">
                <div>
                  <span className="text-2xs font-semibold text-slate-400 uppercase tracking-wider">
                    Recent Note
                  </span>
                  <p className="text-xs text-slate-600 mt-2 leading-relaxed italic font-light">
                    "John showed great progress today with budgeting and
                    decision making at the supermarket."
                  </p>
                </div>
                <div className="flex items-center justify-between text-2xs text-slate-400 mt-4 pt-3 border-t border-slate-100">
                  <span>12 Apr 2024</span>
                  <span className="font-medium">Emma Taylor</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Sidebar Hand Container - Compliance and Actions */}
        <div className="space-y-6">
          {/* Compliance Overview */}
          <Card className="border border-slate-100/80 shadow-sm bg-white">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="text-lg text-slate-900">
                  Compliance Overview
                </CardTitle>
              </div>
              <Badge variant="secondary" className="bg-slate-50 text-slate-500">
                This week
              </Badge>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-4">
                <div className="relative flex items-center justify-center h-36 w-36">
                  {/* Gauge Ring */}
                  <svg className="absolute h-full w-full -rotate-90">
                    <circle
                      cx="72"
                      cy="72"
                      r="60"
                      stroke="#E2E8F0"
                      strokeWidth="10"
                      fill="transparent"
                    />
                    <circle
                      cx="72"
                      cy="72"
                      r="60"
                      stroke="#10B981"
                      strokeWidth="10"
                      fill="transparent"
                      strokeDasharray={`${2 * Math.PI * 60}`}
                      strokeDashoffset={`${2 * Math.PI * 60 * (1 - 0.92)}`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="text-center">
                    <span className="text-4xl font-extrabold text-slate-900">
                      92%
                    </span>
                    <p className="text-xs text-emerald-600 font-semibold mt-1">
                      Compliant
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-6 w-full mt-6 border-t border-slate-100 pt-5 text-center">
                  <div>
                    <span className="block text-xl font-bold text-slate-900">
                      18
                    </span>
                    <span className="text-2xs text-slate-400 flex items-center justify-center gap-1 mt-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" />{" "}
                      Compliant
                    </span>
                  </div>
                  <div>
                    <span className="block text-xl font-bold text-amber-500">
                      2
                    </span>
                    <span className="text-2xs text-slate-400 flex items-center justify-center gap-1 mt-1">
                      <span className="h-2 w-2 rounded-full bg-amber-500" />{" "}
                      Needs Attention
                    </span>
                  </div>
                  <div>
                    <span className="block text-xl font-bold text-rose-500">
                      0
                    </span>
                    <span className="text-2xs text-slate-400 flex items-center justify-center gap-1 mt-1">
                      <span className="h-2 w-2 rounded-full bg-rose-500" /> At
                      Risk
                    </span>
                  </div>
                </div>

                <div className="mt-8 w-full border-t border-slate-100 pt-4 flex flex-col gap-3">
                  <div className="flex items-start gap-3 bg-emerald-50/30 p-3 rounded-lg border border-emerald-100/30 text-emerald-800 text-xs leading-relaxed">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                    <div>
                      <p className="font-semibold text-emerald-900">
                        Great work!
                      </p>
                      <p className="text-emerald-700/80 mt-0.5">
                        Your documentation is 92% compliant this week.
                      </p>
                    </div>
                  </div>
                  <Link
                    href="/compliance"
                    className="text-xs text-center font-medium text-indigo-600 hover:text-indigo-700"
                  >
                    View compliance dashboard &rarr;
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Action Required */}
          <Card className="border border-slate-100/80 shadow-sm bg-white">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="text-lg text-slate-900">
                  Quick Actions
                </CardTitle>
                <CardDescription>
                  Records that need your attention
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="space-y-1 p-0 pb-4">
              {[
                {
                  label: "Upload Document / Evidence",
                  description: "Add photos, files or signed documents",
                },
                {
                  label: "Generate Audit Pack",
                  description: "Export all records for a participant",
                },
                {
                  label: "Check Incomplete Records",
                  description: "See records that need your attention",
                },
                {
                  label: "Provider Payment Assurance",
                  description: "Stay compliant and get paid on time",
                },
              ].map((action, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-4 hover:bg-slate-50/80 transition-colors duration-150 cursor-pointer border-b last:border-0 border-slate-100 group"
                >
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {action.label}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {action.description}
                    </p>
                  </div>
                  <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
