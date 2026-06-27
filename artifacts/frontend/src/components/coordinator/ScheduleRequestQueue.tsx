/**
 * Coordinator queue for worker schedule requests — CARECLIQV2-283
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { Check, X, Inbox } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  formatPreferredDays,
  listCoordinatorScheduleRequests,
  resolveCoordinatorScheduleRequest,
  timeOffReasonLabel,
  type ScheduleRequest,
} from "@/services/scheduleRequestService";

const PLUM = "var(--cc-plum)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

export function ScheduleRequestQueue() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [declineId, setDeclineId] = useState<string | null>(null);
  const [declineNote, setDeclineNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["coordinator", "schedule-requests", "pending"],
    queryFn: () => listCoordinatorScheduleRequests("pending"),
    staleTime: 30_000,
  });

  const resolveMut = useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: "approved" | "declined"; note?: string }) =>
      resolveCoordinatorScheduleRequest(id, { status, coordinator_notes: note }),
    onSuccess: () => {
      toast({ title: "Request updated" });
      setDeclineId(null);
      setDeclineNote("");
      void queryClient.invalidateQueries({ queryKey: ["coordinator", "schedule-requests"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const requests = data?.requests ?? [];

  if (isLoading) return null;
  if (!requests.length) return null;

  return (
    <div className="rounded-2xl border bg-cc-surface p-4" style={{ borderColor: BORDER }}>
      <div className="mb-3 flex items-center gap-2">
        <Inbox size={16} style={{ color: PLUM }} />
        <h3 className="text-sm font-black" style={{ color: TEXT }}>
          Pending schedule requests ({requests.length})
        </h3>
      </div>
      <div className="space-y-3">
        {requests.map((r) => (
          <RequestRow
            key={r.id}
            request={r}
            onApprove={() => resolveMut.mutate({ id: r.id, status: "approved" })}
            onDecline={() => setDeclineId(r.id)}
            loading={resolveMut.isPending}
          />
        ))}
      </div>
      {declineId && (
        <div className="mt-4 rounded-xl border bg-red-50 p-3" style={{ borderColor: "#FECACA" }}>
          <p className="text-xs font-black text-red-800 mb-2">Decline reason (required)</p>
          <textarea
            className="w-full rounded-lg border px-3 py-2 text-sm"
            rows={2}
            value={declineNote}
            onChange={(e) => setDeclineNote(e.target.value)}
          />
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={!declineNote.trim() || resolveMut.isPending}
              onClick={() => resolveMut.mutate({ id: declineId, status: "declined", note: declineNote })}
              className="rounded-full bg-red-600 px-4 py-2 text-xs font-black text-white disabled:opacity-50"
            >
              Confirm decline
            </button>
            <button type="button" onClick={() => { setDeclineId(null); setDeclineNote(""); }} className="text-xs font-bold" style={{ color: MUTED }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RequestRow({
  request,
  onApprove,
  onDecline,
  loading,
}: {
  request: ScheduleRequest;
  onApprove: () => void;
  onDecline: () => void;
  loading: boolean;
}) {
  let detail = request.request_type.replace(/_/g, " ");
  if (request.time_off) {
    detail = `${timeOffReasonLabel(request.time_off.reason_code)} · ${request.time_off.start_date} – ${request.time_off.end_date}`;
  } else if (request.preferred_shift) {
    detail = `Preferred: ${formatPreferredDays(request.preferred_shift.preferred_days)}`;
  } else if (request.shift_swap) {
    detail = `Swap shift ${request.shift_swap.shift_id?.slice(0, 8)}…`;
  }

  return (
    <div className="flex flex-wrap items-start justify-between gap-2 rounded-xl border px-3 py-2" style={{ borderColor: BORDER }}>
      <div className="min-w-0">
        <p className="text-xs font-black capitalize" style={{ color: PLUM }}>{request.request_type.replace(/_/g, " ")}</p>
        <p className="text-sm font-semibold" style={{ color: TEXT }}>{detail}</p>
        {request.worker_notes && <p className="text-xs mt-0.5" style={{ color: MUTED }}>{request.worker_notes}</p>}
        <p className="text-[10px] mt-1" style={{ color: MUTED }}>
          {format(parseISO(request.created_at), "d MMM yyyy h:mm a")}
        </p>
      </div>
      <div className="flex gap-1">
        <button type="button" disabled={loading} onClick={onApprove} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-[10px] font-black text-white">
          <Check size={12} /> Approve
        </button>
        <button type="button" disabled={loading} onClick={onDecline} className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[10px] font-black text-red-700">
          <X size={12} /> Decline
        </button>
      </div>
    </div>
  );
}
