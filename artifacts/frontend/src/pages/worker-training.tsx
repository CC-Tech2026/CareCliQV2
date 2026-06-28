import { useState } from "react";
import { format, parseISO } from "date-fns";
import { AlertCircle, BookOpen, CheckCircle2, Clock, FileText, Plus, Send } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import { BORDER, CORAL, MUTED, PLUM, SOFT, TEXT } from "@/lib/shift-utils";
import {
  createTrainingRequest,
  getTrainingHistory,
  getTrainingModules,
  getTrainingRequests,
  getWorkerCertifications,
  markTrainingComplete,
  type WorkerCertification,
} from "@/services/workerPerformanceService";


const CERT_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  valid: { bg: "#ECFDF5", text: "#059669", label: "Current" },
  expiring: { bg: "#FFFBEB", text: "#D97706", label: "Expiring soon" },
  expired: { bg: "#FEF2F2", text: "#DC2626", label: "Expired" },
  pending_review: { bg: "#F3F4F6", text: MUTED, label: "Pending review" },
  rejected: { bg: "#FEF2F2", text: "#DC2626", label: "Rejected" },
};

function CertCard({ cert }: { cert: WorkerCertification }) {
  const style = CERT_STYLES[cert.display_status] ?? CERT_STYLES.valid;
  return (
    <div className="rounded-2xl border bg-cc-surface p-4 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black" style={{ color: TEXT }}>{cert.title}</p>
          <p className="mt-0.5 text-xs font-bold" style={{ color: MUTED }}>{cert.issuer || cert.credential_type}</p>
        </div>
        <span
          className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-black uppercase"
          style={{ background: style.bg, color: style.text }}
        >
          {style.label}
        </span>
      </div>
      {cert.expiry_date && (
        <p className="mt-3 text-xs font-bold" style={{ color: MUTED }}>
          Expires {format(parseISO(cert.expiry_date), "d MMM yyyy")}
        </p>
      )}
    </div>
  );
}

