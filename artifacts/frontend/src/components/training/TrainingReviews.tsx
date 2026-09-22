import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  getPendingTrainingCompletions,
  reviewTrainingCompletion,
} from "@/services/coordinatorService";

function completedDate(value: string | null | undefined) {
  if (!value) return "Date not recorded";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Date not recorded"
    : new Intl.DateTimeFormat("en-AU", {
        day: "numeric",
        month: "short",
        year: "numeric",
      }).format(date);
}

export function TrainingReviews() {
  const query = useOrgQuery(["training-completions", "pending"], {
    queryFn: getPendingTrainingCompletions,
  });
  const [busy, setBusy] = useState(false);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const { user } = useAuth();
  const client = useQueryClient();
  const { toast } = useToast();
  async function review(id: string, approved: boolean) {
    setBusy(true);
    try {
      await reviewTrainingCompletion(id, approved, reasons[id]?.trim());
      await query.refetch();
      void client.invalidateQueries({
        queryKey: [user?.organizationId, "worker", "training-history"],
      });
      toast({
        title: approved
          ? "Completion approved"
          : "Completion returned for revision",
      });
    } catch (error) {
      toast({
        title: "Could not review completion",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-4 sm:p-5">
      <div>
        <h3 className="font-bold">
          Completion reviews{" "}
          <span className="text-muted-foreground">
            {query.data?.length ?? ""}
          </span>
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Review workers’ submitted training and provide feedback when revision
          is needed.
        </p>
      </div>
      {query.isLoading && (
        <p role="status" className="text-sm">
          Loading reviews…
        </p>
      )}
      {query.isError && (
        <p role="alert" className="text-sm">
          Unable to load reviews.{" "}
          <button className="underline" onClick={() => void query.refetch()}>
            Try again
          </button>
        </p>
      )}
      {!query.isLoading && !query.isError && !query.data?.length && (
        <p className="text-sm text-muted-foreground">
          You’re all caught up. No completions awaiting review.
        </p>
      )}
      {query.data?.map((item) => (
        <div
          key={item.id}
          className="grid min-w-0 gap-4 rounded-xl border p-4 lg:grid-cols-2"
        >
          <div>
            <h4 className="break-words text-sm font-semibold">
              {item.training_modules?.title ?? "Training completion"}
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              {item.users?.full_name ?? "Worker"} · Completed{" "}
              {completedDate(item.completed_at)}
            </p>
            {item.note && <p className="mt-2 text-sm">{item.note}</p>}
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <label
              htmlFor={`review-feedback-${item.id}`}
              className="text-xs font-medium text-muted-foreground"
            >
              Feedback for the worker
            </label>
            <textarea
              id={`review-feedback-${item.id}`}
              rows={2}
              aria-label={`Revision feedback for ${item.users?.full_name ?? "worker"}`}
              value={reasons[item.id] ?? ""}
              onChange={(e) =>
                setReasons((prev) => ({ ...prev, [item.id]: e.target.value }))
              }
              className="w-full min-w-0 resize-y rounded-lg border bg-background p-3 text-sm"
              placeholder="Feedback required to request revision"
            />
            <button
              disabled={busy || !reasons[item.id]?.trim()}
              onClick={() => void review(item.id, false)}
              className="min-h-11 rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50"
            >
              Request revision
            </button>
            <button
              disabled={busy}
              onClick={() => void review(item.id, true)}
              className="min-h-11 rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
            >
              Approve
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
