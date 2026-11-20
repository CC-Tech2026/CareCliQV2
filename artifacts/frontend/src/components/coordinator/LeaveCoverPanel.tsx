/**
 * Shifts that need cover because the worker is on leave: grouped by person
 * and leave, soonest first. Each can be given to someone else straight away
 * (Find cover: the ranked suggestions, assign or offer), or made an open
 * shift so it shows with the others to fill.
 */
import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarOff, Loader2, Repeat } from "lucide-react";
import { SidePanel } from "@/components/layout/SidePanel";
import { Button } from "@/components/ui/button";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { detailIfShared, sharedNames } from "@/lib/person-identity";
import { appLocalDateKey, displayDate, formatAppTime } from "@/lib/datetime";
import {
  getLeaveClashes,
  releaseLeaveShifts,
  type CoordinatorShiftRecord,
  type LeaveClash,
  type WorkerStats,
} from "@/services/coordinatorService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

/** Shared by the roster's header button and this panel. */
export function useLeaveClashes(enabled = true) {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__";
  return useOrgQuery<{ shifts: LeaveClash[] }>([orgId, "coordinator", "leave-cover"], {
    queryFn: () => getLeaveClashes(),
    enabled,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
}

const dayText = (isoDate: string) => format(displayDate(isoDate), "EEE d MMM");
/** The shift's own day, in its participant's branch (as the roster shows it). */
const shiftDay = (c: LeaveClash) => dayText(appLocalDateKey(c.scheduled_start, c.timezone));

/** The shift as the roster's shift panel expects it, for Find cover. */
export function clashAsShift(c: LeaveClash): CoordinatorShiftRecord {
  return {
    id: c.shift_id,
    worker_id: c.worker_id,
    worker_name: c.worker_name,
    participant_id: c.participant_id ?? undefined,
    participant_name: c.participant_name,
    scheduled_start: c.scheduled_start,
    scheduled_end: c.scheduled_end,
    status: "scheduled",
    timezone: c.timezone,
    series_id: c.series_id,
  } as CoordinatorShiftRecord;
}

/** After leave is saved or approved: say how many shifts it leaves uncovered. */
export function leaveClashToast(count: number | undefined) {
  if (!count) return null;
  return {
    title: `${count} rostered shift${count === 1 ? " falls" : "s fall"} in their leave`,
    description: "Cover them from Leave clashes at the top of the roster.",
  };
}

export function LeaveCoverPanel({
  open, onOpenChange, workers, onFindCover,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workers: WorkerStats[];
  /** Open the shift's panel, with ranked workers to assign or offer it to. */
  onFindCover: (shift: CoordinatorShiftRecord) => void;
}) {
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__";
  const qc = useQueryClient();
  const { toast } = useToast();
  const query = useLeaveClashes(open);
  const shared = useMemo(() => sharedNames(workers.map((w) => w.full_name)), [workers]);
  const byId = useMemo(() => new Map(workers.map((w) => [w.id, w])), [workers]);

  // One group per person and leave.
  const groups = useMemo(() => {
    const map = new Map<string, LeaveClash[]>();
    for (const c of query.data?.shifts ?? []) {
      if (!c?.leave) continue;
      const key = `${c.worker_id}|${c.leave.start_date}|${c.leave.end_date}`;
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.values()];
  }, [query.data]);

  const release = useMutation({
    mutationFn: (ids: string[]) => releaseLeaveShifts(ids),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: [orgId, "coordinator"] });
      toast({
        title: `${res.released_count} shift${res.released_count === 1 ? " is" : "s are"} now open`,
        description: res.skipped.length
          ? `${res.skipped.length} had already changed and ${res.skipped.length === 1 ? "was" : "were"} left as ${res.skipped.length === 1 ? "it is" : "they are"}.`
          : "They're with the other open shifts to fill. The worker has been told.",
      });
    },
    onError: (err: Error) => toast({ title: "Couldn't open the shifts", description: err.message, variant: "destructive" }),
  });

  const total = query.data?.shifts?.length ?? 0;
  return (
    <SidePanel
      open={open}
      onOpenChange={onOpenChange}
      icon={CalendarOff}
      title="Leave clashes"
      description={total ? `${total} coming shift${total === 1 ? " is" : "s are"} rostered to someone on leave.` : "Shifts rostered to someone on leave show here."}
    >
      <div className="space-y-4">
        {query.isLoading && (
          <div role="status" className="flex items-center gap-2 py-8 text-[13px]" style={{ color: MUTED }}>
            <Loader2 size={15} className="animate-spin" /> Checking leave
          </div>
        )}
        {query.isError && (
          <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
            Leave couldn't be checked. {(query.error as Error)?.message}
          </p>
        )}
        {query.isSuccess && total === 0 && (
          <div className="rounded-xl border border-dashed px-4 py-8 text-center" style={{ borderColor: BORDER }}>
            <CalendarOff size={22} className="mx-auto mb-2" style={{ color: MUTED }} />
            <p className="text-[13px] font-semibold" style={{ color: TEXT }}>Nothing to cover</p>
            <p className="mt-1 text-[12px]" style={{ color: MUTED }}>No one is rostered on a day of their leave.</p>
          </div>
        )}

        {groups.map((items) => {
          const first = items[0];
          const w = byId.get(first.worker_id);
          const detail = w ? detailIfShared(w, shared) : null;
          const leave = first.leave;
          const label = `${first.worker_name}${detail ? ` · ${detail}` : ""}`;
          return (
            <section key={`${first.worker_id}|${leave.start_date}`} aria-label={`${first.worker_name}, on leave`} className="rounded-xl border" style={{ borderColor: BORDER }}>
              <header className="flex flex-wrap items-start justify-between gap-2 border-b px-4 py-3" style={{ borderColor: BORDER }}>
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold" style={{ color: TEXT }}>{label}</p>
                  <p className="text-[12px]" style={{ color: MUTED }}>
                    {leave.reason || "Leave"}: {leave.start_date === leave.end_date ? dayText(leave.start_date) : `${dayText(leave.start_date)} to ${dayText(leave.end_date)}`}
                  </p>
                </div>
                {items.length > 1 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full"
                    disabled={release.isPending}
                    onClick={() => release.mutate(items.map((c) => c.shift_id))}
                  >
                    Make all {items.length} open
                  </Button>
                )}
              </header>
              <ul className="divide-y" style={{ borderColor: BORDER }}>
                {items.map((c) => (
                  <li key={c.shift_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-[13px] font-medium" style={{ color: TEXT }}>
                        {c.series_id && <Repeat size={12} aria-label="Regular schedule" className="shrink-0" style={{ color: MUTED }} />}
                        {shiftDay(c)}, {formatAppTime(c.scheduled_start, c.timezone)}
                        {c.scheduled_end ? ` to ${formatAppTime(c.scheduled_end, c.timezone)}` : ""}
                      </p>
                      <p className="truncate text-[12px]" style={{ color: MUTED }}>{c.participant_name}</p>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      <Button
                        size="sm"
                        className="rounded-full text-white"
                        style={{ background: "var(--cc-cta)" }}
                        onClick={() => onFindCover(clashAsShift(c))}
                        aria-label={`Find cover for ${c.participant_name}, ${shiftDay(c)}`}
                      >
                        Find cover
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-full"
                        disabled={release.isPending}
                        onClick={() => release.mutate([c.shift_id])}
                        aria-label={`Make ${c.participant_name}, ${shiftDay(c)} an open shift`}
                      >
                        Make open
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </SidePanel>
  );
}
