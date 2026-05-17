import { useMemo, useState } from "react";
import { useLocation, Link } from "wouter";
import { format } from "date-fns";
import {
  Search,
  UserPlus,
  Users,
  Target,
  DollarSign,
  UserCheck,
  AlertTriangle,
  ChevronRight,
  PlusCircle,
  CheckCircle2,
  Edit,
  Loader2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useCreateParticipant } from "@workspace/api-client-react";
import { setRequestContext } from "@workspace/api-client-react";

const participants = [
  {
    id: "1",
    full_name: "Sarah Mitchell",
    ndis_number: "430012345",
    plan_status: "active",
    primary_disability: "Autism Spectrum Disorder",
    funding_remaining: 24300,
    goals_completed: 6,
    goals_total: 10,
    compliance_risk: "Moderate",
    practitioner_count: 4,
    alerts: ["Plan expires in 14 days"],
  },
  {
    id: "2",
    full_name: "Michael Chen",
    ndis_number: "430045621",
    plan_status: "pending",
    primary_disability: "Psychosocial Disability",
    funding_remaining: 12900,
    goals_completed: 3,
    goals_total: 8,
    compliance_risk: "Low",
    practitioner_count: 2,
    alerts: [],
  },
];

function cn(...classes: string[]) {
  return classes.filter(Boolean).join(" ");
}

function statusStyles(status: string) {
  switch (status) {
    case "active":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "pending":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "expired":
      return "bg-red-50 text-red-700 border-red-200";
    default:
      return "bg-slate-100 text-slate-700 border-slate-200";
  }
}

