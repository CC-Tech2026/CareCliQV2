import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  AlertTriangle,
  CalendarDays,
  ClipboardList,
  FileText,
  HeartPulse,
  Languages,
  Loader2,
  Mic,
  Plus,
  Save,
  ShieldCheck,
  Sparkles,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import {
  createMyClientNote,
  createMyClientSession,
  getMyClientDetail,
  getMyClientNdisPlan,
  type WorkerClientDetail,
} from "@/services/workerService";
import { useToast } from "@/hooks/use-toast";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";
const SOFT = "#F5F3FC";

type TabKey = "overview" | "plan" | "sessions" | "notes" | "compliance";
type ClientSummary = WorkerClientDetail["participant"];

const INPUT_LANGUAGES = [
  { value: "auto", label: "Auto detect" },
  { value: "en", label: "English" },
  { value: "hi", label: "Hindi" },
  { value: "tl", label: "Tagalog" },
  { value: "sw", label: "Swahili" },
  { value: "ar", label: "Arabic" },
] as const;

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

function Section({ title, icon: Icon, children }: { title: string; icon: ComponentType<{ size?: number }>; children: ReactNode }) {
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

function BasicProfilePanel({ client }: { client: ClientSummary }) {
  return (
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
  );
}

function LimitedMedicalPanel({ client }: { client: ClientSummary }) {
  return (
    <Section title="Limited Medical History" icon={HeartPulse}>
      <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 p-4">
        <p className="text-sm font-bold text-amber-900">Limited clinical profile access</p>
        <p className="mt-1 text-sm leading-6 text-amber-800">
          {client.primary_disability || "No primary disability has been recorded for the limited worker view."}
        </p>
      </div>
    </Section>
  );
}

function InlineSessionComposer({
  clientName,
  disability,
  draft,
  generated,
  language,
  isGenerating,
  isSaving,
  error,
  onDraftChange,
  onGeneratedChange,
  onLanguageChange,
  onGenerate,
  onSave,
  onClose,
}: {
  clientName: string;
  disability?: string;
  draft: string;
  generated: string;
  language: string;
  isGenerating: boolean;
  isSaving: boolean;
  error?: string;
  onDraftChange: (value: string) => void;
  onGeneratedChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onGenerate: () => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const canSave = Boolean((generated || draft).trim()) && !isSaving;
  return (
    <section className="rounded-lg border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4" style={{ borderColor: "#EEEAFB" }}>
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.22em]" style={{ color: MUTED }}>
            Live Progress Note
          </p>
          <h2 className="mt-1 text-lg font-black" style={{ color: TEXT }}>
            {clientName}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-full p-2 transition hover:bg-[#F5F3FC]"
          style={{ color: MUTED }}
          aria-label="Close session composer"
        >
          <X size={18} />
        </button>
      </div>

      <div className="space-y-4 p-5">
        <div className="rounded-lg border-l-4 border-amber-400 bg-amber-50 px-4 py-3">
          <p className="text-sm font-black text-amber-900">Client context</p>
          <p className="mt-1 text-sm leading-6 text-amber-800">
            Limited clinical profile: {disability || "No primary disability recorded for the limited worker view."}
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>
            <Languages size={15} />
            Input language
          </label>
          <select
            value={language}
            onChange={(event) => onLanguageChange(event.target.value)}
            className="h-10 rounded-full border bg-[#F8F6FE] px-4 text-sm font-bold outline-none"
            style={{ borderColor: BORDER, color: TEXT }}
          >
            {INPUT_LANGUAGES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
        </div>

        <textarea
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          className="min-h-32 w-full rounded-lg border bg-[#FBFAFF] p-4 text-sm font-medium leading-6 outline-none focus:border-[#5533CC]"
          style={{ borderColor: BORDER, color: TEXT }}
          placeholder="Type or paste session notes here..."
        />

        {generated && (
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em]" style={{ color: MUTED }}>
              <Sparkles size={14} />
              Generated compliant note
            </div>
            <textarea
              value={generated}
              onChange={(event) => onGeneratedChange(event.target.value)}
              className="min-h-28 w-full rounded-lg border bg-white p-4 text-sm font-medium leading-6 outline-none focus:border-[#5533CC]"
              style={{ borderColor: BORDER, color: TEXT }}
            />
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-700">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={onGenerate}
            disabled={!draft.trim() || isGenerating}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-black transition disabled:opacity-50"
            style={{ borderColor: PLUM, color: PLUM }}
          >
            {isGenerating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
            Generate Compliant Note
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={!canSave}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 text-sm font-black text-white transition disabled:opacity-50"
            style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
          >
            {isSaving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save Draft
          </button>
        </div>
      </div>
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
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [noteText, setNoteText] = useState("");
  const [sessionComposerOpen, setSessionComposerOpen] = useState(false);
  const [sessionDraft, setSessionDraft] = useState("");
  const [generatedNote, setGeneratedNote] = useState("");
  const [inputLanguage, setInputLanguage] = useState("auto");
  const [composerError, setComposerError] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const queryClient = useQueryClient();
  const detailQuery = useQuery({ queryKey: ["worker", "my-client", id], queryFn: () => getMyClientDetail(id) });
  const planQuery = useQuery({ queryKey: ["worker", "my-client", id, "plan"], queryFn: () => getMyClientNdisPlan(id) });

  const saveSessionDraft = useMutation({
    mutationFn: () => createMyClientSession(id, {
      status: "draft",
      session_type: "support_work",
      duration_minutes: 60,
      notes: generatedNote.trim() || sessionDraft.trim(),
    }),
    onSuccess: () => {
      setSessionDraft("");
      setGeneratedNote("");
      setComposerError("");
      setSessionComposerOpen(false);
      queryClient.invalidateQueries({ queryKey: ["worker", "my-client", id] });
      queryClient.invalidateQueries({ queryKey: ["worker", "my-compliance"] });
      toast({ title: "Draft saved", description: "The session draft is saved against this client." });
    },
    onError: (error) => {
      setComposerError(error instanceof Error ? error.message : "Could not save the draft.");
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

  async function generateCompliantNote() {
    if (!sessionDraft.trim() || isGenerating) return;
    setComposerError("");
    setIsGenerating(true);
    try {
      const response = await apiFetch("/api/ai/clinical-rewrite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: inputLanguage === "auto"
            ? sessionDraft.trim()
            : `[Input language: ${inputLanguage}]\n${sessionDraft.trim()}`,
        }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.detail || "Could not generate a compliant note.");
      }
      const data = await response.json();
      setGeneratedNote(String(data.clinical || data.note || data.text || sessionDraft.trim()));
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : "Could not generate a compliant note.");
    } finally {
      setIsGenerating(false);
    }
  }

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
            onClick={() => {
              setActiveTab("overview");
              setComposerError("");
              setSessionComposerOpen(true);
            }}
            disabled={saveSessionDraft.isPending}
            className="inline-flex items-center gap-2 rounded-full px-5 py-3 text-sm font-black text-white shadow-sm disabled:opacity-60"
            style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
          >
            {saveSessionDraft.isPending ? <Loader2 size={16} className="animate-spin" /> : <Mic size={16} />}
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
        sessionComposerOpen ? (
          <div className="grid gap-6 xl:grid-cols-[0.9fr_1.1fr]">
            <div className="space-y-6">
              <BasicProfilePanel client={client} />
              <LimitedMedicalPanel client={client} />
            </div>
            <InlineSessionComposer
              clientName={client.full_name}
              disability={client.primary_disability}
              draft={sessionDraft}
              generated={generatedNote}
              language={inputLanguage}
              isGenerating={isGenerating}
              isSaving={saveSessionDraft.isPending}
              error={composerError || (saveSessionDraft.error instanceof Error ? saveSessionDraft.error.message : "")}
              onDraftChange={setSessionDraft}
              onGeneratedChange={setGeneratedNote}
              onLanguageChange={setInputLanguage}
              onGenerate={generateCompliantNote}
              onSave={() => saveSessionDraft.mutate()}
              onClose={() => setSessionComposerOpen(false)}
            />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[1fr_0.85fr]">
            <BasicProfilePanel client={client} />
            <LimitedMedicalPanel client={client} />
          </div>
        )
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
