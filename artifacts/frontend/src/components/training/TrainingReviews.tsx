import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  getPendingTrainingCompletions,
  reviewTrainingCompletion,
} from "@/services/coordinatorService";

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
    <section className="space-y-3 rounded-2xl border bg-card p-5">
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
        <div key={item.id} className="space-y-3 rounded-xl border p-4">
          <div>
            <h4 className="text-sm font-bold">
              {item.training_modules?.title ?? "Training completion"}
            </h4>
            <p className="mt-1 text-xs text-muted-foreground">
              {item.users?.full_name ?? "Worker"} · Completed{" "}
              {item.completed_at}
            </p>
            {item.note && <p className="mt-2 text-sm">{item.note}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              aria-label={`Revision feedback for ${item.users?.full_name ?? "worker"}`}
              value={reasons[item.id] ?? ""}
              onChange={(e) =>
                setReasons((prev) => ({ ...prev, [item.id]: e.target.value }))
              }
              className="min-w-0 flex-1 rounded-lg border bg-background p-2 text-sm"
              placeholder="Feedback required to request revision"
            />
            <button
              disabled={busy || !reasons[item.id]?.trim()}
              onClick={() => void review(item.id, false)}
              className="rounded-lg border px-3 py-2 text-xs font-bold disabled:opacity-50"
            >
              Request revision
            </button>
            <button
              disabled={busy}
              onClick={() => void review(item.id, true)}
              className="rounded-lg bg-primary px-3 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
            >
              Approve
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
