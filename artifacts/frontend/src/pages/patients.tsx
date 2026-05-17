import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { format } from "date-fns";
import {
  AlertTriangle,
  ChevronRight,
  DollarSign,
  Edit,
  Loader2,
  PlusCircle,
  Search,
  Target,
  UserCheck,
  UserPlus,
  Users,
} from "lucide-react";
import {
  useGetParticipant,
  useGetParticipantSessions,
  useGetParticipants,
  useCreateParticipant,
  useUpdateParticipant,
  useUpdateParticipantGoals,
} from "@workspace/api-client-react";
import type { Participant, Session } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

function cn(...classes: Array<string | false | null | undefined>) {
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

function formatMoney(value: number | null | undefined) {
  const amount = Number(value ?? 0);
  return new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 }).format(amount);
}

function SummaryCard({ title, value, subtitle }: { title: string; value: string; subtitle?: string }) {
  return (
    <div className="rounded-3xl border border-slate-200/70 bg-white p-5 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      <h3 className="mt-3 text-2xl font-bold tracking-tight text-slate-900">{value}</h3>
      {subtitle ? <p className="mt-2 text-sm text-slate-500">{subtitle}</p> : null}
    </div>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-3xl bg-slate-100">
        <Users className="h-7 w-7 text-slate-400" />
      </div>
      <h3 className="mt-5 text-base font-semibold text-slate-900">{title}</h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-slate-500">{description}</p>
    </div>
  );
}