function SummaryCard({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) {
  return (
    <div className="rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm transition-all duration-200 hover:shadow-md">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <h3 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">{value}</h3>
      {subtitle && <p className="mt-2 text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100">
        <Target className="h-7 w-7 text-slate-400" />
      </div>
      <h3 className="mt-5 text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500">{description}</p>
    </div>
  );
}

function ParticipantGoals() {
  const goals = [
    { id: 1, title: "Improve independent travel confidence", completed: true, category: "Capacity Building" },
    { id: 2, title: "Increase community engagement participation", completed: false, category: "Core Supports" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Participant Goals</h3>
          <p className="mt-1 text-sm text-slate-500">Track outcomes linked to the participant's active NDIS plan.</p>
        </div>
        <Link href="/participants/new"><Button className="rounded-2xl bg-purple-900 px-4 hover:bg-purple-800"><PlusCircle className="mr-2 h-4 w-4" />Add Goal</Button></Link>
      </div>
      <div className="space-y-3">
        {goals.map((goal) => (
          <div key={goal.id} className={cn("rounded-3xl border p-5 transition-all duration-200 hover:shadow-sm", goal.completed ? "border-emerald-100 bg-emerald-50/70" : "border-slate-200 bg-white")}>
            <div className="flex items-start gap-4">
              <div className="mt-0.5 shrink-0">{goal.completed ? <CheckCircle2 className="h-5 w-5 text-emerald-500" /> : <div className="h-5 w-5 rounded-full border-2 border-slate-300" />}</div>
              <div className="flex-1">
                <p className={cn("text-sm font-medium", goal.completed ? "text-slate-500 line-through" : "text-slate-900")}>{goal.title}</p>
                <div className="mt-3 flex items-center gap-2"><Badge className="rounded-full border-purple-200 bg-purple-50 text-purple-700">{goal.category}</Badge></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BudgetPanel() {
  const budgets = [
    { category: "Core Supports", used: 65, allocated: "$22,000", remaining: "$8,000" },
    { category: "Capacity Building", used: 40, allocated: "$15,000", remaining: "$9,000" },
  ];

  return (
    <div className="space-y-5">
      {budgets.map((budget) => (
        <div key={budget.category} className="rounded-3xl border border-slate-200 bg-white p-5">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-semibold text-slate-900">{budget.category}</h4>
              <p className="mt-1 text-sm text-slate-500">Remaining: {budget.remaining}</p>
            </div>
            <Badge className="rounded-full border-slate-200 bg-slate-100 text-slate-700">{budget.allocated}</Badge>
          </div>
          <div className="mt-5">
            <Progress value={budget.used} className="h-2 rounded-full" />
            <div className="mt-2 flex justify-between text-xs text-slate-500"><span>{budget.used}% used</span><span>{budget.remaining} remaining</span></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TeamPanel() {
  const team = [{ name: "Emma Wilson", role: "Primary OT" }, { name: "James Parker", role: "Support Worker" }];
  return <div className="space-y-4">{team.map((member) => (<div key={member.name} className="flex items-center gap-4 rounded-3xl border border-slate-200 bg-white p-5"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 font-semibold text-purple-700">{member.name.split(" ").map((n) => n[0]).join("")}</div><div className="flex-1"><p className="text-sm font-semibold text-slate-900">{member.name}</p><p className="mt-1 text-sm text-slate-500">{member.role}</p></div><Button variant="outline" className="rounded-2xl">View</Button></div>))}</div>;
}

export default function CareScribePatientsWorkspace() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState(participants[0].id);
  const [showPlanDialog, setShowPlanDialog] = useState(false);
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [, navigate] = useLocation();
  const createParticipant = useCreateParticipant();
  const selectedParticipant = participants.find((p) => p.id === selectedId);

  const filteredParticipants = useMemo(() => {
    return participants.filter((participant) => {
      const matchesSearch = participant.full_name.toLowerCase().includes(search.toLowerCase()) || participant.ndis_number.includes(search);
      const matchesStatus = statusFilter === "all" || participant.plan_status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [search, statusFilter]);

  return (
    <div className="flex h-screen overflow-hidden bg-[#F6F8FC] p-4"><div className="flex w-full gap-5 overflow-hidden"><aside className="flex w-[360px] flex-col overflow-hidden rounded-[28px] border border-slate-200/70 bg-white shadow-sm"><div className="sticky top-0 z-10 border-b border-slate-100 bg-white/90 p-5 backdrop-blur-xl"><div className="flex items-start justify-between"><div><h1 className="text-2xl font-bold tracking-tight text-slate-900">Participants</h1><p className="mt-1 text-sm text-slate-500">Clinical management workspace</p></div><Link href="/participants/new"><Button className="rounded-2xl bg-purple-900 hover:bg-purple-800"><UserPlus className="mr-2 h-4 w-4" />Add</Button></Link></div><div className="mt-5 space-y-3"><div className="relative"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search participant" className="h-11 rounded-2xl border-slate-200 bg-slate-50 pl-10 focus-visible:ring-2 focus-visible:ring-purple-500" /></div><Select value={statusFilter} onValueChange={setStatusFilter}><SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-slate-50"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Statuses</SelectItem><SelectItem value="active">Active</SelectItem><SelectItem value="pending">Pending</SelectItem><SelectItem value="expired">Expired</SelectItem></SelectContent></Select></div></div><ScrollArea className="flex-1 p-3"><div className="space-y-2">{filteredParticipants.map((participant) => { const isSelected = participant.id === selectedId; const initials = participant.full_name.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase(); return (<button key={participant.id} onClick={() => setSelectedId(participant.id)} className={cn("group w-full rounded-3xl border p-4 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-500", isSelected ? "border-purple-200 bg-gradient-to-r from-purple-50 to-pink-50 shadow-sm" : "border-transparent hover:bg-slate-50")}><div className="flex items-start gap-4"><div className="relative shrink-0"><div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-purple-700 to-pink-500 text-sm font-semibold text-white shadow-sm">{initials}</div><div className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white" /></div><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><h3 className="truncate text-sm font-semibold text-slate-900">{participant.full_name}</h3><p className="mt-1 font-mono text-xs text-slate-500">{participant.ndis_number}</p></div><Badge className={cn("rounded-full border capitalize", statusStyles(participant.plan_status))}>{participant.plan_status}</Badge></div><div className="mt-3 flex items-center gap-2 text-xs text-slate-500"><span className="truncate">{participant.primary_disability}</span></div></div></div></button>); })}</div></ScrollArea></aside><main className="flex flex-1 flex-col overflow-hidden rounded-[28px] border border-slate-200/70 bg-white shadow-sm">{!selectedParticipant ? <EmptyState title="Select a participant" description="Choose a participant to view goals, compliance insights, budgets, and practitioner allocations." /> : (<><div className="sticky top-0 z-20 border-b border-slate-100 bg-white/90 px-7 py-6 backdrop-blur-xl"><div className="flex items-start justify-between gap-4"><div><h2 className="text-3xl font-bold tracking-tight text-slate-900">{selectedParticipant.full_name}</h2><div className="mt-3 flex flex-wrap items-center gap-3 text-sm text-slate-500"><span>NDIS #{selectedParticipant.ndis_number}</span><span>•</span><span>{selectedParticipant.primary_disability}</span><span>•</span><span>Updated {format(new Date(), "MMM d, yyyy")}</span></div></div><div className="flex items-center gap-3"><Button variant="outline" className="rounded-2xl border-slate-200" onClick={() => setShowEditDialog(true)}><Edit className="mr-2 h-4 w-4" />Edit Profile</Button><Button className="rounded-2xl bg-purple-900 hover:bg-purple-800" onClick={() => setShowPlanDialog(true)}><PlusCircle className="mr-2 h-4 w-4" />Set Up Plan</Button></div></div></div><ScrollArea className="flex-1"><div className="space-y-6 p-7">{selectedParticipant.alerts.length > 0 && (<div className="rounded-3xl border border-amber-200 bg-amber-50 p-5"><div className="flex items-start gap-4"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" /><div><h3 className="text-sm font-semibold text-amber-900">Compliance Alert</h3><p className="mt-1 text-sm text-amber-700">{selectedParticipant.alerts[0]}</p></div></div></div>)}<section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4"><SummaryCard title="Plan Status" value="Active" subtitle="Participant currently funded" /><SummaryCard title="Funding Remaining" value={`$${selectedParticipant.funding_remaining.toLocaleString()}`} subtitle="Across active support categories" /><SummaryCard title="Goals Achieved" value={`${selectedParticipant.goals_completed}/${selectedParticipant.goals_total}`} subtitle="Participant outcome progress" /><SummaryCard title="Practitioner Team" value={`${selectedParticipant.practitioner_count}`} subtitle="Allocated clinicians & support staff" /></section><section className="rounded-[28px] border border-slate-200 bg-slate-50/60 p-5"><Tabs defaultValue="goals"><TabsList className="grid h-auto grid-cols-3 rounded-2xl bg-slate-100 p-1"><TabsTrigger value="goals" className="rounded-xl py-3 data-[state=active]:bg-white data-[state=active]:shadow-sm"><Target className="mr-2 h-4 w-4" />Goals</TabsTrigger><TabsTrigger value="budget" className="rounded-xl py-3 data-[state=active]:bg-white data-[state=active]:shadow-sm"><DollarSign className="mr-2 h-4 w-4" />Budget</TabsTrigger><TabsTrigger value="team" className="rounded-xl py-3 data-[state=active]:bg-white data-[state=active]:shadow-sm"><UserCheck className="mr-2 h-4 w-4" />Team</TabsTrigger></TabsList><TabsContent value="goals" className="mt-6"><ParticipantGoals /></TabsContent><TabsContent value="budget" className="mt-6"><BudgetPanel /></TabsContent><TabsContent value="team" className="mt-6"><TeamPanel /></TabsContent></Tabs></section><section className="grid gap-5 xl:grid-cols-[1.2fr_0.8fr]"><div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm"><div className="flex items-center justify-between"><div><h3 className="text-lg font-semibold text-slate-900">Recent Clinical Activity</h3><p className="mt-1 text-sm text-slate-500">Latest participant-related interactions and notes.</p></div><Button variant="outline" className="rounded-2xl">View All</Button></div><div className="mt-6 space-y-4">{[1, 2, 3].map((activity) => (<div key={activity} className="flex items-start gap-4 rounded-2xl border border-slate-100 p-4"><div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-purple-100 text-purple-700"><Users className="h-4 w-4" /></div><div className="flex-1"><p className="text-sm font-medium text-slate-900">Session note completed and synced to participant timeline.</p><p className="mt-1 text-sm text-slate-500">2 hours ago • Support Worker</p></div><ChevronRight className="h-4 w-4 text-slate-300" /></div>))}</div></div><div className="space-y-5"><div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm"><h3 className="text-lg font-semibold text-slate-900">Compliance Overview</h3><div className="mt-5 space-y-4"><div className="rounded-2xl bg-emerald-50 p-4"><p className="text-sm font-semibold text-emerald-900">Documentation Health</p><p className="mt-1 text-sm text-emerald-700">96% compliant documentation completion rate.</p></div><div className="rounded-2xl bg-amber-50 p-4"><p className="text-sm font-semibold text-amber-900">Upcoming Review</p><p className="mt-1 text-sm text-amber-700">NDIS review preparation recommended within 2 weeks.</p></div></div></div><div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-sm"><h3 className="text-lg font-semibold text-slate-900">Quick Actions</h3><div className="mt-5 grid gap-3"><Button className="justify-start rounded-2xl bg-purple-900 hover:bg-purple-800">Add Session Note</Button><Button variant="outline" className="justify-start rounded-2xl">Generate Progress Report</Button><Button variant="outline" className="justify-start rounded-2xl">Allocate Practitioner</Button></div></div></div></section></div></ScrollArea></>)}</main></div><Dialog open={showEditDialog} onOpenChange={setShowEditDialog}><DialogContent><DialogHeader><DialogTitle>Edit Profile</DialogTitle></DialogHeader><div className="space-y-3"><p className="text-sm text-slate-500">Open the participant edit screen to update profile details.</p><DialogFooter><Button variant="outline" onClick={() => setShowEditDialog(false)}>Cancel</Button><Button onClick={() => navigate(`/participants/${selectedParticipant?.id}/edit`)}>Open Edit Profile</Button></DialogFooter></div></DialogContent></Dialog><Dialog open={showPlanDialog} onOpenChange={setShowPlanDialog}><DialogContent><DialogHeader><DialogTitle>Set Up Plan</DialogTitle></DialogHeader><div className="space-y-3"><p className="text-sm text-slate-500">Open the participant edit screen to configure plan dates and budgets.</p><DialogFooter><Button variant="outline" onClick={() => setShowPlanDialog(false)}>Cancel</Button><Button onClick={() => navigate(`/participants/new`)}>Add Participant</Button></DialogFooter></div></DialogContent></Dialog></div>
  );
}
