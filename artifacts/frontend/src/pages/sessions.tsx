import { useState } from "react";
import { useGetSessions } from "@workspace/api-client-react";
import { format, parseISO, isAfter, isBefore, isEqual, startOfDay, endOfDay } from "date-fns";
import { Link, useLocation } from "wouter";
import {
  Search,
  Plus,
  Calendar,
  Clock,
  ShieldCheck,
  ChevronRight,
  Play,
  FileDown,
  Loader2,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { exportBulkSessionsPDF } from "@/lib/pdf-export";

export default function Sessions() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isBulkExporting, setIsBulkExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: sessions, isLoading } = useGetSessions();

  const filteredSessions =
    sessions?.filter((s) => {
      const matchesSearch =
        s.participants?.full_name
          ?.toLowerCase()
          .includes(search.toLowerCase()) ||
        s.session_type.toLowerCase().includes(search.toLowerCase());
      const matchesStatus = statusFilter === "all" || s.status === statusFilter;

      let matchesDateFrom = true;
      let matchesDateTo = true;
      if (dateFrom) {
        const from = startOfDay(parseISO(dateFrom));
        const sessionDate = startOfDay(parseISO(s.session_date));
        matchesDateFrom = isAfter(sessionDate, from) || isEqual(sessionDate, from);
      }
      if (dateTo) {
        const to = endOfDay(parseISO(dateTo));
        const sessionDate = startOfDay(parseISO(s.session_date));
        matchesDateTo = isBefore(sessionDate, to) || isEqual(sessionDate, to);
      }

      return matchesSearch && matchesStatus && matchesDateFrom && matchesDateTo;
    }) || [];

  const allFilteredIds = filteredSessions.map((s) => s.id);
  const allSelected =
    filteredSessions.length > 0 &&
    filteredSessions.every((s) => selectedIds.has(s.id));
  const someSelected = selectedIds.size > 0;

  const toggleSession = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allFilteredIds.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allFilteredIds.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkExportPDF = async () => {
    if (selectedIds.size === 0) return;
    setIsBulkExporting(true);
    setExportProgress({ done: 0, total: selectedIds.size });
    try {
      await exportBulkSessionsPDF(Array.from(selectedIds), (done, total) => {
        setExportProgress({ done, total });
      });
      const count = selectedIds.size;
      toast({
        title: "PDF exported",
        description: `Bulk audit report for ${count} session${count !== 1 ? "s" : ""} downloaded.`,
      });
      clearSelection();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast({ title: "Export failed", description: msg, variant: "destructive" });
    } finally {
      setIsBulkExporting(false);
      setExportProgress(null);
    }
  };

  const hasDateFilter = dateFrom || dateTo;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Clinical Sessions
          </h1>
          <p className="text-muted-foreground">
            Manage your clinical notes and compliance records.
          </p>
        </div>
        <Link href="/sessions/new">
          <Button className="gap-2" data-testid="button-new-session">
            <Plus className="h-4 w-4" /> New Session
          </Button>
        </Link>
      </div>

      <div className="bg-card border rounded-xl shadow-sm">
        {/* Filter bar */}
        <div className="p-4 border-b flex flex-col gap-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search participant or session type..."
                className="pl-9"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-40">
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

          {/* Date range filter */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-sm text-muted-foreground whitespace-nowrap">Date range:</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Input
                type="date"
                className="w-36 text-sm"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                aria-label="From date"
              />
              <span className="text-muted-foreground text-sm">to</span>
              <Input
                type="date"
                className="w-36 text-sm"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                aria-label="To date"
              />
              {hasDateFilter && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 px-2 text-muted-foreground"
                  onClick={() => { setDateFrom(""); setDateTo(""); }}
                >
                  <X className="h-3.5 w-3.5 mr-1" /> Clear
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Bulk action bar */}
        {someSelected && (
          <div className="px-4 py-2.5 border-b bg-primary/5 flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-sm font-medium text-primary">
                {selectedIds.size} session{selectedIds.size !== 1 ? "s" : ""} selected
              </span>
              {exportProgress && (
                <span className="text-xs text-primary/70">
                  — generating {exportProgress.done}/{exportProgress.total}...
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5 text-primary border-primary/30 hover:bg-primary/10 font-medium"
                onClick={handleBulkExportPDF}
                disabled={isBulkExporting}
                data-testid="button-bulk-export-pdf"
              >
                {isBulkExporting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <FileDown className="h-3.5 w-3.5" />
                )}
                {isBulkExporting ? "Exporting..." : "Export PDF Report"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground"
                onClick={clearSelection}
              >
                <X className="h-3.5 w-3.5 mr-1" />
                Deselect all
              </Button>
            </div>
          </div>
        )}

        <div className="divide-y divide-border">
          {/* Select-all header row */}
          {!isLoading && filteredSessions.length > 0 && (
            <div className="px-4 py-2 flex items-center gap-3 bg-muted/40">
              <Checkbox
                checked={allSelected ? true : someSelected ? "indeterminate" : false}
                onCheckedChange={toggleSelectAll}
                aria-label="Select all sessions"
                data-testid="checkbox-select-all"
              />
              <span className="text-xs text-muted-foreground font-medium">
                {allSelected ? "Deselect all" : `Select all ${filteredSessions.length} session${filteredSessions.length !== 1 ? "s" : ""}`}
              </span>
            </div>
          )}

          {isLoading ? (
            Array(5)
              .fill(0)
              .map((_, i) => (
                <div key={i} className="p-4 flex justify-between items-center">
                  <div className="space-y-2">
                    <Skeleton className="h-5 w-48" />
                    <Skeleton className="h-4 w-32" />
                  </div>
                  <Skeleton className="h-8 w-24" />
                </div>
              ))
          ) : filteredSessions.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Calendar className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-lg font-medium text-foreground mb-1">
                No sessions found
              </p>
              <p className="text-sm">
                Try adjusting your filters or create a new session.
              </p>
            </div>
          ) : (
            filteredSessions.map((session) => (
              <div
                key={session.id}
                className={`p-4 hover:bg-muted/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4 group ${
                  selectedIds.has(session.id) ? "bg-primary/5" : ""
                }`}
              >
                <div
                  className="flex items-start sm:items-center gap-3 flex-1 min-w-0 cursor-pointer"
                  onClick={() => navigate(`/sessions/${session.id}`)}
                >
                  <div
                    className="mt-0.5 sm:mt-0 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      checked={selectedIds.has(session.id)}
                      onCheckedChange={() => toggleSession(session.id)}
                      aria-label={`Select session for ${session.participants?.full_name ?? "participant"}`}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold text-foreground group-hover:text-primary transition-colors truncate">
                        {session.participants?.full_name || "Unknown Participant"}
                      </span>
                      <span className="text-border">•</span>
                      <span className="text-sm font-medium text-muted-foreground truncate">
                        {session.session_type}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(parseISO(session.session_date), "MMM d, yyyy")}
                      </span>
                      <span className="flex items-center gap-1.5 whitespace-nowrap">
                        <Clock className="h-3.5 w-3.5" />
                        {session.duration_minutes} min
                      </span>
                      {session.tags && session.tags.length > 0 && (
                        <div className="flex items-center gap-1.5">
                          <span className="text-border hidden sm:inline">•</span>
                          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                            {session.tags[0]}{session.tags.length > 1 && ` +${session.tags.length - 1}`}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-end sm:self-auto shrink-0 pl-7 sm:pl-0" onClick={e => e.stopPropagation()}>
                  {session.status === "draft" ? (
                    <Badge variant="outline" className="bg-secondary text-secondary-foreground border-secondary-foreground/20">Draft</Badge>
                  ) : session.compliance_score ? (
                    <Badge
                      variant="outline"
                      className={`flex items-center gap-1 border-transparent ${
                        session.compliance_score >= 80
                          ? "bg-[#D1E13D]/25 text-[#3d4700]"
                          : session.compliance_score >= 60
                            ? "bg-[#F58BCD]/20 text-[#7a1850]"
                            : "bg-destructive/10 text-destructive"
                      }`}
                    >
                      <ShieldCheck className="h-3 w-3" />
                      {session.compliance_score}%
                    </Badge>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 text-primary border-primary/30 hover:bg-primary/10 hover:border-primary/50 font-medium"
                    onClick={() => navigate(`/sessions/${session.id}/live`)}
                  >
                    <Play className="h-3.5 w-3.5 fill-primary" />
                    Start Live
                  </Button>
                  <ChevronRight
                    className="h-5 w-5 text-muted-foreground/40 group-hover:text-primary transition-colors cursor-pointer"
                    onClick={() => navigate(`/sessions/${session.id}`)}
                  />
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
