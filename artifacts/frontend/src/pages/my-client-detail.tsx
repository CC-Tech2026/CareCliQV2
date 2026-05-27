import { useState } from "react";
import type { ComponentType } from "react";
import { useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  CalendarDays,
  ClipboardList,
  FileText,
  HeartPulse,
  Loader2,
  Mic,
  Plus,
  ShieldCheck,
} from "lucide-react";
import {
  createMyClientNote,
  createMyClientSession,
  getMyClientDetail,
  getMyClientNdisPlan,
  type WorkerClientDetail,
} from "@/services/workerService";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT = "#F5F3FC";

type TabKey = "overview" | "plan" | "sessions" | "notes" | "compliance";

function safeDate(value?: string | null) {
  if (!value) return "Not recorded";
  try {
    return format(parseISO(value), "MMM d, yyyy");
  } catch {
    return value;
  }
}

function statusClass(status?: string) {
  if (status === "compliant") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "non_compliant") return "border-red-200 bg-red-50 text-red-700";
  if (status === "draft") return "border-slate-200 bg-slate-50 text-slate-600";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

function Section({ title, icon: Icon, children }: { title: string; icon: ComponentType<{ size?: number }>; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
      <div className="mb-4 flex items-center gap-2">
        <Icon size={18} />
        <h2 className="text-lg font-black" style={{ color: TEXT }}>{title}</h2>
      </div>
      {children}
    </section>
  );
}

function SessionRows({ rows }: { rows: WorkerClientDetail["sessions"] }) {
  return (
    <div className="space-y-3">
      {rows.length === 0 && <p className="text-sm font-medium" style={{ color: MUTED }}>No worker-owned records returned.</p>}
      {rows.map((session) => (
        <div key={session.id} className="rounded-lg border p-4" style={{ borderColor: "#EEEAFB" }}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-black capitalize" style={{ color: TEXT }}>{(session.session_type || "session").replace("_", " ")}</p>
              <p className="text-sm font-medium" style={{ color: MUTED }}>{safeDate(session.session_date)} · {session.duration_minutes || 0} min</p>
            </div>
            <span className={`rounded-full border px-2.5 py-1 text-xs font-bold capitalize ${statusClass(session.compliance_status || session.status)}`}>
              {session.compliance_score ?? session.status ?? "draft"}
            </span>
          </div>
          {session.legal_record_text && (
            <p className="mt-3 text-sm leading-6" style={{ color: MUTED }}>{session.legal_record_text}</p>
          )}
        </div>
      ))}
    </div>
  );
}

