import { useState } from "react";
import { useGetSessions } from "@workspace/api-client-react";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import { Search, Plus, Calendar, Clock, ShieldCheck, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function Sessions() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  
  const { data: sessions, isLoading } = useGetSessions();

  const filteredSessions = sessions?.filter(s => {
    const matchesSearch = s.participants?.full_name?.toLowerCase().includes(search.toLowerCase()) || 
                          s.session_type.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || s.status === statusFilter;
    return matchesSearch && matchesStatus;
  }) || [];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Clinical Sessions</h1>
          <p className="text-slate-500 dark:text-slate-400">Manage your clinical notes and compliance records.</p>
        </div>
        <Link href="/sessions/new">
          <Button className="gap-2" data-testid="button-new-session">
            <Plus className="h-4 w-4" /> New Session
          </Button>
        </Link>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-sm">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-500" />
            <Input 
              placeholder="Search participant or session type..." 
              className="pl-9 bg-slate-50 dark:bg-slate-950"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div className="w-full sm:w-48">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sessions</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="draft">Drafts</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {isLoading ? (
            Array(5).fill(0).map((_, i) => (
              <div key={i} className="p-4 flex justify-between items-center">
                <div className="space-y-2">
                  <Skeleton className="h-5 w-48" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <Skeleton className="h-8 w-24" />
              </div>
            ))
          ) : filteredSessions.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <Calendar className="h-12 w-12 mx-auto mb-3 opacity-20 text-slate-400" />
              <p className="text-lg font-medium text-slate-900 dark:text-slate-100 mb-1">No sessions found</p>
              <p className="text-sm">Try adjusting your filters or create a new session.</p>
            </div>
          ) : (
            filteredSessions.map(session => (
              <Link key={session.id} href={`/sessions/${session.id}`}>
                <div className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4 group cursor-pointer">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-slate-900 dark:text-slate-100 group-hover:text-primary transition-colors truncate">
                        {session.participants?.full_name || 'Unknown Participant'}
                      </span>
                      <span className="text-slate-300 dark:text-slate-700">•</span>
                      <span className="text-sm font-medium text-slate-600 dark:text-slate-400 truncate">
                        {session.session_type}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-500">
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(parseISO(session.session_date), 'MMM d, yyyy')}
                      </span>
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <Clock className="h-3.5 w-3.5" />
                        {session.duration_minutes} min
                      </span>
                      {session.tags && session.tags.length > 0 && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">•</span>
                          <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
                            {session.tags[0]}
                            {session.tags.length > 1 && ` +${session.tags.length - 1}`}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 self-end sm:self-auto shrink-0">
                    {session.status === 'draft' ? (
                      <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">
                        Draft
                      </Badge>
                    ) : session.compliance_score ? (
                      <Badge variant="outline" className={`flex items-center gap-1 border-transparent ${
                        session.compliance_score >= 80 ? "bg-emerald-100 text-emerald-800" :
                        session.compliance_score >= 60 ? "bg-amber-100 text-amber-800" :
                        "bg-destructive/10 text-destructive"
                      }`}>
                        <ShieldCheck className="h-3 w-3" />
                        {session.compliance_score}%
                      </Badge>
                    ) : null}
                    <ChevronRight className="h-5 w-5 text-slate-300 group-hover:text-primary transition-colors" />
                  </div>
                </div>
              </Link>
            ))
          )}
        </div>
      </div>
    </div>
  );
}