import { useMemo, useState } from "react";
import { CheckCircle2, ChevronRight, Circle, ClipboardList, Link2, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import { SectionInfo } from "@/components/ui/section-info";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import { completeMyInductionItem, getMyInduction, type InductionItem } from "@/services/inductionService";

export default function WorkerInductionPage() {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const queryClient = useQueryClient();
  const [openItemId, setOpenItemId] = useState<string | null>(null);

  const progressQuery = useOrgQuery(["worker", "induction"], { queryFn: getMyInduction });
  const items = useMemo(
    () => [...(progressQuery.data?.items ?? [])].sort((a, b) => a.sort_order - b.sort_order),
    [progressQuery.data],
  );
  const mandatoryTotal = progressQuery.data?.mandatory_total ?? 0;
  const mandatoryComplete = progressQuery.data?.mandatory_complete ?? 0;

  const completeMut = useMutation({
    mutationFn: (itemId: string) => completeMyInductionItem(itemId),
    onSuccess: () => {
      toast({ title: "Induction item completed" });
      setOpenItemId(null);
      void queryClient.invalidateQueries({ queryKey: [orgId, "worker", "induction"] });
      void queryClient.invalidateQueries({ queryKey: ["worker", "onboarding"] });
    },
    onError: (e: Error) => toast({ title: "Failed to complete item", description: e.message, variant: "destructive" }),
  });

  const openItem = items.find((i) => i.id === openItemId) ?? null;

  return (
    <div className="w-full space-y-5 pb-12">
      <header>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: PLUM }}>
          {translate("induction.eyebrow") || "Getting started"}
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-3xl font-black tracking-tight" style={{ color: TEXT }}>
          {translate("induction.title") || "Induction"}
          <SectionInfo text="Your checklist for getting set up: required reading, policies, and first steps before your first shift." />
        </h1>
      </header>

      {!openItem && (
        <div className="rounded-2xl border bg-card p-4" style={{ borderColor: BORDER }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-black uppercase tracking-wide" style={{ color: MUTED }}>Mandatory items complete</p>
            <p className="text-sm font-black tabular-nums" style={{ color: TEXT }}>
              {mandatoryComplete} / {mandatoryTotal}
            </p>
          </div>
          <div className="mt-2 h-1.5 rounded-full" style={{ background: "var(--cc-soft)" }}>
            <div
              className="h-1.5 rounded-full"
              style={{
                width: mandatoryTotal ? `${(mandatoryComplete / mandatoryTotal) * 100}%` : "0%",
                background: mandatoryComplete >= mandatoryTotal && mandatoryTotal > 0 ? "#10B981" : PLUM,
              }}
            />
          </div>
        </div>
      )}

      {openItem ? (
        <InductionItemDetail
          item={openItem}
          onBack={() => setOpenItemId(null)}
          onComplete={() => completeMut.mutate(openItem.id)}
          completing={completeMut.isPending}
        />
      ) : progressQuery.isLoading ? (
        <p className="py-8 text-center text-sm font-medium" style={{ color: MUTED }}>{translate("common.loading")}</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border bg-card p-8 text-center" style={{ borderColor: BORDER }}>
          <ClipboardList size={26} className="mx-auto mb-2" style={{ color: MUTED }} />
          <p className="text-sm font-medium" style={{ color: MUTED }}>Nothing to complete yet.</p>
        </div>
      ) : (
        <div className="rounded-2xl border divide-y bg-card" style={{ borderColor: BORDER }}>
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setOpenItemId(item.id)}
              className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-cc-bg"
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                style={{ background: "var(--cc-soft)" }}
              >
                {item.completed_at ? (
                  <CheckCircle2 size={15} style={{ color: "#10B981" }} />
                ) : (
                  <Circle size={15} style={{ color: PLUM }} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold truncate" style={{ color: TEXT }}>{item.title}</p>
                <p className="text-xs mt-0.5 truncate" style={{ color: MUTED }}>
                  {item.completed_at ? "Completed" : item.is_mandatory ? "Mandatory" : "Optional"}
                </p>
              </div>
              {!item.is_mandatory && !item.completed_at && (
                <span className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase" style={{ background: "var(--cc-soft)", color: MUTED }}>
                  Optional
                </span>
              )}
              <ChevronRight size={16} style={{ color: MUTED }} className="shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function InductionItemDetail({
  item,
  onBack,
  onComplete,
  completing,
}: {
  item: InductionItem;
  onBack: () => void;
  onComplete: () => void;
  completing: boolean;
}) {
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-black" style={{ color: PLUM }}>
        <X size={14} /> Back to induction
      </button>

      <section className="rounded-2xl border bg-card p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--cc-soft)" }}>
            <ClipboardList size={17} style={{ color: PLUM }} />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-black" style={{ color: TEXT }}>{item.title}</h2>
            {item.description && (
              <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>{item.description}</p>
            )}
          </div>
        </div>

        {item.content_url && (
          <a
            href={item.content_url}
            target="_blank"
            rel="noreferrer"
            className="mt-4 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition hover:bg-cc-bg"
            style={{ color: PLUM, background: "var(--cc-bg)" }}
          >
            <Link2 size={16} /> Open resource
          </a>
        )}

        {item.completed_at ? (
          <div className="mt-5 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-bold" style={{ background: "#ECFDF5", color: "#059669" }}>
            <CheckCircle2 size={16} /> Completed
          </div>
        ) : (
          <button
            type="button"
            onClick={onComplete}
            disabled={completing}
            className="mt-5 w-full rounded-full py-2.5 text-sm font-black text-white disabled:opacity-50"
            style={{ background: PLUM }}
          >
            {completing ? "Saving…" : "Mark complete"}
          </button>
        )}
      </section>
    </div>
  );
}