export default function MyClientDetail({ id }: { id: string }) {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [noteText, setNoteText] = useState("");
  const queryClient = useQueryClient();
  const detailQuery = useQuery({ queryKey: ["worker", "my-client", id], queryFn: () => getMyClientDetail(id) });
  const planQuery = useQuery({ queryKey: ["worker", "my-client", id, "plan"], queryFn: () => getMyClientNdisPlan(id) });

  const startSession = useMutation({
    mutationFn: () => createMyClientSession(id, { status: "in_progress", session_type: "support_work", duration_minutes: 60 }),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ["worker", "my-client", id] });
      navigate(`/sessions/${session.id}/live`);
    },
  });

  const createNote = useMutation({
    mutationFn: () => createMyClientNote(id, { notes: noteText }),
    onSuccess: () => {
      setNoteText("");
      queryClient.invalidateQueries({ queryKey: ["worker", "my-client", id] });
      queryClient.invalidateQueries({ queryKey: ["worker", "my-compliance"] });
    },
  });

  if (detailQuery.isLoading) return <div className="p-6 text-sm font-bold" style={{ color: MUTED }}>Loading client...</div>;
  if (detailQuery.error) return <div className="p-6 text-sm font-bold text-red-600">{(detailQuery.error as Error).message}</div>;

  const detail = detailQuery.data as WorkerClientDetail;
  const client = detail.participant;
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: "overview", label: "Client Overview" },
    { key: "plan", label: "NDIS Plan" },
    { key: "sessions", label: "Sessions" },
    { key: "notes", label: "Notes" },
    { key: "compliance", label: "Compliance" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Support Worker</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>
            {client.full_name} - Brief Overview
          </h1>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => startSession.mutate()}
            disabled={startSession.isPending}
            className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white shadow-sm disabled:opacity-60"
            style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
          >
            {startSession.isPending ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
            Start Session
          </button>
          <button
            onClick={() => setActiveTab("notes")}
            className="inline-flex items-center gap-2 rounded-full border bg-white px-5 py-3 text-sm font-black shadow-sm"
            style={{ borderColor: BORDER, color: PLUM }}
          >
            <Plus size={16} />
            New Note
          </button>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto rounded-lg border bg-white p-2" style={{ borderColor: BORDER }}>
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className="shrink-0 rounded-full px-4 py-2 text-sm font-black transition"
            style={{ background: activeTab === tab.key ? SOFT : "transparent", color: activeTab === tab.key ? PLUM : MUTED }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "overview" && (
        <div className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
          <Section title="Basic Profile" icon={ClipboardList}>
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                ["NDIS Number", client.ndis_number],
                ["Date of Birth", safeDate(client.date_of_birth)],
                ["Plan Status", client.plan_status],
                ["Plan Management", client.plan_management_type],
                ["Plan Start", safeDate(client.plan_start_date)],
                ["Plan End", safeDate(client.plan_end_date)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg bg-[#F8F6FE] p-3">
                  <dt className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>{label}</dt>
                  <dd className="mt-1 text-sm font-bold" style={{ color: TEXT }}>{value || "Not recorded"}</dd>
                </div>
              ))}
            </dl>
          </Section>
          <Section title="Limited Medical History" icon={HeartPulse}>
            <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 p-4">
              <p className="text-sm font-bold text-amber-900">Limited clinical profile access</p>
              <p className="mt-1 text-sm leading-6 text-amber-800">
                {client.primary_disability || "No primary disability has been recorded for the limited worker view."}
              </p>
            </div>
          </Section>
        </div>
      )}

      {activeTab === "plan" && (
        <Section title="NDIS Plan" icon={ClipboardList}>
          {planQuery.isLoading && <p className="text-sm font-bold" style={{ color: MUTED }}>Loading plan...</p>}
          <div className="space-y-3">
            {(planQuery.data?.goals || client.goals || []).map((goal, index) => (
              <div key={String((goal as any).id || index)} className="rounded-lg border p-4" style={{ borderColor: "#EEEAFB" }}>
                <p className="font-black" style={{ color: TEXT }}>{String((goal as any).title || (goal as any).description || `Goal ${index + 1}`)}</p>
                <p className="mt-1 text-sm font-medium capitalize" style={{ color: MUTED }}>{String((goal as any).status || "active")}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {activeTab === "sessions" && (
        <Section title="Assigned Sessions For This Worker" icon={CalendarDays}>
          <SessionRows rows={detail.sessions} />
        </Section>
      )}

      {activeTab === "notes" && (
        <div className="space-y-6">
          <Section title="New Note" icon={FileText}>
            <textarea
              value={noteText}
              onChange={(event) => setNoteText(event.target.value)}
              className="min-h-32 w-full rounded-lg border bg-white p-4 text-sm font-medium outline-none focus:border-[#5533CC]"
              style={{ borderColor: BORDER, color: TEXT }}
              placeholder="Write a worker-owned progress note..."
            />
            {createNote.error && <p className="mt-3 text-sm font-bold text-red-600">{(createNote.error as Error).message}</p>}
            <button
              disabled={!noteText.trim() || createNote.isPending}
              onClick={() => createNote.mutate()}
              className="mt-4 inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white disabled:opacity-60"
              style={{ background: PLUM }}
            >
              {createNote.isPending && <Loader2 size={16} className="animate-spin" />}
              Save Note
            </button>
          </Section>
          <Section title="My Notes" icon={FileText}>
            <SessionRows rows={detail.notes} />
          </Section>
        </div>
      )}

      {activeTab === "compliance" && (
        <Section title="My Compliance For This Client" icon={ShieldCheck}>
          <SessionRows rows={detail.compliance} />
        </Section>
      )}
    </div>
  );
}