function GoalsPanel({ participant, onAddGoal }: { participant: Participant | null; onAddGoal?: () => void }) {
  const list = Array.isArray(participant?.goals) ? participant.goals : [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Participant Goals</h3>
          <p className="mt-1 text-sm text-slate-500">Live goals tied to the participant's plan.</p>
        </div>
        <Button className="rounded-2xl bg-purple-900 px-4 hover:bg-purple-800" onClick={onAddGoal}>
          <PlusCircle className="mr-2 h-4 w-4" />Add Goal
        </Button>
      </div>
      {list.length ? (
        <div className="space-y-3">
          {list.map((goal: any) => (
            <div
              key={goal.id ?? goal.description}
              className={cn(
                "rounded-3xl border p-5 transition-all duration-200 hover:shadow-sm",
                goal.is_achieved ? "border-emerald-100 bg-emerald-50/70" : "border-slate-200 bg-white",
              )}
            >
              <div className="flex items-start gap-4">
                <div className="mt-0.5 shrink-0">
                  {goal.is_achieved ? (
                    <UserCheck className="h-5 w-5 text-emerald-500" />
                  ) : (
                    <div className="h-5 w-5 rounded-full border-2 border-slate-300" />
                  )}
                </div>
                <div className="flex-1">
                  <p className={cn("text-sm font-medium", goal.is_achieved ? "text-slate-500 line-through" : "text-slate-900")}>
                    {goal.description ?? goal.title ?? "Goal"}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge className="rounded-full border-purple-200 bg-purple-50 text-purple-700">{goal.category ?? "general"}</Badge>
                    {goal.target_date ? <Badge variant="outline">{String(goal.target_date).slice(0, 10)}</Badge> : null}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title="No goals yet" description="Add a plan-linked goal to start tracking outcomes." />
      )}
    </div>
  );
}

function BudgetPanel({ participant }: { participant: Participant | null }) {
  const planBudget = Number(participant?.total_budget ?? 0);
  const usedBudget = Number(participant?.used_budget ?? 0);
  const remaining = Math.max(planBudget - usedBudget, 0);

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-semibold text-slate-900">Plan Budget</h4>
            <p className="mt-1 text-sm text-slate-500">Live from the participant record</p>
          </div>
          <Badge className="rounded-full border-slate-200 bg-slate-100 text-slate-700">{formatMoney(planBudget)}</Badge>
        </div>
        <div className="mt-5">
          <Progress value={planBudget ? Math.min((usedBudget / planBudget) * 100, 100) : 0} className="h-2 rounded-full" />
          <div className="mt-2 flex justify-between text-xs text-slate-500">
            <span>{formatMoney(usedBudget)} used</span>
            <span>{formatMoney(remaining)} remaining</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamPanel({ sessions }: { sessions: Session[] }) {
  const latest = sessions.slice(0, 3);
  return (
    <div className="space-y-4">
      {latest.length ? latest.map((session) => (
        <div key={session.id} className="flex items-center gap-4 rounded-3xl border border-slate-200 bg-white p-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 font-semibold text-purple-700">
            {String(session.session_type ?? "S").slice(0, 1).toUpperCase()}
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-slate-900">{session.session_type ?? "Session"}</p>
            <p className="mt-1 text-sm text-slate-500">{session.session_date ? format(new Date(String(session.session_date)), "dd MMM yyyy") : "No date"}</p>
          </div>
          <Button variant="outline" className="rounded-2xl" asChild>
            <Link href={`/sessions/${session.id}`}>View</Link>
          </Button>
        </div>
      )) : <EmptyState title="No recent sessions" description="Sessions will appear here once they are created." />}
    </div>
  );
}

export default function CareScribePatientsWorkspace() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createParticipantMutation = useCreateParticipant();
  const updateParticipantMutation = useUpdateParticipant();
  const updateGoalsMutation = useUpdateParticipantGoals();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string>("");

  const [showCreate, setShowCreate] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createNdisNumber, setCreateNdisNumber] = useState("");
  const [createDob, setCreateDob] = useState("");
  const [createBudget, setCreateBudget] = useState("");

  const [showEdit, setShowEdit] = useState(false);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [editDisability, setEditDisability] = useState("");

  const [showGoalsEdit, setShowGoalsEdit] = useState(false);
  const [goalText, setGoalText] = useState("");

  const { data: participants = [], isLoading, error } = useGetParticipants();
  const selectedQuery = useGetParticipant(selectedId);
  const selectedParticipant = selectedQuery.data ?? null;
  const { data: selectedParticipantSessions = [] } = useGetParticipantSessions(selectedId);

  const filteredParticipants = useMemo(() => {
    return (participants as Participant[]).filter((p) => {
      const matchesSearch =
        p.full_name?.toLowerCase().includes(search.toLowerCase()) ||
        p.ndis_number?.includes(search);
      const matchesStatus = statusFilter === "all" || p.plan_status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [participants, search, statusFilter]);

  useEffect(() => {
    if (!selectedId && filteredParticipants[0]?.id) {
      setSelectedId(filteredParticipants[0].id);
    }
  }, [filteredParticipants, selectedId]);

  const selectedItem = selectedParticipant ?? filteredParticipants[0] ?? null;

  useEffect(() => {
    if (!selectedItem) return;
    setEditName(selectedItem.full_name ?? "");
    setEditEmail(selectedItem.email ?? "");
    setEditPhone(selectedItem.phone ?? "");
    setEditDisability(selectedItem.primary_disability ?? "");
  }, [selectedItem]);

  async function handleCreateParticipant() {
    if (!createName.trim() || !createNdisNumber.trim() || !createDob) {
      toast({ title: "Name, NDIS number, and date of birth are required", variant: "destructive" });
      return;
    }
    try {
      const created = await createParticipantMutation.mutateAsync({
        data: {
          full_name: createName.trim(),
          ndis_number: createNdisNumber.trim(),
          date_of_birth: createDob,
          total_budget: createBudget ? Number(createBudget) : undefined,
        },
      });
      setShowCreate(false);
      setCreateName("");
      setCreateNdisNumber("");
      setCreateDob("");
      setCreateBudget("");
      await queryClient.invalidateQueries({ queryKey: ["/api/participants"] });
      if (created?.id) setSelectedId(created.id);
      toast({ title: "Participant created" });
    } catch {
      toast({ title: "Failed to create participant", variant: "destructive" });
    }
  }

  async function handleSaveEdit() {
    if (!selectedItem?.id) return;
    try {
      await updateParticipantMutation.mutateAsync({
        participantId: selectedItem.id,
        data: {
          full_name: editName.trim() || undefined,
          email: editEmail.trim() || undefined,
          phone: editPhone.trim() || undefined,
          primary_disability: editDisability.trim() || undefined,
        },
      });
      setShowEdit(false);
      await queryClient.invalidateQueries({ queryKey: ["/api/participants"] });
      await queryClient.invalidateQueries({ queryKey: [`/api/participants/${selectedItem.id}`] });
      toast({ title: "Participant updated" });
    } catch {
      toast({ title: "Failed to update participant", variant: "destructive" });
    }
  }

  async function handleSaveGoals() {
    if (!selectedItem?.id) return;
    if (!goalText.trim()) {
      toast({ title: "Please enter a goal description", variant: "destructive" });
      return;
    }
    try {
      const existing = Array.isArray(selectedItem.goals) ? selectedItem.goals : [];
      const updated = [
        ...existing,
        {
          id: crypto.randomUUID(),
          title: goalText.trim(),
          status: "active" as const,
          category: "general" as const,
        },
      ];
      await updateGoalsMutation.mutateAsync({
        participantId: selectedItem.id,
        data: { goals: updated },
      });
      setGoalText("");
      setShowGoalsEdit(false);
      await queryClient.invalidateQueries({ queryKey: [`/api/participants/${selectedItem.id}`] });
      toast({ title: "Goal saved" });
    } catch {
      toast({ title: "Failed to save goal", variant: "destructive" });
    }
  }

  if (error) {
    return <EmptyState title="Couldn't load participants" description="The participant list is unavailable right now." />;
  }

  return (
    <div className="flex h-screen overflow-hidden bg-[#F6F8FC] p-4">
      <div className="flex w-full gap-5 overflow-hidden">
        <aside className="flex w-[360px] flex-col overflow-hidden rounded-[28px] border border-slate-200/70 bg-white shadow-sm">
          <div className="sticky top-0 z-10 border-b border-slate-100 bg-white/90 p-5 backdrop-blur-xl">
            <div className="flex items-start justify-between">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Participants</h1>
                <p className="mt-1 text-sm text-slate-500">Clinical management workspace</p>
              </div>
              <Button className="rounded-2xl bg-purple-900 hover:bg-purple-800" onClick={() => setShowCreate(true)}>
                <UserPlus className="mr-2 h-4 w-4" />Add
              </Button>
            </div>
            <div className="mt-5 space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search participant"
                  className="h-11 rounded-2xl border-slate-200 bg-slate-50 pl-10 focus-visible:ring-2 focus-visible:ring-purple-500"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-11 rounded-2xl border-slate-200 bg-slate-50"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="expired">Expired</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <ScrollArea className="flex-1 p-3">
            <div className="space-y-2">
              {isLoading ? (
                <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading participants
                </div>
              ) : filteredParticipants.length ? (
                filteredParticipants.map((participant) => {
                  const isSelected = participant.id === selectedItem?.id;
                  return (
                    <button
                      key={participant.id}
                      onClick={() => participant.id && setSelectedId(participant.id)}
                      className={cn(
                        "group w-full rounded-3xl border p-4 text-left transition-all duration-200",
                        isSelected ? "border-purple-200 bg-purple-50/50 shadow-sm" : "border-slate-200 bg-white hover:bg-slate-50",
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-purple-100 font-semibold text-purple-700">
                          {participant.full_name?.split(" ").map((n) => n[0]).join("").slice(0, 2).toUpperCase() || "P"}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="truncate font-semibold text-slate-900">{participant.full_name ?? "Unnamed participant"}</h3>
                              <p className="mt-0.5 text-sm text-slate-500">NDIS {participant.ndis_number ?? "—"}</p>
                            </div>
                            <Badge className={cn("rounded-full border text-xs", statusStyles(participant.plan_status ?? "draft"))}>
                              {participant.plan_status ?? "draft"}
                            </Badge>
                          </div>
                          <div className="mt-3 flex items-center gap-4 text-xs text-slate-500">
                            <span className="flex items-center gap-1.5">
                              <Target className="h-3.5 w-3.5" />
                              {participant.primary_disability ?? "No disability set"}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <DollarSign className="h-3.5 w-3.5" />
                              {formatMoney(participant.total_budget)}
                            </span>
                          </div>
                        </div>
                        <ChevronRight className={cn("mt-1 h-4 w-4", isSelected ? "text-purple-700" : "text-slate-400")} />
                      </div>
                    </button>
                  );
                })
              ) : (
                <EmptyState title="No participants found" description="Try adjusting your search or status filter." />
              )}
            </div>
          </ScrollArea>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[28px] border border-slate-200/70 bg-[#FBFCFE] shadow-sm">
          {selectedItem ? (
            <div className="flex h-full flex-col overflow-hidden">
              <div className="border-b border-slate-200/70 bg-white p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 text-sm text-slate-500">
                      <Link href="/patients">Participants</Link>
                      <ChevronRight className="h-4 w-4" />
                      <span>{selectedItem.full_name}</span>
                    </div>
                    <h2 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">{selectedItem.full_name}</h2>
                    <p className="mt-1 text-sm text-slate-500">
                      NDIS {selectedItem.ndis_number ?? "—"} · {selectedItem.primary_disability ?? "No primary disability"}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Button variant="outline" className="rounded-2xl" onClick={() => setShowEdit(true)}>
                      <Edit className="mr-2 h-4 w-4" />Edit Profile
                    </Button>
                    <Button
                      className="rounded-2xl bg-purple-900 hover:bg-purple-800"
                      onClick={() => navigate(`/participants/${selectedItem.id}/plan`)}
                    >
                      Set Up Plan
                    </Button>
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-4">
                  <SummaryCard
                    title="Plan Status"
                    value={selectedItem.plan_status ?? "draft"}
                    subtitle={selectedItem.plan_start_date
                      ? `Starts ${format(new Date(String(selectedItem.plan_start_date)), "dd MMM yyyy")}`
                      : undefined}
                  />
                  <SummaryCard title="Budget" value={formatMoney(selectedItem.total_budget)} subtitle="Total plan budget" />
                  <SummaryCard
                    title="Goals"
                    value={String((selectedItem.goals ?? []).length)}
                    subtitle="Plan-linked outcomes"
                  />
                  <SummaryCard
                    title="Risk"
                    value={(selectedItem as any).risk_level ?? "Low"}
                    subtitle={(selectedItem as any).risk_management_plan ? "Management plan on file" : "No risk plan set"}
                  />
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="grid grid-cols-1 gap-5 p-6 xl:grid-cols-[1.1fr_0.9fr]">
                  <div className="space-y-5">
                    <Tabs defaultValue="overview" className="w-full">
                      <TabsList className="grid w-full grid-cols-3 rounded-2xl bg-slate-100 p-1">
                        <TabsTrigger value="overview" className="rounded-xl">Overview</TabsTrigger>
                        <TabsTrigger value="plan" className="rounded-xl">NDIS Plan</TabsTrigger>
                        <TabsTrigger value="history" className="rounded-xl">Client History</TabsTrigger>
                      </TabsList>

                      <TabsContent value="overview" className="mt-5 space-y-5">
                        <div className="rounded-3xl border border-slate-200 bg-white p-5">
                          <div className="flex items-center justify-between">
                            <div>
                              <h3 className="text-sm font-semibold text-slate-900">Participant Summary</h3>
                              <p className="mt-1 text-sm text-slate-500">Pulled from live participant data</p>
                            </div>
                            <Badge className={cn("rounded-full border", statusStyles(selectedItem.plan_status ?? "draft"))}>
                              {selectedItem.plan_status ?? "draft"}
                            </Badge>
                          </div>
                          <div className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                            <p>
                              <span className="font-medium text-slate-900">DOB: </span>
                              {selectedItem.date_of_birth ? String(selectedItem.date_of_birth).slice(0, 10) : "—"}
                            </p>
                            <p>
                              <span className="font-medium text-slate-900">Sex: </span>
                              {selectedItem.biological_sex ?? "unspecified"}
                            </p>
                            <p>
                              <span className="font-medium text-slate-900">Email: </span>
                              {selectedItem.email ?? "—"}
                            </p>
                            <p>
                              <span className="font-medium text-slate-900">Phone: </span>
                              {selectedItem.phone ?? "—"}
                            </p>
                          </div>
                        </div>
                        <GoalsPanel participant={selectedItem} onAddGoal={() => setShowGoalsEdit(true)} />
                      </TabsContent>

                      <TabsContent value="plan" className="mt-5">
                        <BudgetPanel participant={selectedItem} />
                      </TabsContent>

                      <TabsContent value="history" className="mt-5">
                        <TeamPanel sessions={selectedParticipantSessions as Session[]} />
                      </TabsContent>
                    </Tabs>
                  </div>

                  <div className="space-y-5">
                    <div className="rounded-3xl border border-slate-200 bg-white p-5">
                      <div className="flex items-center justify-between">
                        <div>
                          <h3 className="text-sm font-semibold text-slate-900">Action Centre</h3>
                          <p className="mt-1 text-sm text-slate-500">Connected actions use live records</p>
                        </div>
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                      </div>
                      <div className="mt-4 space-y-3">
                        <Button
                          className="w-full rounded-2xl bg-purple-900 hover:bg-purple-800"
                          onClick={() => setShowEdit(true)}
                        >
                          <Edit className="mr-2 h-4 w-4" />Edit Participant
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full rounded-2xl"
                          onClick={() => setShowGoalsEdit(true)}
                        >
                          <Target className="mr-2 h-4 w-4" />Add Goal
                        </Button>
                        <Button
                          variant="outline"
                          className="w-full rounded-2xl"
                          onClick={() => navigate(`/participants/${selectedItem.id}/plan`)}
                        >
                          <PlusCircle className="mr-2 h-4 w-4" />Create / Update Plan
                        </Button>
                        <Button variant="outline" className="w-full rounded-2xl" asChild>
                          <Link href={`/participants/${selectedItem.id}/export`}>Export Data</Link>
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center p-10">
              <EmptyState
                title="Select a participant"
                description="Choose a participant from the list to view live details."
              />
            </div>
          )}
        </main>
      </div>

      {/* Create participant dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add participant</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="create-name">Full name *</Label>
              <Input
                id="create-name"
                placeholder="e.g. Jane Smith"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="create-ndis">NDIS number *</Label>
              <Input
                id="create-ndis"
                placeholder="e.g. 430123456"
                value={createNdisNumber}
                onChange={(e) => setCreateNdisNumber(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="create-dob">Date of birth *</Label>
              <Input
                id="create-dob"
                type="date"
                value={createDob}
                onChange={(e) => setCreateDob(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="create-budget">Total budget (AUD)</Label>
              <Input
                id="create-budget"
                placeholder="e.g. 45000"
                value={createBudget}
                onChange={(e) => setCreateBudget(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button
              className="bg-purple-900 hover:bg-purple-800"
              disabled={createParticipantMutation.isPending}
              onClick={() => void handleCreateParticipant()}
            >
              {createParticipantMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit participant dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit participant</DialogTitle></DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="edit-name">Full name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-phone">Phone</Label>
              <Input
                id="edit-phone"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-disability">Primary disability</Label>
              <Input
                id="edit-disability"
                value={editDisability}
                onChange={(e) => setEditDisability(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button
              className="bg-purple-900 hover:bg-purple-800"
              disabled={updateParticipantMutation.isPending}
              onClick={() => void handleSaveEdit()}
            >
              {updateParticipantMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add goal dialog */}
      <Dialog open={showGoalsEdit} onOpenChange={setShowGoalsEdit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add goal</DialogTitle></DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="goal-text">Goal description</Label>
            <Input
              id="goal-text"
              value={goalText}
              onChange={(e) => setGoalText(e.target.value)}
              placeholder="e.g. Improve communication skills in daily activities"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowGoalsEdit(false)}>Cancel</Button>
            <Button
              className="bg-purple-900 hover:bg-purple-800"
              disabled={updateGoalsMutation.isPending}
              onClick={() => void handleSaveGoals()}
            >
              {updateGoalsMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Save Goal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
