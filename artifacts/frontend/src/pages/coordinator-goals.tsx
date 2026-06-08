import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CalendarDays, ChevronDown, ChevronUp, Loader2,
  Search, Target, User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getCoordinatorGoals,
  type ParticipantGoalGroup,
  type GoalStatus,
} from "@/services/coordinatorService";
import { jsonFetch } from "@/services/http";

const PLUM  = "#5533CC";
const CORAL = "#F03060";
const TEXT  = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";

type FilterKey = "all" | "stalled" | "blocked" | "no_session";

const STATUS_META: Record<GoalStatus, { label: string; color: string; bg: string }> = {
  progressing: { label: "Progressing",  color: "#059669", bg: "#ECFDF5" },
  achieved:    { label: "Achieved",     color: "#7C3AED", bg: "#F5F3FF" },
  stalled:     { label: "Stalled",      color: "#D97706", bg: "#FFFBEB" },
  blocked:     { label: "Blocked",      color: "#DC2626", bg: "#FEF2F2" },
  general:     { label: "Active",       color: "#5533CC", bg: "#F5F3FC" },
};

function statusMeta(s?: GoalStatus) {
  return STATUS_META[s ?? "general"] ?? STATUS_META.general;
}

function CategoryChip({ category }: { category: string }) {
  const map: Record<string, { label: string; bg: string; color: string }> = {
    core:              { label: "Core",              bg: "#EFF6FF", color: "#1D4ED8" },
    capacity_building: { label: "Capacity Building", bg: "#F0FDF4", color: "#15803D" },
    capital:           { label: "Capital",           bg: "#FDF4FF", color: "#7E22CE" },
    general:           { label: "General",           bg: "#F5F3FC", color: "#5533CC" },
  };
  const meta = map[category.toLowerCase()] ?? map.general;
  return (
    <span
      className="rounded-full px-2 py-0.5 text-[10px] font-black uppercase"
      style={{ background: meta.bg, color: meta.color }}
    >
      {meta.label}
    </span>
  );
}

