import { useState } from "react";
import { CheckCircle2, ChevronRight, Circle, FileText, X } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useAuth } from "@/contexts/AuthContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import { SectionInfo } from "@/components/ui/section-info";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import {
  acknowledgeWorkerPolicy,
  listWorkerPolicies,
  openWorkerPolicyFile,
  type WorkerPolicy,
} from "@/services/workerPolicyService";

export default function WorkerPoliciesPage() {
  const { translate } = useAccessibility();
  const { toast } = useToast();
  const { user } = useAuth();
  const orgId = user?.organizationId ?? "__no_org__";
  const queryClient = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);

  const policiesQuery = useOrgQuery(["worker", "policies"], {
    queryFn: async () => (await listWorkerPolicies()).policies,
  });
  const policies = policiesQuery.data ?? [];
  const total = policies.length;
  const acknowledged = policies.filter((p) => p.acknowledged).length;

  const ackMut = useMutation({
    mutationFn: (documentId: string) => acknowledgeWorkerPolicy(documentId),
    onSuccess: () => {
      toast({ title: "Policy acknowledged" });
      setOpenId(null);
      void queryClient.invalidateQueries({ queryKey: [orgId, "worker", "policies"] });
    },
    onError: (e: Error) => toast({ title: "Could not acknowledge", description: e.message, variant: "destructive" }),
  });

  const openPolicy = policies.find((p) => p.id === openId) ?? null;

  return (
    <div className="w-full space-y-5 pb-12">
      <header>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: PLUM }}>
          {translate("policies.eyebrow") || "Compliance"}
        </p>
        <h1 className="mt-1 flex items-center gap-2 text-3xl font-black tracking-tight" style={{ color: TEXT }}>
          {translate("policies.title") || "Policies"}
          <SectionInfo text="Organisation policies you've been asked to read and acknowledge." />
        </h1>
      </header>

      {!openPolicy && total > 0 && (
        <div className="rounded-2xl border bg-card p-4" style={{ borderColor: BORDER }}>
          <div className="flex items-center justify-between">
            <p className="text-xs font-black uppercase tracking-wide" style={{ color: MUTED }}>Acknowledged</p>
            <p className="text-sm font-black tabular-nums" style={{ color: TEXT }}>
              {acknowledged} / {total}
            </p>
          </div>
          <div className="mt-2 h-1.5 rounded-full" style={{ background: "var(--cc-soft)" }}>
            <div
              className="h-1.5 rounded-full"
              style={{
                width: total ? `${(acknowledged / total) * 100}%` : "0%",
                background: acknowledged >= total && total > 0 ? "#10B981" : PLUM,
              }}
            />
          </div>
        </div>
      )}

      {openPolicy ? (
        <PolicyDetail
          policy={openPolicy}
          onBack={() => setOpenId(null)}
          onAcknowledge={() => ackMut.mutate(openPolicy.id)}
          acknowledging={ackMut.isPending}
        />
      ) : policiesQuery.isLoading ? (
        <p className="py-8 text-center text-sm font-medium" style={{ color: MUTED }}>{translate("common.loading")}</p>
      ) : policies.length === 0 ? (
        <div className="rounded-2xl border bg-card p-8 text-center" style={{ borderColor: BORDER }}>
          <FileText size={26} className="mx-auto mb-2" style={{ color: MUTED }} />
          <p className="text-sm font-medium" style={{ color: MUTED }}>No policies to read right now.</p>
        </div>
      ) : (
        <div className="rounded-2xl border divide-y bg-card" style={{ borderColor: BORDER }}>
          {policies.map((policy) => (
            <button
              key={policy.id}
              type="button"
              onClick={() => setOpenId(policy.id)}
              className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-cc-bg"
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                style={{ background: "var(--cc-soft)" }}
              >
                {policy.acknowledged ? (
                  <CheckCircle2 size={15} style={{ color: "#10B981" }} />
                ) : (
                  <Circle size={15} style={{ color: PLUM }} />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold truncate" style={{ color: TEXT }}>{policy.title}</p>
                <p className="text-xs mt-0.5 truncate" style={{ color: MUTED }}>
                  {policy.folder_label}{policy.acknowledged ? " · Acknowledged" : ""}
                </p>
              </div>
              <ChevronRight size={16} style={{ color: MUTED }} className="shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function PolicyDetail({
  policy,
  onBack,
  onAcknowledge,
  acknowledging,
}: {
  policy: WorkerPolicy;
  onBack: () => void;
  onAcknowledge: () => void;
  acknowledging: boolean;
}) {
  const { toast } = useToast();
  const [opening, setOpening] = useState(false);

  async function handleOpen() {
    setOpening(true);
    try {
      await openWorkerPolicyFile(policy.id);
    } catch (e) {
      toast({ title: "Could not open document", description: (e as Error).message, variant: "destructive" });
    } finally {
      setOpening(false);
    }
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-black" style={{ color: PLUM }}>
        <X size={14} /> Back to policies
      </button>

      <section className="rounded-2xl border bg-card p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--cc-soft)" }}>
            <FileText size={17} style={{ color: PLUM }} />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-black" style={{ color: TEXT }}>{policy.title}</h2>
            <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>{policy.folder_label}</p>
            {policy.description && (
              <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>{policy.description}</p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={handleOpen}
          disabled={opening}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold transition hover:bg-cc-bg disabled:opacity-50"
          style={{ color: PLUM, background: "var(--cc-bg)" }}
        >
          <FileText size={16} /> {opening ? "Opening…" : "Open document"}
        </button>

        {policy.acknowledged ? (
          <div className="mt-5 flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-bold" style={{ background: "#ECFDF5", color: "#059669" }}>
            <CheckCircle2 size={16} /> Acknowledged
          </div>
        ) : (
          <button
            type="button"
            onClick={onAcknowledge}
            disabled={acknowledging}
            className="mt-5 w-full rounded-full py-2.5 text-sm font-black text-white disabled:opacity-50"
            style={{ background: PLUM }}
          >
            {acknowledging ? "Saving…" : "I have read this policy"}
          </button>
        )}
      </section>
    </div>
  );
}
