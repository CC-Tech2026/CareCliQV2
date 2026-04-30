import { useState } from "react";
import {
  useGetDashboardStats,
  useGetRecentSessions,
  useGetUnreadAlerts,
  useMarkAllAlertsRead,
  useMarkAlertRead,
  useGetParticipants,
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
  Clock,
  ChevronRight,
  PlusCircle,
  FileText,
  Receipt,
  Upload,
  MapPin,
  X,
  Target,
  Bell,
  Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link, useLocation } from "wouter";
import { format, parseISO } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sessionStatusColor(status: string) {
  if (status === "in_progress") return "bg-violet-50 text-violet-700 border-violet-200";
  if (status === "completed") return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (status === "draft") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
}

function sessionStatusLabel(status: string) {
  if (status === "in_progress") return "In Progress";
  if (status === "completed") return "Completed";
  if (status === "draft") return "Draft";
  return "Upcoming";
}

function initials(name: string) {
  return name
    .split(" ")
    .slice(0, 2)
    .map(s => s[0])
    .join("")
    .toUpperCase();
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: recentSessions, isLoading: sessionsLoading } = useGetRecentSessions({ limit: 5 });
  const { data: unreadAlerts, isLoading: alertsLoading } = useGetUnreadAlerts();
  const { data: participants } = useGetParticipants();

  const markAllRead = useMarkAllAlertsRead();
  const markRead = useMarkAlertRead();

  // Quick-action modal state
  const [caseNoteOpen, setCaseNoteOpen] = useState(false);
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);

  // Quick-action form state
  const [caseNote, setCaseNote] = useState("");
  const [invoiceDesc, setInvoiceDesc] = useState("");
  const [invoiceAmount, setInvoiceAmount] = useState("");

  const handleMarkAllRead = () => markAllRead.mutate(undefined);
  const handleMarkRead = (id: string) => markRead.mutate({ alertId: id });

  // Participant focus — use first participant from list
  const focusParticipant = participants?.[0] ?? null;

  const complianceScore = stats?.compliance_alerts !== undefined ? Math.max(0, 100 - (stats.compliance_alerts * 5)) : null;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">

      {/* ── Greeting and Quick Actions ── */}
      <div className="flex flex-col xl:flex-row justify-between items-start xl:items-center gap-4 bg-white dark:bg-slate-950 p-5 md:p-6 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
            Good morning, Dr. Provider!
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            Here's what's happening today.
          </p>
        </div>

        {/* Action ribbon — 2-col on mobile, row on larger */}
        <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full xl:w-auto">
          <Link href="/sessions/new" className="col-span-2 sm:col-span-1">
            <Button className="bg-violet-600 hover:bg-violet-700 text-white gap-2 shadow-sm w-full sm:w-auto">
              <PlusCircle className="h-4 w-4" /> Start New Session
            </Button>
          </Link>
          <Button
            variant="outline"
            className="gap-2 border-slate-200 hover:bg-slate-50 text-slate-700 text-sm"
            onClick={() => setCaseNoteOpen(true)}
          >
            <FileText className="h-4 w-4 text-slate-500" /> Add Case Note
          </Button>
          <Button
            variant="outline"
            className="gap-2 border-slate-200 hover:bg-slate-50 text-slate-700 text-sm"
            onClick={() => setInvoiceOpen(true)}
          >
            <Receipt className="h-4 w-4 text-slate-500" /> Create Invoice
          </Button>
          <Button
            variant="outline"
            className="gap-2 border-slate-200 hover:bg-slate-50 text-slate-700 text-sm"
            onClick={() => setEvidenceOpen(true)}
          >
            <Upload className="h-4 w-4 text-slate-500" /> Upload Evidence
          </Button>
        </div>
      </div>

      {/* ── Stats Cards ── */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Card className="border border-slate-100/80 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-slate-500">Active Participants</CardTitle>
            <Users className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {statsLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className="text-2xl font-bold text-slate-900">{stats?.active_participants ?? 0}</div>
                <p className="text-xs text-slate-400 mt-1">Out of {stats?.total_participants ?? 0} total</p>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="border border-slate-100/80 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-slate-500">Sessions This Week</CardTitle>
            <CalendarDays className="h-4 w-4 text-slate-400" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {statsLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold text-slate-900">{stats?.sessions_this_week ?? 0}</div>
            )}
          </CardContent>
        </Card>

        <Card className="border border-slate-100/80 shadow-sm bg-white">
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-slate-500">Missing Notes</CardTitle>
            <FileWarning className="h-4 w-4 text-amber-500" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {statsLoading ? <Skeleton className="h-8 w-16" /> : (
              <>
                <div className="text-2xl font-bold text-slate-900">{stats?.notes_missing ?? 0}</div>
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
          <CardHeader className="flex flex-row items-center justify-between pb-2 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-slate-500">Compliance Alerts</CardTitle>
            <ShieldAlert className="h-4 w-4 text-rose-500" />
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {statsLoading ? <Skeleton className="h-8 w-16" /> : (
              <div className="text-2xl font-bold text-slate-900">{stats?.compliance_alerts ?? 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Main Grid ── */}
      <div className="grid gap-6 lg:grid-cols-3">

        {/* Left — Sessions + Participant Focus */}
        <div className="lg:col-span-2 space-y-6">

          {/* Recent Sessions (live data) */}
          <Card className="border border-slate-100/80 shadow-sm bg-white">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="text-lg text-slate-900">Recent Sessions</CardTitle>
                <CardDescription>Your latest clinical sessions</CardDescription>
              </div>
              <Link href="/sessions">
                <Button variant="ghost" size="sm" className="text-xs text-slate-500 hover:text-primary">
                  View all
                </Button>
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              {sessionsLoading ? (
                <div className="p-6 space-y-4">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full" />)}
                </div>
              ) : !recentSessions?.length ? (
                <div className="text-center py-12 text-slate-400 px-6">
                  <CalendarDays className="h-8 w-8 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No sessions yet</p>
                  <Link href="/sessions/new">
                    <Button size="sm" variant="outline" className="mt-4">Create first session</Button>
                  </Link>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {recentSessions.map(s => {
                    const name = s.participants?.full_name ?? "Unknown Participant";
                    const isLive = s.status === "in_progress";
                    return (
                      <div key={s.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-6 py-4 group hover:bg-slate-50/60 transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 bg-indigo-50 text-indigo-700 rounded-full flex items-center justify-center text-xs font-bold shrink-0">
                            {initials(name)}
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-slate-900 leading-tight">{name}</p>
                            <p className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                              <Clock className="h-3 w-3" />
                              {format(parseISO(s.session_date), "MMM d")} · {s.duration_minutes} min · {s.session_type}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
                          <Badge variant="outline" className={sessionStatusColor(s.status ?? "upcoming")}>
                            {sessionStatusLabel(s.status ?? "upcoming")}
                          </Badge>
                          <Button
                            size="sm"
                            variant={isLive ? "default" : "outline"}
                            className={cn("h-8 gap-1.5", isLive && "bg-violet-600 hover:bg-violet-700")}
                            onClick={() => navigate(isLive ? `/sessions/${s.id}/live` : `/sessions/${s.id}`)}
                          >
                            {isLive ? (
                              <><Play className="h-3 w-3 fill-white" /> Continue</>
                            ) : "View Session"}
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Participant Focus (live data) */}
          <Card className="border border-slate-100/80 shadow-sm bg-white">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="text-lg text-slate-900">Participant Focus</CardTitle>
                <CardDescription>Keep participants at the centre of every session</CardDescription>
              </div>
              {focusParticipant && (
                <Link href="/patients">
                  <Button variant="link" className="text-xs text-indigo-600 h-auto p-0">
                    View {focusParticipant.full_name.split(" ")[0]}'s Plan &rarr;
                  </Button>
                </Link>
              )}
            </CardHeader>
            <CardContent>
              {!focusParticipant ? (
                <div className="text-center py-8 text-slate-400">
                  <Users className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  <p className="text-sm">No participants yet</p>
                  <Link href="/patients">
                    <Button size="sm" variant="outline" className="mt-3">Add Participant</Button>
                  </Link>
                </div>
              ) : (
                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 bg-indigo-50 text-indigo-700 rounded-full flex items-center justify-center font-bold text-sm">
                        {initials(focusParticipant.full_name)}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-slate-900">{focusParticipant.full_name}</p>
                        <p className="text-xs text-slate-400">NDIS: {focusParticipant.ndis_number}</p>
                      </div>
                    </div>
                    <div className="space-y-3">
                      {(focusParticipant as { goals?: string[] }).goals?.slice(0, 3).map((goal, i) => (
                        <div key={i}>
                          <div className="flex justify-between text-xs font-medium text-slate-600 mb-1">
                            <span className="truncate pr-2">{goal}</span>
                            <span>{[75, 50, 30][i % 3]}%</span>
                          </div>
                          <Progress value={[75, 50, 30][i % 3]} className="h-2 bg-slate-100" />
                        </div>
                      )) ?? (
                        <>
                          <div>
                            <div className="flex justify-between text-xs font-medium text-slate-600 mb-1">
                              <span>Increase independence</span><span>75%</span>
                            </div>
                            <Progress value={75} className="h-2 bg-slate-100" />
                          </div>
                          <div>
                            <div className="flex justify-between text-xs font-medium text-slate-600 mb-1">
                              <span>Build confidence</span><span>50%</span>
                            </div>
                            <Progress value={50} className="h-2 bg-slate-100" />
                          </div>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="bg-slate-50/50 p-4 rounded-xl border border-slate-100 flex flex-col justify-between">
                    <div>
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Recent Note</span>
                      {recentSessions?.find(s => s.participants?.full_name === focusParticipant.full_name)?.notes ? (
                        <p className="text-xs text-slate-600 mt-2 leading-relaxed italic font-light">
                          "{recentSessions.find(s => s.participants?.full_name === focusParticipant.full_name)?.notes}"
                        </p>
                      ) : (
                        <p className="text-xs text-slate-400 mt-2 leading-relaxed italic">
                          No recent notes for this participant.
                        </p>
                      )}
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-slate-400 mt-4 pt-3 border-t border-slate-100">
                      <span>{format(new Date(), "d MMM yyyy")}</span>
                      <Link href={`/sessions/new`}>
                        <span className="text-indigo-500 font-medium cursor-pointer hover:underline">+ Add note</span>
                      </Link>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right — Compliance + Alerts */}
        <div className="space-y-6">

          {/* Compliance Overview */}
          <Card className="border border-slate-100/80 shadow-sm bg-white">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div><CardTitle className="text-lg text-slate-900">Compliance Overview</CardTitle></div>
              <Badge variant="secondary" className="bg-slate-50 text-slate-500">Live</Badge>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col items-center justify-center py-2">
                <div className="relative flex items-center justify-center h-36 w-36">
                  <svg className="absolute h-full w-full -rotate-90">
                    <circle cx="72" cy="72" r="60" stroke="#E2E8F0" strokeWidth="10" fill="transparent" />
                    <circle
                      cx="72" cy="72" r="60"
                      stroke={complianceScore !== null && complianceScore >= 85 ? "#10B981" : complianceScore !== null && complianceScore >= 60 ? "#F59E0B" : "#EF4444"}
                      strokeWidth="10"
                      fill="transparent"
                      strokeDasharray={`${2 * Math.PI * 60}`}
                      strokeDashoffset={`${2 * Math.PI * 60 * (1 - (complianceScore ?? 0) / 100)}`}
                      strokeLinecap="round"
                    />
                  </svg>
                  <div className="text-center">
                    {statsLoading ? (
                      <Skeleton className="h-10 w-16 mx-auto" />
                    ) : (
                      <>
                        <span className="text-4xl font-extrabold text-slate-900">{complianceScore ?? "—"}{complianceScore !== null ? "%" : ""}</span>
                        <p className={cn("text-xs font-semibold mt-1", complianceScore !== null && complianceScore >= 85 ? "text-emerald-600" : "text-amber-600")}>
                          {complianceScore !== null && complianceScore >= 85 ? "Compliant" : "Needs Work"}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 w-full mt-5 border-t border-slate-100 pt-4 text-center">
                  <div>
                    <span className="block text-xl font-bold text-slate-900">{stats?.sessions_this_week ?? 0}</span>
                    <span className="text-[10px] text-slate-400 flex items-center justify-center gap-1 mt-1">
                      <span className="h-2 w-2 rounded-full bg-emerald-500" /> Sessions
                    </span>
                  </div>
                  <div>
                    <span className="block text-xl font-bold text-amber-500">{stats?.notes_missing ?? 0}</span>
                    <span className="text-[10px] text-slate-400 flex items-center justify-center gap-1 mt-1">
                      <span className="h-2 w-2 rounded-full bg-amber-500" /> Missing
                    </span>
                  </div>
                  <div>
                    <span className="block text-xl font-bold text-rose-500">{stats?.compliance_alerts ?? 0}</span>
                    <span className="text-[10px] text-slate-400 flex items-center justify-center gap-1 mt-1">
                      <span className="h-2 w-2 rounded-full bg-rose-500" /> Alerts
                    </span>
                  </div>
                </div>

                <div className="mt-5 w-full border-t border-slate-100 pt-4 flex flex-col gap-3">
                  {complianceScore !== null && complianceScore >= 85 ? (
                    <div className="flex items-start gap-3 bg-emerald-50/30 p-3 rounded-lg border border-emerald-100/30 text-xs">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-semibold text-emerald-900">Great work!</p>
                        <p className="text-emerald-700/80 mt-0.5">Your documentation is on track.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-3 bg-amber-50/30 p-3 rounded-lg border border-amber-100/30 text-xs">
                      <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                      <div>
                        <p className="font-semibold text-amber-900">Attention needed</p>
                        <p className="text-amber-700/80 mt-0.5">Review sessions with missing notes.</p>
                      </div>
                    </div>
                  )}
                  <Link href="/compliance" className="text-xs text-center font-medium text-indigo-600 hover:text-indigo-700">
                    View compliance dashboard &rarr;
                  </Link>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Action Required / Alerts */}
          <Card className="border border-slate-100/80 shadow-sm bg-white">
            <CardHeader className="flex flex-row items-center justify-between pb-4">
              <div>
                <CardTitle className="text-lg text-slate-900 flex items-center gap-2">
                  Alerts
                  {unreadAlerts && unreadAlerts.length > 0 && (
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                      {unreadAlerts.length > 9 ? "9+" : unreadAlerts.length}
                    </span>
                  )}
                </CardTitle>
                <CardDescription>Records that need your attention</CardDescription>
              </div>
              {unreadAlerts && unreadAlerts.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs text-slate-500 hover:text-slate-700"
                  onClick={handleMarkAllRead}
                  disabled={markAllRead.isPending}
                >
                  Mark all read
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-1 p-0 pb-4">
              {alertsLoading ? (
                <div className="px-4 py-2 space-y-2">
                  {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
                </div>
              ) : !unreadAlerts?.length ? (
                <div className="px-6 py-8 text-center text-slate-400">
                  <Bell className="h-6 w-6 mx-auto mb-2 opacity-20" />
                  <p className="text-xs">No unread alerts — you're all caught up!</p>
                </div>
              ) : (
                unreadAlerts.map(alert => (
                  <div
                    key={alert.id}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-slate-50/80 transition-colors border-b last:border-0 border-slate-100"
                  >
                    <div className={cn(
                      "h-2 w-2 rounded-full shrink-0",
                      alert.alert_type === "missing_notes" ? "bg-amber-400" :
                      alert.alert_type === "compliance" ? "bg-red-400" : "bg-blue-400"
                    )} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-slate-800 leading-snug truncate">{alert.message}</p>
                      <p className="text-[10px] text-slate-400 mt-0.5">{alert.alert_type?.replace(/_/g, " ")}</p>
                    </div>
                    <button
                      onClick={() => handleMarkRead(alert.id)}
                      className="text-slate-300 hover:text-slate-500 p-1 rounded shrink-0"
                      title="Dismiss"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))
              )}

              {/* Quick action links */}
              <div className="px-2 pt-2">
                {[
                  { label: "Upload Document / Evidence", href: "#", onClick: () => setEvidenceOpen(true) },
                  { label: "Check Incomplete Records", href: "/sessions" },
                  { label: "View Compliance Dashboard", href: "/compliance" },
                ].map((action, i) => (
                  action.onClick ? (
                    <button
                      key={i}
                      onClick={action.onClick}
                      className="w-full flex items-center justify-between p-3 hover:bg-slate-50/80 rounded-lg transition-colors group"
                    >
                      <p className="text-xs font-medium text-slate-700">{action.label}</p>
                      <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
                    </button>
                  ) : (
                    <Link key={i} href={action.href!}>
                      <div className="flex items-center justify-between p-3 hover:bg-slate-50/80 rounded-lg transition-colors group cursor-pointer">
                        <p className="text-xs font-medium text-slate-700">{action.label}</p>
                        <ChevronRight className="h-4 w-4 text-slate-400 group-hover:text-slate-600 transition-colors" />
                      </div>
                    </Link>
                  )
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Add Case Note Modal ── */}
      <Dialog open={caseNoteOpen} onOpenChange={setCaseNoteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-indigo-500" /> Add Case Note
            </DialogTitle>
            <DialogDescription>Record an observation or clinical note</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {focusParticipant && (
              <div className="flex items-center gap-2 text-sm text-slate-600 bg-slate-50 px-3 py-2 rounded-lg">
                <Target className="h-4 w-4 text-slate-400" />
                Participant: <span className="font-medium">{focusParticipant.full_name}</span>
              </div>
            )}
            <Textarea
              placeholder="Enter clinical observations, outcomes, or notes here…"
              rows={5}
              value={caseNote}
              onChange={e => setCaseNote(e.target.value)}
              className="resize-none"
            />
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setCaseNoteOpen(false)}>Cancel</Button>
              <Button
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={() => {
                  if (!caseNote.trim()) return;
                  toast({ title: "Case note saved", description: "Note added to session record." });
                  setCaseNote("");
                  setCaseNoteOpen(false);
                }}
              >
                Save Note
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Create Invoice Modal ── */}
      <Dialog open={invoiceOpen} onOpenChange={setInvoiceOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Receipt className="h-5 w-5 text-indigo-500" /> Create Invoice
            </DialogTitle>
            <DialogDescription>Draft an NDIS service invoice</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Service Description</label>
              <Input
                placeholder="e.g. Community Access Support — 2 hrs"
                value={invoiceDesc}
                onChange={e => setInvoiceDesc(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5 block">Amount (AUD)</label>
              <Input
                type="number"
                placeholder="0.00"
                value={invoiceAmount}
                onChange={e => setInvoiceAmount(e.target.value)}
              />
            </div>
            {focusParticipant && (
              <div className="text-xs text-slate-500 bg-slate-50 p-3 rounded-lg">
                Billing to: <span className="font-medium text-slate-700">{focusParticipant.full_name}</span> · NDIS {focusParticipant.ndis_number}
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setInvoiceOpen(false)}>Cancel</Button>
              <Button
                className="bg-indigo-600 hover:bg-indigo-700 text-white"
                onClick={() => {
                  if (!invoiceDesc.trim()) return;
                  toast({ title: "Invoice created", description: `$${invoiceAmount || "0"} — ${invoiceDesc}` });
                  setInvoiceDesc("");
                  setInvoiceAmount("");
                  setInvoiceOpen(false);
                }}
              >
                Create Invoice
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Upload Evidence Modal ── */}
      <Dialog open={evidenceOpen} onOpenChange={setEvidenceOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-indigo-500" /> Upload Evidence
            </DialogTitle>
            <DialogDescription>Attach photos, signed forms, or supporting documents</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <label className="block border-2 border-dashed border-indigo-200 rounded-xl p-8 text-center cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/20 transition-all">
              <input type="file" multiple accept="image/*,.pdf,.doc,.docx" className="hidden" onChange={e => {
                const count = e.target.files?.length ?? 0;
                if (count > 0) {
                  toast({ title: `${count} file${count > 1 ? "s" : ""} uploaded`, description: "Evidence attached to session record." });
                  setEvidenceOpen(false);
                }
              }} />
              <Upload className="h-8 w-8 mx-auto text-indigo-300 mb-2" />
              <p className="text-sm font-medium text-slate-600">Click to select files</p>
              <p className="text-xs text-slate-400 mt-1">Images, PDFs, or Word documents</p>
            </label>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setEvidenceOpen(false)}>Cancel</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
