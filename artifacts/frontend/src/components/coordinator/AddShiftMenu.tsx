import { useState, type ReactNode } from "react";
import { CalendarPlus, Repeat } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { getCoordinatorWorkerStats, type WorkerStats } from "@/services/coordinatorService";
import { ShiftAssignmentModal } from "./ShiftAssignmentModal";
import { BulkShiftModal } from "./BulkShiftModal";

/** "Add shift" for one participant: a single shift or a weekly pattern, with
 *  a worker now or left open to fill in Rostering. The forms only mount once
 *  chosen, so a list of participants doesn't load a form per row. */
export function AddShiftMenu({
  participant,
  children,
  align = "end",
}: {
  participant: { id: string; full_name: string };
  /** The trigger button. */
  children: ReactNode;
  align?: "start" | "end";
}) {
  const [mode, setMode] = useState<"one" | "repeating" | null>(null);
  const workersQuery = useOrgQuery<WorkerStats[]>(["coordinator", "worker-stats"], {
    queryFn: getCoordinatorWorkerStats,
    enabled: mode != null,
    staleTime: 60_000,
  });
  const workers = workersQuery.data ?? [];
  const firstName = participant.full_name.split(" ")[0];
  const close = (open: boolean) => { if (!open) setMode(null); };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
        <DropdownMenuContent align={align} className="w-72">
          <DropdownMenuLabel className="text-xs font-normal text-cc-muted">Add a shift for {firstName}</DropdownMenuLabel>
          <DropdownMenuItem onSelect={() => setMode("one")} className="items-start gap-3 py-2.5">
            <CalendarPlus size={16} className="mt-0.5 shrink-0" />
            <span>
              <span className="block text-sm font-medium">One shift</span>
              <span className="block text-xs text-cc-muted">Choose a worker now, or leave it open to fill later</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setMode("repeating")} className="items-start gap-3 py-2.5">
            <Repeat size={16} className="mt-0.5 shrink-0" />
            <span>
              <span className="block text-sm font-medium">Regular schedule</span>
              <span className="block text-xs text-cc-muted">The same days and times every week or fortnight, kept going</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {mode === "one" && (
        <ShiftAssignmentModal open onOpenChange={close} workers={workers} initialParticipantId={participant.id} />
      )}
      {mode === "repeating" && (
        <BulkShiftModal open onOpenChange={close} participants={[participant]} workers={workers} initialParticipantId={participant.id} />
      )}
    </>
  );
}
