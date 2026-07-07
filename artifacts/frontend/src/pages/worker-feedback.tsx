import { format, parseISO } from "date-fns";
import { MessageSquare } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRoute } from "wouter";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import { acknowledgeFeedback, getFeedbackDetail } from "@/services/workerPerformanceService";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

export default function WorkerFeedbackPage() {
  const { translate, translateParams } = useAccessibility();
  const [, params] = useRoute("/worker/feedback/:id");
  const feedbackId = params?.id ?? "";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useOrgQuery(
    ["worker", "feedback", feedbackId],
    { queryFn: () => getFeedbackDetail(feedbackId), enabled: !!feedbackId },
  );

  const ackMut = useMutation({
    mutationFn: () => acknowledgeFeedback(feedbackId),
    onSuccess: () => {
      toast({
        title: translate("feedback.gotItToast"),
        description: translate("feedback.gotItToastDesc"),
      });
      void queryClient.invalidateQueries({ queryKey: ["worker", "feedback"] });
      void queryClient.invalidateQueries({ queryKey: ["worker", "shift-history"] });
    },
    onError: (e: Error) =>
      toast({ title: translate("common.error"), description: e.message, variant: "destructive" }),
  });

  if (!feedbackId) return null;
  if (isLoading) {
    return (
      <div className="p-6 text-sm font-bold" style={{ color: MUTED }}>
        {translate("feedback.loading")}
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="p-6 text-sm font-bold text-red-600">
        {(error as Error)?.message ?? translate("feedback.notFound")}
      </div>
    );
  }

  const acknowledged = !!data.acknowledged_at;

  const sections = [
    { title: translate("feedback.strengths"), body: data.strengths, accent: "#059669", bg: "#ECFDF5" },
    { title: translate("feedback.improve"), body: data.areas_to_improve, accent: "#D97706", bg: "#FFFBEB" },
    { title: translate("feedback.actionItems"), body: data.action_items, accent: PLUM, bg: "#F8F6FE" },
  ];

  return (
    <div className="w-full space-y-6 pb-12">
      <header className="flex items-center gap-3">
        <div
          className="flex h-12 w-12 items-center justify-center rounded-2xl"
          style={{ background: "var(--cc-active)" }}
        >
          <MessageSquare size={24} style={{ color: PLUM }} />
        </div>
        <div>
          <p className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>
            {translate("feedback.title")}
          </p>
          <h1 className="text-xl font-black" style={{ color: TEXT }}>
            {translateParams("feedback.from", { name: data.coordinator_name ?? "" })}
          </h1>
          <p className="text-xs font-bold" style={{ color: MUTED }}>
            {data.submitted_at
              ? format(parseISO(data.submitted_at), "EEEE d MMMM yyyy")
              : ""}
          </p>
        </div>
      </header>

      <div className="space-y-4">
        {sections.map((section) => (
          <section
            key={section.title}
            className="rounded-2xl border p-5 shadow-sm"
            style={{ borderColor: BORDER, background: section.bg }}
          >
            <p className="text-[10px] font-black uppercase tracking-wider" style={{ color: section.accent }}>
              {section.title}
            </p>
            <p className="mt-2 text-sm font-medium leading-relaxed" style={{ color: TEXT }}>
              {section.body}
            </p>
          </section>
        ))}
      </div>

      {!acknowledged ? (
        <button
          type="button"
          onClick={() => ackMut.mutate()}
          disabled={ackMut.isPending}
          className="w-full rounded-2xl py-4 text-base font-black text-white shadow-md"
          style={{ background: "var(--cc-cta)" }}
        >
          {ackMut.isPending ? translate("feedback.saving") : translate("feedback.gotIt")}
        </button>
      ) : (
        <p className="text-center text-sm font-bold text-emerald-700">
          {translateParams("feedback.acknowledged", {
            date: format(parseISO(data.acknowledged_at!), "d MMM yyyy 'at' h:mm a"),
          })}
        </p>
      )}
    </div>
  );
}