function ScheduleReviewDialog({
  group,
  open,
  onClose,
}: {
  group: ParticipantGoalGroup;
  open: boolean;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reviewDate, setReviewDate] = useState(group.upcoming_review_date ?? "");

  const mutation = useMutation({
    mutationFn: () =>
      jsonFetch(`/api/participants/${group.participant_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upcoming_review_date: reviewDate }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coordinator-goals"] });
      toast({ title: "Review scheduled", description: `Set for ${reviewDate}` });
      onClose();
    },
    onError: (err) =>
      toast({ title: "Could not save", description: (err as Error).message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-sm rounded-2xl">
        <DialogHeader>
          <DialogTitle className="text-[#1E1640]">Schedule Goal Review</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-[#7A6A9E]">
          Set a review date for <strong>{group.participant_name}</strong>.
        </p>
        <div className="mt-2">
          <Label>Review date</Label>
          <Input
            type="date"
            className="mt-1 rounded-xl"
            value={reviewDate}
            onChange={(e) => setReviewDate(e.target.value)}
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" className="rounded-xl" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!reviewDate || mutation.isPending}
            className="rounded-xl gap-1"
            style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarDays className="h-4 w-4" />}
            Save
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ParticipantCard({ group }: { group: ParticipantGoalGroup }) {
  const [expanded, setExpanded] = useState(true);
  const [scheduling, setScheduling] = useState(false);

  const hasStalled = group.goals.some((g) => g.status === "stalled");
  const hasBlocked = group.goals.some((g) => g.status === "blocked");

  return (
    <>
      {scheduling && (
        <ScheduleReviewDialog group={group} open onClose={() => setScheduling(false)} />
      )}
      <div className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
        <div
          className="flex cursor-pointer items-center justify-between gap-3 px-5 py-4"
          onClick={() => setExpanded((v) => !v)}
        >
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ background: "#EDEAFF" }}>
              <User className="h-4 w-4" style={{ color: PLUM }} />
            </div>
            <div className="min-w-0">
              <p className="font-black text-[#1E1640]">{group.participant_name}</p>
              <p className="text-xs text-[#7A6A9E]">
                {group.ndis_number ? `NDIS ${group.ndis_number}` : "No NDIS number"}
                {group.assigned_worker ? ` · ${group.assigned_worker}` : ""}
              </p>
            </div>
            {hasBlocked && (
              <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-black uppercase text-red-700">Blocked</span>
            )}
            {!hasBlocked && hasStalled && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black uppercase text-amber-700">Stalled</span>
            )}
            {group.upcoming_review_date && (
              <span className="flex items-center gap-1 text-xs text-[#7A6A9E]">
                <CalendarDays className="h-3 w-3" />
                Review {group.upcoming_review_date}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="rounded-xl gap-1 text-xs"
              onClick={(e) => { e.stopPropagation(); setScheduling(true); }}
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Schedule Review
            </Button>
            {expanded ? <ChevronUp className="h-4 w-4 text-[#7A6A9E]" /> : <ChevronDown className="h-4 w-4 text-[#7A6A9E]" />}
          </div>
        </div>

        {expanded && (
          <div className="border-t px-5 pb-4 pt-3" style={{ borderColor: BORDER }}>
            {group.goals.length === 0 ? (
              <p className="text-sm text-[#7A6A9E]">No active goals recorded.</p>
            ) : (
              <div className="space-y-2">
                {group.goals.map((goal) => {
                  const sm = statusMeta(goal.status);
                  return (
                    <div
                      key={goal.id}
                      className="flex flex-wrap items-start justify-between gap-2 rounded-xl border px-4 py-3"
                      style={{ borderColor: BORDER }}
                    >
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <p className="text-sm font-semibold text-[#1E1640]">{goal.description}</p>
                        <div className="flex flex-wrap gap-1.5">
                          <CategoryChip category={goal.category} />
                          {goal.target_date && (
                            <span className="text-[10px] text-[#7A6A9E]">Target: {goal.target_date}</span>
                          )}
                        </div>
                      </div>
                      <span
                        className="shrink-0 rounded-full px-2.5 py-1 text-[11px] font-black uppercase"
                        style={{ background: sm.bg, color: sm.color }}
                      >
                        {sm.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            {group.last_session_date && (
              <p className="mt-3 text-xs text-[#7A6A9E]">Last session: {group.last_session_date}</p>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export default function CoordinatorGoals() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterKey>("all");

  const { data = [], isLoading, error } = useQuery({
    queryKey: ["coordinator-goals"],
    queryFn: getCoordinatorGoals,
  });

  const filtered = useMemo(() => {
    let list = data;

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((g) => g.participant_name.toLowerCase().includes(q));
    }

    if (filter === "stalled") {
      list = list.filter((g) => g.goals.some((gl) => gl.status === "stalled"));
    } else if (filter === "blocked") {
      list = list.filter((g) => g.goals.some((gl) => gl.status === "blocked"));
    } else if (filter === "no_session") {
      list = list.filter((g) => !g.last_session_date);
    }

    return list.filter((g) => g.goals.length > 0 || filter === "all");
  }, [data, search, filter]);

  const totalGoals = data.reduce((sum, g) => sum + g.goals.length, 0);
  const stalledCount = data.filter((g) => g.goals.some((gl) => gl.status === "stalled")).length;
  const blockedCount = data.filter((g) => g.goals.some((gl) => gl.status === "blocked")).length;

  const FILTERS: { key: FilterKey; label: string }[] = [
    { key: "all",        label: "All participants" },
    { key: "stalled",    label: `Stalled (${stalledCount})` },
    { key: "blocked",    label: `Blocked (${blockedCount})` },
    { key: "no_session", label: "No Recent Session" },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-10">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
          Coordinator
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>
          Goals & Planning
        </h1>
        <p className="mt-1 text-sm" style={{ color: MUTED }}>
          All participant goals across your team — track progress and schedule reviews.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {[
          ["Participants", data.length],
          ["Total Goals",  totalGoals],
          ["Need Attention", stalledCount + blockedCount],
        ].map(([label, value]) => (
          <div key={String(label)} className="rounded-2xl border bg-white p-4 shadow-sm" style={{ borderColor: BORDER }}>
            <p className="text-xs font-bold uppercase text-[#7A6A9E]">{label}</p>
            <p className="mt-1 text-2xl font-black" style={{ color: TEXT }}>{value}</p>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1" style={{ minWidth: 200 }}>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#7A6A9E]" />
          <Input
            placeholder="Search by participant name…"
            className="rounded-xl pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className="rounded-full border px-3 py-1.5 text-xs font-bold transition-colors"
              style={
                filter === key
                  ? { background: PLUM, color: "#fff", borderColor: PLUM }
                  : { background: "#fff", color: MUTED, borderColor: BORDER }
              }
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {isLoading && (
        <div className="flex items-center gap-2 py-10 text-sm font-bold" style={{ color: MUTED }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading participant goals…
        </div>
      )}

      {error && (
        <p className="rounded-xl bg-red-50 p-4 text-sm font-bold text-red-700">
          {(error as Error).message}
        </p>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="rounded-2xl border bg-white px-6 py-12 text-center shadow-sm" style={{ borderColor: BORDER }}>
          <Target className="mx-auto h-10 w-10 text-[#C4B8F0]" />
          <p className="mt-3 font-black text-[#1E1640]">No goals found</p>
          <p className="mt-1 text-sm text-[#7A6A9E]">
            {search ? "Try a different search term." : "Add goals to participant NDIS plans to see them here."}
          </p>
        </div>
      )}

      <div className="space-y-4">
        {filtered.map((group) => (
          <ParticipantCard key={group.participant_id} group={group} />
        ))}
      </div>
    </div>
  );
}