export default function WorkerTrainingPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"certs" | "modules" | "requests">("certs");
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestText, setRequestText] = useState("");
  const [requestReason, setRequestReason] = useState("");
  const [urgent, setUrgent] = useState(false);

  const certsQuery = useOrgQuery(["worker", "certifications"], { queryFn: getWorkerCertifications });
  const modulesQuery = useOrgQuery(["worker", "training-modules"], { queryFn: getTrainingModules });
  const requestsQuery = useOrgQuery(["worker", "training-requests"], { queryFn: getTrainingRequests });
  const historyQuery = useOrgQuery(["worker", "training-history"], { queryFn: getTrainingHistory });

  const completeMut = useMutation({
    mutationFn: (moduleId: string) =>
      markTrainingComplete({
        module_id: moduleId,
        completed_at: format(new Date(), "yyyy-MM-dd"),
      }),
    onSuccess: () => {
      toast({ title: "Submitted for review", description: "Your coordinator will confirm completion." });
      void queryClient.invalidateQueries({ queryKey: ["worker", "training-history"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const requestMut = useMutation({
    mutationFn: () => createTrainingRequest({ request_text: requestText, reason: requestReason, urgent }),
    onSuccess: () => {
      toast({ title: "Request sent", description: "Your coordinator has been notified." });
      setRequestOpen(false);
      setRequestText("");
      setRequestReason("");
      setUrgent(false);
      void queryClient.invalidateQueries({ queryKey: ["worker", "training-requests"] });
    },
    onError: (e: Error) => toast({ title: "Failed", description: e.message, variant: "destructive" }),
  });

  const tabs = [
    { id: "certs" as const, label: "Certifications" },
    { id: "modules" as const, label: "Training" },
    { id: "requests" as const, label: "Requests" },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Performance</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>Training & certifications</h1>
        </div>
        <button
          type="button"
          onClick={() => setRequestOpen(true)}
          className="inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-black text-white shadow-sm"
          style={{ background: PLUM }}
        >
          <Plus size={16} />
          Request training
        </button>
      </header>

      <div className="flex rounded-full bg-cc-bg p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className="flex-1 rounded-full py-2.5 text-xs font-black transition sm:text-sm"
            style={{
              background: tab === t.id ? 'var(--cc-surface)' : 'transparent',
              color: tab === t.id ? TEXT : MUTED,
              boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.06)" : "none",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "certs" && (
        <div className="space-y-3">
          {(certsQuery.data?.certifications ?? []).map((c) => (
            <CertCard key={c.id} cert={c} />
          ))}
          {!certsQuery.data?.certifications?.length && (
            <p className="py-8 text-center text-sm font-medium" style={{ color: MUTED }}>
              No certifications on file. Upload credentials from the Credentials page.
            </p>
          )}
        </div>
      )}

      {tab === "modules" && (
        <div className="space-y-4">
          {(modulesQuery.data?.modules ?? []).map((mod) => (
            <section key={mod.id} className="rounded-2xl border bg-cc-surface p-5 shadow-sm" style={{ borderColor: BORDER }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-black" style={{ color: TEXT }}>{mod.title}</h3>
                  {mod.description && (
                    <p className="mt-1 text-sm font-medium" style={{ color: MUTED }}>{mod.description}</p>
                  )}
                </div>
                {!mod.requires_certification && (
                  <button
                    type="button"
                    onClick={() => completeMut.mutate(mod.id)}
                    disabled={completeMut.isPending}
                    className="shrink-0 rounded-full px-3 py-1.5 text-xs font-black text-white"
                    style={{ background: PLUM }}
                  >
                    Mark complete
                  </button>
                )}
              </div>
              {!!mod.resources?.length && (
                <ul className="mt-4 space-y-2">
                  {mod.resources.map((res) => (
                    <li key={res.id}>
                      <a
                        href={res.external_url || "#"}
                        target={res.resource_type === "external_link" ? "_blank" : undefined}
                        rel="noreferrer"
                        className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold transition hover:bg-cc-bg"
                        style={{ color: PLUM }}
                      >
                        {res.resource_type === "video" && <BookOpen size={16} />}
                        {res.resource_type === "pdf" && <FileText size={16} />}
                        {res.resource_type === "external_link" && <Send size={16} />}
                        {res.title}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
          {!modulesQuery.data?.modules?.length && (
            <p className="py-8 text-center text-sm font-medium" style={{ color: MUTED }}>
              No training modules assigned yet.
            </p>
          )}
          {!!historyQuery.data?.history?.length && (
            <section className="rounded-2xl border bg-cc-surface p-5" style={{ borderColor: BORDER }}>
              <h3 className="text-sm font-black" style={{ color: TEXT }}>Training history</h3>
              <ul className="mt-3 space-y-2">
                {historyQuery.data.history.map((h: Record<string, unknown>) => (
                  <li key={String(h.id)} className="flex items-center justify-between text-sm">
                    <span className="font-bold" style={{ color: TEXT }}>
                      {(h.training_modules as { title?: string })?.title ?? "Training"}
                    </span>
                    <span className="text-xs font-bold" style={{ color: MUTED }}>
                      {String(h.status ?? "").replace("_", " ")}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      {tab === "requests" && (
        <div className="space-y-3">
          {(requestsQuery.data?.requests ?? []).map((req: Record<string, unknown>) => {
            const status = String(req.status ?? "pending");
            const isPending = status === "pending";
            return (
              <div key={String(req.id)} className="rounded-2xl border bg-cc-surface p-4" style={{ borderColor: BORDER }}>
                <div className="flex items-center gap-2">
                  {isPending ? (
                    <Clock size={16} style={{ color: "#D97706" }} />
                  ) : status === "approved" ? (
                    <CheckCircle2 size={16} className="text-emerald-600" />
                  ) : (
                    <AlertCircle size={16} className="text-red-600" />
                  )}
                  <span className="text-xs font-black uppercase" style={{ color: MUTED }}>{status}</span>
                  {!!req.urgent && (
                    <span className="rounded-full px-2 py-0.5 text-[10px] font-black" style={{ background: 'var(--cc-status-critical-bg)', color: CORAL }}>
                      Urgent
                    </span>
                  )}
                </div>
                <p className="mt-2 text-sm font-bold" style={{ color: TEXT }}>{String(req.request_text)}</p>
                <p className="mt-1 text-xs" style={{ color: MUTED }}>{String(req.reason)}</p>
                {!!req.coordinator_response && (
                  <p className="mt-2 rounded-lg bg-cc-bg p-2 text-xs font-medium" style={{ color: TEXT }}>
                    {String(req.coordinator_response)}
                  </p>
                )}
              </div>
            );
          })}
          {!requestsQuery.data?.requests?.length && (
            <p className="py-8 text-center text-sm font-medium" style={{ color: MUTED }}>
              No training requests yet.
            </p>
          )}
        </div>
      )}

      {requestOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-cc-surface p-6 shadow-xl">
            <h3 className="text-lg font-black" style={{ color: TEXT }}>Request training</h3>
            <label className="mt-4 block">
              <span className="text-xs font-black uppercase" style={{ color: MUTED }}>What training do you need?</span>
              <textarea
                value={requestText}
                onChange={(e) => setRequestText(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: BORDER }}
              />
            </label>
            <label className="mt-3 block">
              <span className="text-xs font-black uppercase" style={{ color: MUTED }}>Reason</span>
              <textarea
                value={requestReason}
                onChange={(e) => setRequestReason(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                style={{ borderColor: BORDER }}
              />
            </label>
            <label className="mt-3 flex items-center gap-2 text-sm font-bold" style={{ color: TEXT }}>
              <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
              Mark as urgent
            </label>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => setRequestOpen(false)}
                className="flex-1 rounded-full py-2.5 text-sm font-black"
                style={{ background: 'var(--cc-active)', color: MUTED }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => requestMut.mutate()}
                disabled={requestMut.isPending || !requestText.trim() || !requestReason.trim()}
                className="flex-1 rounded-full py-2.5 text-sm font-black text-white"
                style={{ background: PLUM }}
              >
                Send request
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
