import { useState } from "react";
import { useGetParticipants, useGetParticipant, useGetParticipantSessions, useGetAISummary, useCreateParticipant, type CreateParticipantBody } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Search, UserPlus, Calendar, Activity, Target, ShieldCheck, Clock, FileText, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useToast } from "@/hooks/use-toast";

const participantSchema = z.object({
  full_name: z.string().min(1, "Name is required"),
  ndis_number: z.string().min(1, "NDIS Number is required"),
  date_of_birth: z.string().min(1, "Date of birth is required"),
  email: z.string().email("Invalid email").optional().or(z.literal("")),
  phone: z.string().optional(),
  primary_disability: z.string().optional(),
  plan_status: z.string().min(1, "Plan status is required"),
  plan_start_date: z.string().optional(),
  plan_end_date: z.string().optional(),
  total_budget: z.coerce.number().min(0).optional(),
});

type ParticipantFormValues = z.infer<typeof participantSchema>;

export default function Patients() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const { toast } = useToast();

  const { data: participants, isLoading: participantsLoading, refetch } = useGetParticipants();
  const createParticipant = useCreateParticipant();

  const form = useForm<ParticipantFormValues>({
    resolver: zodResolver(participantSchema),
    defaultValues: {
      full_name: "",
      ndis_number: "",
      date_of_birth: "",
      email: "",
      phone: "",
      primary_disability: "",
      plan_status: "active",
      plan_start_date: "",
      plan_end_date: "",
      total_budget: 0,
    },
  });

  const onSubmit = (data: ParticipantFormValues) => {
    const payload: Record<string, unknown> = {
      full_name: data.full_name,
      ndis_number: data.ndis_number,
      date_of_birth: data.date_of_birth,
      plan_status: data.plan_status,
    };
    if (data.email) payload.email = data.email;
    if (data.phone) payload.phone = data.phone;
    if (data.primary_disability) payload.primary_disability = data.primary_disability;
    if (data.plan_start_date) payload.plan_start_date = data.plan_start_date;
    if (data.plan_end_date) payload.plan_end_date = data.plan_end_date;
    if (data.total_budget !== undefined) payload.total_budget = data.total_budget;

    createParticipant.mutate({ data: payload as unknown as CreateParticipantBody }, {
      onSuccess: (newParticipant) => {
        toast({ title: "Participant added successfully" });
        setIsAddOpen(false);
        form.reset();
        refetch();
        setSelectedId(newParticipant.id);
      },
      onError: () => {
        toast({ title: "Error adding participant", variant: "destructive" });
      }
    });
  };

  const filteredParticipants = participants?.filter(p => {
    const matchesSearch = p.full_name.toLowerCase().includes(search.toLowerCase()) || 
                          p.ndis_number.includes(search);
    const matchesStatus = statusFilter === "all" || p.plan_status === statusFilter;
    return matchesSearch && matchesStatus;
  }) || [];

  return (
    <div className="flex h-[calc(100vh-8rem)] gap-6 overflow-hidden">
      <div className="w-1/3 flex flex-col gap-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-lg">Participants</h2>
            <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
              <DialogTrigger asChild>
                <Button size="sm" variant="outline" className="h-8 gap-1">
                  <UserPlus className="h-3.5 w-3.5" />
                  <span>Add</span>
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Add New Participant</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <FormField
                        control={form.control}
                        name="full_name"
                        render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Full Name <span className="text-destructive">*</span></FormLabel>
                            <FormControl>
                              <Input placeholder="Jane Smith" data-testid="input-full-name" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="ndis_number"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>NDIS Number <span className="text-destructive">*</span></FormLabel>
                            <FormControl>
                              <Input placeholder="430012345" data-testid="input-ndis-number" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="date_of_birth"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Date of Birth <span className="text-destructive">*</span></FormLabel>
                            <FormControl>
                              <Input type="date" data-testid="input-date-of-birth" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="email"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                              <Input type="email" placeholder="jane@email.com" data-testid="input-email" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="phone"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Phone</FormLabel>
                            <FormControl>
                              <Input placeholder="0412 345 678" data-testid="input-phone" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="primary_disability"
                        render={({ field }) => (
                          <FormItem className="col-span-2">
                            <FormLabel>Primary Disability</FormLabel>
                            <FormControl>
                              <Input placeholder="e.g. Autism Spectrum Disorder" data-testid="input-primary-disability" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="plan_status"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Plan Status</FormLabel>
                            <Select onValueChange={field.onChange} defaultValue={field.value}>
                              <FormControl>
                                <SelectTrigger data-testid="select-plan-status">
                                  <SelectValue placeholder="Select status" />
                                </SelectTrigger>
                              </FormControl>
                              <SelectContent>
                                <SelectItem value="active">Active</SelectItem>
                                <SelectItem value="pending">Pending</SelectItem>
                                <SelectItem value="inactive">Inactive</SelectItem>
                                <SelectItem value="expired">Expired</SelectItem>
                              </SelectContent>
                            </Select>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="total_budget"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Total Budget ($)</FormLabel>
                            <FormControl>
                              <Input type="number" placeholder="50000" data-testid="input-total-budget" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="plan_start_date"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Plan Start Date</FormLabel>
                            <FormControl>
                              <Input type="date" data-testid="input-plan-start-date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                      <FormField
                        control={form.control}
                        name="plan_end_date"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Plan End Date</FormLabel>
                            <FormControl>
                              <Input type="date" data-testid="input-plan-end-date" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>
                    <DialogFooter>
                      <Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>Cancel</Button>
                      <Button type="submit" data-testid="button-add-participant" disabled={createParticipant.isPending}>
                        {createParticipant.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Add Participant
                      </Button>
                    </DialogFooter>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-500" />
              <Input 
                placeholder="Search name or NDIS..." 
                className="pl-9 bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search-participants"
              />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="bg-slate-50 dark:bg-slate-950 h-9">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
                <SelectItem value="expired">Expired</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {participantsLoading ? (
            Array(5).fill(0).map((_, i) => (
              <div key={i} className="p-3 space-y-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))
          ) : filteredParticipants.length === 0 ? (
            <div className="text-center py-8 text-slate-500">No participants found</div>
          ) : (
            filteredParticipants.map(p => (
              <button
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                data-testid={`button-participant-${p.id}`}
                className={`w-full text-left p-3 rounded-lg transition-colors flex flex-col gap-1.5 ${
                  selectedId === p.id 
                    ? "bg-primary/10 border-primary/20 border text-slate-900 dark:text-white" 
                    : "hover:bg-slate-50 dark:hover:bg-slate-800/50 border border-transparent text-slate-700 dark:text-slate-300"
                }`}
              >
                <div className="flex justify-between items-start w-full">
                  <span className="font-medium text-sm">{p.full_name}</span>
                  <Badge variant={p.plan_status === 'active' ? "default" : "secondary"} className="text-[10px] h-4 px-1.5">
                    {p.plan_status}
                  </Badge>
                </div>
                <span className="text-xs text-slate-500 font-mono">{p.ndis_number}</span>
              </button>
            ))
          )}
        </div>
      </div>

      <div className="flex-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-y-auto shadow-sm">
        {selectedId ? (
          <ParticipantDetail id={selectedId} />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-3">
            <Users className="h-12 w-12 opacity-20" />
            <p>Select a participant to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ParticipantDetail({ id }: { id: string }) {
  const { data: participant, isLoading } = useGetParticipant(id, { query: { enabled: !!id, queryKey: ['getParticipant', id] } });
  const { data: sessions, isLoading: sessionsLoading } = useGetParticipantSessions(id, { query: { enabled: !!id, queryKey: ['getParticipantSessions', id] } });
  const { data: aiSummary, isLoading: aiLoading } = useGetAISummary(id, { query: { enabled: !!id, queryKey: ['getAISummary', id] } });

  if (isLoading) {
    return <div className="p-8 space-y-6">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-32 w-full" />
    </div>;
  }

  if (!participant) return <div className="p-8">Participant not found</div>;

  const budgetPct = participant.total_budget && participant.used_budget 
    ? Math.min(100, Math.round((participant.used_budget / participant.total_budget) * 100))
    : 0;

  return (
    <div className="p-6 md:p-8 space-y-8">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-2xl font-bold tracking-tight mb-1">{participant.full_name}</h2>
          <div className="flex items-center gap-3 text-sm text-slate-500">
            <span className="font-mono bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded text-xs">{participant.ndis_number}</span>
            <span>•</span>
            <span className="flex items-center gap-1"><Calendar className="h-3.5 w-3.5" /> DOB: {participant.date_of_birth ? format(parseISO(participant.date_of_birth), 'MMM d, yyyy') : 'Unknown'}</span>
          </div>
        </div>
        <Link href={`/sessions/new?participantId=${id}`}>
          <Button size="sm">New Session</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <FileText className="h-4 w-4" /> Plan Details
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500">Status</span>
              <Badge variant={participant.plan_status === 'active' ? "default" : "secondary"}>
                {participant.plan_status.charAt(0).toUpperCase() + participant.plan_status.slice(1)}
              </Badge>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-slate-500">Dates</span>
              <span className="font-medium">
                {participant.plan_start_date ? format(parseISO(participant.plan_start_date), 'MMM yyyy') : '?'} - {participant.plan_end_date ? format(parseISO(participant.plan_end_date), 'MMM yyyy') : '?'}
              </span>
            </div>
            
            <div className="pt-2">
              <div className="flex justify-between items-center text-sm mb-2">
                <span className="text-slate-500">Budget Utilisation</span>
                <span className="font-medium">{budgetPct}%</span>
              </div>
              <Progress value={budgetPct} className="h-2" />
              <div className="flex justify-between text-xs text-slate-500 mt-1">
                <span>${participant.used_budget?.toLocaleString() ?? '0'} used</span>
                <span>${participant.total_budget?.toLocaleString() ?? '0'} total</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-slate-700 dark:text-slate-300">
              <Activity className="h-4 w-4" /> Clinical Profile
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <span className="text-slate-500 block mb-1">Primary Disability</span>
              <span className="font-medium">{participant.primary_disability || 'Not specified'}</span>
            </div>
            <div>
              <span className="text-slate-500 block mb-2 flex items-center gap-1"><Target className="h-3.5 w-3.5" /> Goals</span>
              {participant.goals && participant.goals.length > 0 ? (
                <ul className="space-y-1.5">
                  {participant.goals.map((g, i) => (
                    <li key={i} className="flex gap-2 text-slate-700 dark:text-slate-300">
                      <span className="text-primary mt-0.5">•</span>
                      <span className="leading-snug">{g}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <span className="text-slate-400 italic">No goals documented</span>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {aiSummary?.summary && (
        <Card className="bg-blue-50/50 dark:bg-blue-900/10 border-blue-100 dark:border-blue-900/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2 text-blue-800 dark:text-blue-300">
              <ShieldCheck className="h-4 w-4" /> AI Clinical Summary
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
              {aiSummary.summary}
            </p>
            <p className="text-xs text-blue-600/70 dark:text-blue-400/70 mt-3 font-medium">
              Based on {aiSummary.sessions_count} recent sessions
            </p>
          </CardContent>
        </Card>
      )}

      <div>
        <h3 className="font-semibold text-lg mb-4">Recent Sessions</h3>
        {sessionsLoading ? (
          <Skeleton className="h-32 w-full" />
        ) : sessions?.length === 0 ? (
          <div className="text-center p-8 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-500 bg-slate-50 dark:bg-slate-900/50">
            No sessions recorded yet
          </div>
        ) : (
          <div className="space-y-3">
            {sessions?.map(s => (
              <Link key={s.id} href={`/sessions/${s.id}`}>
                <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 hover:border-primary/30 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors cursor-pointer group">
                  <div className="flex justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-slate-100 group-hover:text-primary transition-colors">{s.session_type}</span>
                      <span className="text-sm text-slate-500 flex items-center gap-1">
                        <Clock className="h-3.5 w-3.5" />
                        {s.duration_minutes} min
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {s.status === 'draft' && <Badge variant="outline" className="text-amber-600 bg-amber-50">Draft</Badge>}
                      {s.compliance_score && (
                        <Badge variant="outline" className={s.compliance_score >= 80 ? "text-emerald-600 bg-emerald-50" : "text-amber-600 bg-amber-50"}>
                          {s.compliance_score}%
                        </Badge>
                      )}
                      <span className="text-sm text-slate-500">
                        {format(parseISO(s.session_date), 'MMM d, yyyy')}
                      </span>
                    </div>
                  </div>
                  {s.notes && (
                    <p className="text-sm text-slate-600 dark:text-slate-400 line-clamp-2 mt-2">
                      {s.notes}
                    </p>
                  )}
                  {s.tags && s.tags.length > 0 && (
                    <div className="flex gap-1.5 mt-3">
                      {s.tags.map(t => (
                        <span key={t} className="text-[10px] uppercase font-semibold tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-2 py-0.5 rounded">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}