import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import {
  ArrowLeft, HeartHandshake, ClipboardCheck, Mic, FileSignature, Send, CheckCircle2, Clock3,
  Loader2, ChevronRight, Search, PenLine, PhoneCall, Mail, XCircle, ShieldCheck, Users, Square,
} from "lucide-react";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";
const SURFACE = "var(--cc-surface)";
const SUCCESS = "var(--cc-status-success)";
const SUCCESS_BG = "var(--cc-status-success-bg)";
const WARNING = "var(--cc-status-warning)";
const WARNING_BG = "var(--cc-status-warning-bg)";
const INFO = "var(--cc-status-info)";
const INFO_BG = "var(--cc-status-info-bg)";
const DANGER = "var(--cc-status-danger)";
const DANGER_BG = "var(--cc-status-danger-bg)";
const CRITICAL = "var(--cc-status-critical)";
const CRITICAL_BG = "var(--cc-status-critical-bg)";
const CORAL = "var(--cc-coral)";
// "New" badge matches Staff Onboarding's ApplicantCard exactly — same
// neutral bg/text pairing and coral dot, not a colored pill like the
// other badges here.
const NEW_BADGE_BG = "#EEF1F5";
const NEW_BADGE_TEXT = "#3D5A6C";

/**
 * UI-only build of the participant onboarding pipeline (Enquiry → Screening →
 * Meet & Greet → Service Agreement → Activate). Data lives in local component
 * state for now — there is no participant_onboarding backend yet, so nothing
 * here persists across a page reload. Wiring to a real API is a separate pass.
 */

type IntakeStatus = "enquiry" | "screening" | "declined" | "meet_greet" | "awaiting_signatures" | "signed" | "active";

type EnquirySource = "online_form" | "email" | "phone_call" | "coordinator_referral";

type Intake = {
  id: string;
  full_name: string;
  ndis_number: string;
  email: string;
  phone: string;
  source: EnquirySource;
  status: IntakeStatus;
  decline_reason?: string;
  screening_recording_url?: string;
  meet_greet_notes?: string;
  plan_start_date?: string;
  plan_end_date?: string;
  total_budget?: string;
  provider_signed_name?: string;
  provider_signed_at?: string;
  family_signed_name?: string;
  family_signed_at?: string;
  /** Free-text override for the board card's second line (e.g. "NDIS plan received", "Scheduled 9 Jul, 2:00 PM"). */
  board_subtitle?: string;
  activated_at?: string;
  created_at: string;
};

const SOURCE_META: Record<EnquirySource, { label: string; icon: typeof Mail }> = {
  online_form: { label: "Web referral", icon: ClipboardCheck },
  email: { label: "Email", icon: Mail },
  phone_call: { label: "Phone call", icon: PhoneCall },
  coordinator_referral: { label: "Support coordinator referral", icon: Users },
};

function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
}

const STATUS_META: Record<IntakeStatus, { label: string; bg: string; color: string }> = {
  enquiry: { label: "New enquiry", bg: SOFT, color: MUTED },
  screening: { label: "Screening", bg: SOFT, color: MUTED },
  declined: { label: "Declined", bg: DANGER_BG, color: DANGER },
  meet_greet: { label: "Meet & Greet", bg: INFO_BG, color: INFO },
  awaiting_signatures: { label: "Awaiting signatures", bg: WARNING_BG, color: WARNING },
  signed: { label: "Ready to activate", bg: INFO_BG, color: INFO },
  active: { label: "Active", bg: SUCCESS_BG, color: SUCCESS },
};

// Five-stage journey shown as a stepper in the detail view's sidebar.
const STEPS = [
  { key: "enquiry", label: "Enquiry", icon: Mail },
  { key: "screening", label: "Screening", icon: ClipboardCheck },
  { key: "meet_greet", label: "Meet & Greet", icon: Mic },
  { key: "signatures", label: "Service Agreement", icon: PenLine },
  { key: "active", label: "Active", icon: ShieldCheck },
] as const;

function stepIndexForStatus(status: IntakeStatus): number {
  switch (status) {
    case "enquiry": return 0;
    case "screening": return 1;
    case "meet_greet": return 2;
    case "awaiting_signatures": return 3;
    case "signed": return 3;
    case "active": return 4;
    default: return 0;
  }
}

// The landing page groups participants into these five working columns.
// Declined intakes have left the pipeline entirely — a dead end, so they
// don't get a column and aren't shown on the board.
const BOARD_COLUMNS = [
  { id: "enquiry", label: "Enquiry" },
  { id: "screening", label: "Screening" },
  { id: "meet_greet", label: "Meet and greet" },
  { id: "service_agreement", label: "Service agreement" },
  { id: "active", label: "Active" },
] as const;

type BoardColumnId = (typeof BOARD_COLUMNS)[number]["id"];

// Per-column accent colors — same visual language as Staff Onboarding's
// STAGE_COLOR (colored top border + dot + tinted count pill per column).
// "active" intentionally reuses the exact same green as staff's Active
// column since it's the same underlying concept on both boards.
const COLUMN_COLOR: Record<BoardColumnId, string> = {
  enquiry: "#8A78D6",
  screening: "#D39B42",
  meet_greet: "#3B82F6",
  service_agreement: "#C77D3E",
  active: "#0F7B57",
};

function columnIdForStatus(status: IntakeStatus): BoardColumnId | null {
  switch (status) {
    case "enquiry": return "enquiry";
    case "screening": return "screening";
    case "meet_greet": return "meet_greet";
    case "awaiting_signatures":
    case "signed": return "service_agreement";
    case "active": return "active";
    default: return null;
  }
}

/** KPI stat tile — same tinted-background + icon-badge pattern as Staff Onboarding's KpiTile. */
function KpiTile({ label, value, color, bg, icon: Icon }: { label: string; value: number; color: string; bg: string; icon?: typeof Clock3 }) {
  return (
    <div className="rounded-[1.25rem] px-5 py-4.5" style={{ background: bg }}>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[30px] font-black leading-none" style={{ color }}>{value}</p>
        {Icon && (
          <div className="flex h-8 w-8 items-center justify-center rounded-xl" style={{ background: "rgba(255,255,255,0.65)", color }}>
            <Icon size={15} />
          </div>
        )}
      </div>
      <p className="mt-2 text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>{label}</p>
    </div>
  );
}

/** Small pill badge used on board cards (New / Aging / Easy Capture ready / Awaiting sign / Complete). */
function CardBadge({ icon: Icon, label, color, bg, dot }: { icon?: typeof Clock3; label: string; color: string; bg: string; dot?: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 text-[9.5px] font-black px-1.5 py-0.5 rounded-full whitespace-nowrap"
      style={{ background: bg, color }}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: dot }} />}
      {Icon && <Icon size={9} />} {label}
    </span>
  );
}

/** Board-card badge for a given intake, or null if none applies. */
function badgeForIntake(intake: Intake): { icon?: typeof Clock3; label: string; color: string; bg: string; dot?: string } | null {
  const column = columnIdForStatus(intake.status);
  const age = daysSince(intake.created_at);
  if (column === "enquiry" || column === "screening") {
    if (age < 1) return { label: "New", color: NEW_BADGE_TEXT, bg: NEW_BADGE_BG, dot: CORAL };
    if (age >= 7) return { icon: Clock3, label: "Aging", color: WARNING, bg: WARNING_BG };
    return null;
  }
  if (column === "meet_greet") {
    return intake.screening_recording_url ? { icon: Mic, label: "Easy Capture ready", color: CRITICAL, bg: CRITICAL_BG } : null;
  }
  if (column === "service_agreement") {
    return intake.status === "awaiting_signatures" ? { label: "Awaiting sign", color: SUCCESS, bg: SUCCESS_BG } : null;
  }
  if (column === "active") {
    return { icon: CheckCircle2, label: "Complete", color: SUCCESS, bg: SUCCESS_BG };
  }
  return null;
}

/** Board-card subtitle (second line) for a given intake. */
function subtitleForIntake(intake: Intake): string {
  if (intake.board_subtitle) return intake.board_subtitle;
  const column = columnIdForStatus(intake.status);
  switch (column) {
    case "enquiry": {
      const age = daysSince(intake.created_at);
      const relative = age < 1 ? "today" : age === 1 ? "1 day ago" : `${age} days ago`;
      return `${SOURCE_META[intake.source].label} · ${relative}`;
    }
    case "screening": return "Awaiting plan copy";
    case "meet_greet": return "Awaiting scheduling";
    case "service_agreement":
      return intake.status === "awaiting_signatures" ? "Sent for signature"
        : intake.status === "signed" ? "Signed — ready to activate"
        : "Draft ready";
    case "active":
      return intake.activated_at
        ? `Onboarded ${new Date(intake.activated_at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}`
        : "Onboarded";
    default: return "";
  }
}

function initials(name: string) {
  return (name || "?")
    .split(" ")
    .map((p) => p[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function Avatar({ name, size = 40, color = PLUM }: { name: string; size?: number; color?: string }) {
  return (
    <div
      className="rounded-full shrink-0 flex items-center justify-center font-black text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: color }}
    >
      {initials(name)}
    </div>
  );
}

function StatusBadge({ status }: { status: IntakeStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className="text-[10px] font-black px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: meta.bg, color: meta.color }}>
      {meta.label}
    </span>
  );
}

/** One participant card inside a board column — same shape as Staff Onboarding's ApplicantCard/OversightCard. */
function ParticipantCard({ intake, onClick }: { intake: Intake; onClick: () => void }) {
  const badge = badgeForIntake(intake);
  const subtitle = subtitleForIntake(intake);
  const column = columnIdForStatus(intake.status);
  const accent = column ? COLUMN_COLOR[column] : PLUM;
  return (
    <button
      onClick={onClick}
      className="group w-full rounded-2xl border p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
      style={{ background: SURFACE, borderColor: BORDER, borderLeft: `3px solid ${accent}` }}
    >
      <div className="flex items-start gap-3">
        <Avatar name={intake.full_name} size={36} color={accent} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[12px] font-black" style={{ color: TEXT }}>{intake.full_name}</p>
          <p className="mt-0.5 truncate text-[10px] font-medium" style={{ color: MUTED }}>{subtitle}</p>
        </div>
      </div>
      {badge && <div className="mt-2"><CardBadge {...badge} /></div>}
    </button>
  );
}

/** Vertical stepper used in the detail view's sidebar. */
function IntakeStepper({ status }: { status: IntakeStatus }) {
  if (status === "declined") {
    return (
      <div className="flex items-center gap-2.5 rounded-lg p-3" style={{ background: DANGER_BG }}>
        <XCircle size={16} style={{ color: DANGER }} className="shrink-0" />
        <p className="text-xs font-bold" style={{ color: DANGER }}>Declined</p>
      </div>
    );
  }
  const active = stepIndexForStatus(status);
  return (
    <div>
      {STEPS.map((s, i) => {
        const Icon = s.icon;
        const done = i < active;
        const current = i === active;
        const last = i === STEPS.length - 1;
        return (
          <div key={s.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div
                className="h-7 w-7 rounded-full flex items-center justify-center shrink-0"
                style={{
                  background: done ? SUCCESS : current ? PLUM : SOFT,
                  color: done || current ? "#fff" : MUTED,
                }}
              >
                {done ? <CheckCircle2 size={14} /> : <Icon size={13} />}
              </div>
              {!last && <div className="w-[2px] flex-1 my-0.5" style={{ background: i < active ? SUCCESS : BORDER, minHeight: 20 }} />}
            </div>
            <p className="text-[13px] font-bold pb-5" style={{ color: current ? TEXT : MUTED }}>{s.label}</p>
          </div>
        );
      })}
    </div>
  );
}

let nextId = 1;

export default function ParticipantOnboardingBoard() {
  const { translate } = useAccessibility();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const [intakes, setIntakes] = useState<Intake[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [newIntakeOpen, setNewIntakeOpen] = useState(false);

  const [fullName, setFullName] = useState("");
  const [ndisNumber, setNdisNumber] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState<EnquirySource>("online_form");

  function createIntake() {
    const intake: Intake = {
      id: String(nextId++),
      full_name: fullName.trim(),
      ndis_number: ndisNumber.trim(),
      email: email.trim(),
      phone: phone.trim(),
      source,
      status: "enquiry",
      created_at: new Date().toISOString(),
    };
    setIntakes((prev) => [intake, ...prev]);
    setNewIntakeOpen(false);
    setFullName(""); setNdisNumber(""); setEmail(""); setPhone(""); setSource("online_form");
    setSelectedId(intake.id);
    toast({ title: "Enquiry logged", description: `${intake.full_name} is in the Enquiry column.` });
  }

  function updateIntake(id: string, patch: Partial<Intake>) {
    setIntakes((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  }

  const selected = selectedId ? intakes.find((i) => i.id === selectedId) ?? null : null;

  if (selected) {
    return (
      <IntakeDetail intake={selected} onBack={() => setSelectedId(null)} onUpdate={(patch) => updateIntake(selected.id, patch)} />
    );
  }

  const q = search.trim().toLowerCase();
  const matches = (i: Intake) => !q || i.full_name.toLowerCase().includes(q) || i.ndis_number.toLowerCase().includes(q);

  // KPI strip. "Active participants" and "Ready for signature" mean org-wide
  // counts once a real backend exists — for now they're scoped to what this
  // page knows about locally.
  const openEnquiries = intakes.filter((i) => i.status !== "active" && i.status !== "declined").length;
  const stuckCount = intakes.filter((i) => i.status !== "active" && i.status !== "declined" && daysSince(i.created_at) >= 7).length;
  const activeCount = intakes.filter((i) => i.status === "active").length;
  const readyForSignatureCount = intakes.filter((i) => i.status === "awaiting_signatures").length;

  function comingSoon(feature: string) {
    toast({ title: "Coming soon", description: `${feature} isn't built yet — it needs its own scoped piece of work.` });
  }

  return (
    <>
      <div className="space-y-5 pb-10">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <button
              onClick={() => navigate("/hub")}
              className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-black transition-colors hover:bg-black/5"
              style={{ color: MUTED, background: SOFT }}
            >
              <ArrowLeft size={13} strokeWidth={2.5} /> {translate("md.backToHub")}
            </button>
            <h1 className="text-2xl font-black tracking-tight mt-2" style={{ color: TEXT }}>Participant Onboarding</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => comingSoon("The public referral form")}
              className="text-[12px] font-black transition-colors hover:opacity-80 flex items-center gap-1"
              style={{ color: PLUM }}
            >
              View public referral form <ChevronRight size={13} />
            </button>
            <Button variant="outline" className="rounded-lg" onClick={() => comingSoon("Referral portal settings")}>
              Referral portal settings
            </Button>
            <Button variant="navy" className="gap-2 rounded-lg shrink-0" onClick={() => setNewIntakeOpen(true)}>
              <HeartHandshake size={15} /> New referral
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiTile label="Open enquiries" value={openEnquiries} color={CRITICAL} bg={CRITICAL_BG} icon={ClipboardCheck} />
          <KpiTile label="Stuck 7+ days" value={stuckCount} color={WARNING} bg={WARNING_BG} icon={Clock3} />
          <KpiTile label="Active participants" value={activeCount} color={SUCCESS} bg={SUCCESS_BG} icon={ShieldCheck} />
          <KpiTile label="Ready for signature" value={readyForSignatureCount} color={INFO} bg={INFO_BG} icon={PenLine} />
        </div>

        <div className="relative w-full max-w-[260px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: MUTED }} />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" className="pl-8 h-9 rounded-lg text-sm" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 items-start">
          {BOARD_COLUMNS.map((col) => {
            const columnIntakes = intakes.filter((i) => columnIdForStatus(i.status) === col.id && matches(i));
            const color = COLUMN_COLOR[col.id];
            return (
              <div
                key={col.id}
                className="rounded-[1.25rem] border-t-[3px] p-4 flex flex-col gap-3"
                style={{ background: SOFT, borderTopColor: color }}
              >
                <div className="flex items-center justify-between px-0.5 pb-0.5">
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ background: color }} />
                    <p className="text-[13px] font-black" style={{ color: TEXT }}>{col.label}</p>
                  </div>
                  <span
                    className="flex h-6 min-w-[24px] items-center justify-center rounded-full px-1.5 text-[10px] font-black"
                    style={{ background: `${color}1F`, color }}
                  >
                    {columnIntakes.length}
                  </span>
                </div>
                <div className="space-y-2 max-h-[65vh] overflow-y-auto">
                  {columnIntakes.length === 0 && (
                    <p className="rounded-xl border border-dashed py-8 text-center text-[10px] font-medium" style={{ color: MUTED }}>Nobody here</p>
                  )}
                  {columnIntakes.map((i) => (
                    <ParticipantCard key={i.id} intake={i} onClick={() => setSelectedId(i.id)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>

      </div>

      <Sheet open={newIntakeOpen} onOpenChange={setNewIntakeOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto" style={{ background: SURFACE }}>
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2" style={{ color: TEXT }}>
              <HeartHandshake size={18} style={{ color: PLUM }} /> New Referral
            </SheetTitle>
          </SheetHeader>
          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Full name</label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="e.g. Sam Rivera" autoFocus />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>NDIS number</label>
              <Input value={ndisNumber} onChange={(e) => setNdisNumber(e.target.value)} placeholder="e.g. 430123456" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Email</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="family@example.com" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Phone (optional)</label>
                <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="0412 345 678" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Enquiry source</label>
                <Select value={source} onValueChange={(v) => setSource(v as EnquirySource)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="online_form">Web referral</SelectItem>
                    <SelectItem value="email">Email</SelectItem>
                    <SelectItem value="phone_call">Phone call</SelectItem>
                    <SelectItem value="coordinator_referral">Support coordinator referral</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <SheetFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setNewIntakeOpen(false)}>Cancel</Button>
            <Button
              variant="navy"
              onClick={createIntake}
              disabled={!fullName.trim() || !ndisNumber.trim()}
            >
              Log enquiry
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}

function IntakeDetail({
  intake, onBack, onUpdate,
}: {
  intake: Intake;
  onBack: () => void;
  onUpdate: (patch: Partial<Intake>) => void;
}) {
  const { toast } = useToast();
  const [declineReason, setDeclineReason] = useState("");
  const [notes, setNotes] = useState(intake.meet_greet_notes ?? "");
  const [providerName, setProviderName] = useState(intake.provider_signed_name ?? "");
  const [familyName, setFamilyName] = useState(intake.family_signed_name ?? "");
  const [activating, setActivating] = useState(false);
  const [boardSubtitle, setBoardSubtitle] = useState(intake.board_subtitle ?? "");

  // ── Easy Capture — record the screening call ──────────────────────────
  const [recording, setRecording] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    // Stop the mic and timer if the detail view unmounts mid-recording.
    return () => {
      if (timerRef.current) window.clearInterval(timerRef.current);
      mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startRecording() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast({ title: "Voice recording not supported", description: "Please use a different browser or device.", variant: "destructive" });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      let mimeType = "audio/webm;codecs=opus";
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = "audio/mp4";
        if (!MediaRecorder.isTypeSupported(mimeType)) mimeType = "audio/webm";
      }
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const url = URL.createObjectURL(new Blob(chunks, { type: mimeType }));
        onUpdate({ screening_recording_url: url });
      };
      recorder.start();
      mediaRecorderRef.current = recorder;
      setElapsedSec(0);
      setRecording(true);
      timerRef.current = window.setInterval(() => setElapsedSec((s) => s + 1), 1000);
    } catch (err: any) {
      if (err?.name === "NotAllowedError") {
        toast({ title: "Microphone access denied", description: "Allow microphone access to record the screening call.", variant: "destructive" });
      } else if (err?.name === "NotFoundError") {
        toast({ title: "No microphone found", description: "Connect a microphone to record.", variant: "destructive" });
      } else {
        toast({ title: "Failed to start recording", description: err?.message ?? "", variant: "destructive" });
      }
    }
  }

  function stopRecording() {
    mediaRecorderRef.current?.stop();
    setRecording(false);
    if (timerRef.current) { window.clearInterval(timerRef.current); timerRef.current = null; }
  }

  function formatElapsed(sec: number) {
    return `${Math.floor(sec / 60).toString().padStart(2, "0")}:${(sec % 60).toString().padStart(2, "0")}`;
  }

  function startScreening() {
    onUpdate({ status: "screening" });
    toast({ title: "Moved to Screening" });
  }

  function accept() {
    onUpdate({ status: "meet_greet" });
    toast({ title: "Moved to Meet & Greet" });
  }

  function decline() {
    if (!declineReason.trim()) return;
    onUpdate({ status: "declined", decline_reason: declineReason.trim() });
    toast({ title: "Enquiry declined" });
  }

  function saveMeetGreetAndContinue() {
    onUpdate({ meet_greet_notes: notes.trim(), status: "awaiting_signatures" });
    toast({ title: "Sent for signature", description: "Service agreement is ready for both signatures." });
  }

  function markSigned() {
    if (!providerName.trim() || !familyName.trim()) return;
    const now = new Date().toISOString();
    onUpdate({
      status: "signed",
      provider_signed_name: providerName.trim(),
      provider_signed_at: now,
      family_signed_name: familyName.trim(),
      family_signed_at: now,
    });
    toast({ title: "Service agreement signed" });
  }

  function activate() {
    setActivating(true);
    // No backend yet — simulate the activation call so the flow is
    // demonstrable end-to-end until the participant_onboarding API lands.
    setTimeout(() => {
      onUpdate({ status: "active", activated_at: new Date().toISOString() });
      setActivating(false);
      toast({ title: "Participant activated", description: `${intake.full_name} now appears on the Coordinator's dashboard.` });
    }, 500);
  }

  const signLink = intake.status === "awaiting_signatures"
    ? `${window.location.origin}/participant-onboarding-sign?intake=${intake.id}`
    : null;

  return (
    <div className="space-y-5 pb-10">
      <button onClick={onBack} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[13px] font-bold -ml-2.5" style={{ color: PLUM }}>
        <ArrowLeft size={15} /> Back to enquiries
      </button>

      <div className="grid gap-5 lg:grid-cols-[1fr_300px] items-start">
        {/* Main column */}
        <div className="space-y-5 min-w-0">
          {/* Enquiry */}
          {intake.status === "enquiry" && (
            <div className="rounded-lg border" style={{ background: SURFACE, borderColor: BORDER }}>
              <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                <Mail size={16} style={{ color: PLUM }} />
                <p className="text-sm font-black" style={{ color: TEXT }}>Enquiry</p>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-xs" style={{ color: MUTED }}>
                  Logged via {SOURCE_META[intake.source].label.toLowerCase()}. Start screening when you're ready to review this enquiry.
                </p>
                <div className="flex gap-2">
                  <Button variant="navy" className="gap-2 rounded-lg" onClick={startScreening}>
                    <ClipboardCheck size={14} /> Start screening
                  </Button>
                </div>
                <div className="pt-2 space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Decline reason</label>
                  <div className="flex gap-2">
                    <Input value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="e.g. Outside our service area" />
                    <Button variant="outline" className="shrink-0 gap-2 rounded-lg" style={{ color: DANGER }} onClick={decline} disabled={!declineReason.trim()}>
                      <XCircle size={14} /> Decline
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Screening */}
          {intake.status !== "enquiry" && (
            <div className="rounded-lg border" style={{ background: SURFACE, borderColor: BORDER }}>
              <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                <ClipboardCheck size={16} style={{ color: PLUM }} />
                <p className="text-sm font-black" style={{ color: TEXT }}>Screening</p>
              </div>
              <div className="p-5 space-y-3">
                {intake.status === "screening" && (
                  <>
                    <div className="rounded-lg p-3 flex items-center justify-between gap-3" style={{ background: SOFT }}>
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className="h-8 w-8 rounded-lg shrink-0 flex items-center justify-center"
                          style={{ background: recording ? DANGER_BG : "var(--cc-bg)", color: recording ? DANGER : PLUM }}
                        >
                          <Mic size={15} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-black" style={{ color: TEXT }}>Easy Capture</p>
                          <p className="text-[11px] flex items-center gap-1.5" style={{ color: MUTED }}>
                            {recording && <span className="h-1.5 w-1.5 rounded-full animate-pulse shrink-0" style={{ background: DANGER }} />}
                            {recording
                              ? `Recording… ${formatElapsed(elapsedSec)}`
                              : intake.screening_recording_url ? "Screening call recorded" : "Record the screening call"}
                          </p>
                        </div>
                      </div>
                      {!recording ? (
                        <Button variant="outline" size="sm" className="gap-1.5 rounded-lg shrink-0" onClick={startRecording}>
                          <Mic size={13} /> {intake.screening_recording_url ? "Re-record" : "Record"}
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" className="gap-1.5 rounded-lg shrink-0" style={{ color: DANGER }} onClick={stopRecording}>
                          <Square size={13} /> Stop
                        </Button>
                      )}
                    </div>
                    {intake.screening_recording_url && !recording && (
                      <audio controls src={intake.screening_recording_url} className="w-full h-9" />
                    )}
                    <p className="text-xs" style={{ color: MUTED }}>Can this organisation take this participant on?</p>
                    <div className="flex gap-2">
                      <Button variant="navy" className="gap-2 rounded-lg" onClick={accept}>
                        <CheckCircle2 size={14} /> Yes, proceed
                      </Button>
                    </div>
                    <div className="pt-2 space-y-1.5">
                      <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Decline reason</label>
                      <div className="flex gap-2">
                        <Input value={declineReason} onChange={(e) => setDeclineReason(e.target.value)} placeholder="e.g. Outside our service area" />
                        <Button variant="outline" className="shrink-0 gap-2 rounded-lg" style={{ color: DANGER }} onClick={decline} disabled={!declineReason.trim()}>
                          <XCircle size={14} /> Decline
                        </Button>
                      </div>
                    </div>
                  </>
                )}
                {intake.status === "declined" && (
                  <div className="flex items-center gap-2.5 rounded-lg p-3" style={{ background: DANGER_BG }}>
                    <XCircle size={16} style={{ color: DANGER }} className="shrink-0" />
                    <p className="text-xs" style={{ color: TEXT }}>{intake.decline_reason || "Declined."}</p>
                  </div>
                )}
                {stepIndexForStatus(intake.status) > 1 && (
                  <div className="flex items-center gap-2.5 rounded-lg p-3" style={{ background: SUCCESS_BG }}>
                    <CheckCircle2 size={16} style={{ color: SUCCESS }} className="shrink-0" />
                    <p className="text-xs font-bold" style={{ color: SUCCESS }}>Passed screening.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Meet & Greet */}
          {stepIndexForStatus(intake.status) >= 2 && intake.status !== "declined" && (
            <div className="rounded-lg border" style={{ background: SURFACE, borderColor: BORDER}}>
              <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                <Mic size={16} style={{ color: PLUM }} />
                <p className="text-sm font-black" style={{ color: TEXT }}>Meet &amp; Greet</p>
              </div>
              <div className="p-5 space-y-3">
                <p className="text-xs" style={{ color: MUTED }}>Key notes from the meet &amp; greet.</p>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Key notes from the meet & greet…"
                  className="min-h-[100px]"
                  disabled={intake.status !== "meet_greet"}
                />
                {intake.status === "meet_greet" && (
                  <Button variant="navy" className="gap-2 rounded-lg" onClick={saveMeetGreetAndContinue}>
                    <Send size={14} /> Send service agreement for signature
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Service Agreement / Signatures */}
          {stepIndexForStatus(intake.status) >= 3 && intake.status !== "declined" && (
            <div className="rounded-lg border" style={{ background: SURFACE, borderColor: BORDER }}>
              <div className="flex items-center gap-2 px-5 py-4 border-b" style={{ borderColor: BORDER }}>
                <FileSignature size={16} style={{ color: PLUM }} />
                <p className="text-sm font-black" style={{ color: TEXT }}>Service Agreement</p>
              </div>
              <div className="p-5 space-y-3">
                {intake.status === "awaiting_signatures" && (
                  <>
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Provider signatory</label>
                        <Input value={providerName} onChange={(e) => setProviderName(e.target.value)} placeholder="Your full name" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>Participant / guardian signatory</label>
                        <Input value={familyName} onChange={(e) => setFamilyName(e.target.value)} placeholder="Their full name" />
                      </div>
                    </div>
                    {signLink && (
                      <div className="flex items-center gap-2 rounded-lg p-3" style={{ background: WARNING_BG }}>
                        <Mail size={14} style={{ color: WARNING }} className="shrink-0" />
                        <p className="text-xs flex-1" style={{ color: TEXT }}>Consent form and service agreement sent to {intake.email || "the family"}.</p>
                      </div>
                    )}
                    <Button variant="navy" className="w-full gap-2 rounded-lg" onClick={markSigned} disabled={!providerName.trim() || !familyName.trim()}>
                      <PenLine size={14} /> Mark as signed
                    </Button>
                  </>
                )}

                {intake.status !== "awaiting_signatures" && (
                  <div className="grid sm:grid-cols-2 gap-3">
                    <SignatureCard label="Provider" signedName={intake.provider_signed_name} signedAt={intake.provider_signed_at} pendingLabel="Not yet signed" />
                    <SignatureCard label="Participant / guardian" signedName={intake.family_signed_name} signedAt={intake.family_signed_at} pendingLabel="Not yet signed" />
                  </div>
                )}

                {intake.status === "signed" && (
                  <Button variant="navy" className="w-full gap-2 rounded-lg" onClick={activate} disabled={activating}>
                    {activating ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />} Activate participant
                  </Button>
                )}
              </div>
            </div>
          )}

          {intake.status === "active" && (
            <div className="flex items-center gap-2.5 rounded-lg p-4 border" style={{ background: SUCCESS_BG, borderColor: BORDER }}>
              <Users size={16} style={{ color: SUCCESS }} className="shrink-0" />
              <p className="text-xs" style={{ color: TEXT }}>
                {intake.full_name.split(" ")[0]} is active and now appears on the Coordinator's dashboard for scheduling and support planning.
              </p>
            </div>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-5">
          <div className="rounded-lg border p-5" style={{ background: SURFACE, borderColor: BORDER }}>
            <Avatar name={intake.full_name} size={44} />
            <h2 className="text-base font-black mt-3" style={{ color: TEXT }}>{intake.full_name}</h2>
            <div className="mt-1"><StatusBadge status={intake.status} /></div>
            <div className="mt-4 pt-4 border-t space-y-2" style={{ borderColor: BORDER }}>
              <p className="text-xs" style={{ color: MUTED }}>NDIS {intake.ndis_number || "—"}</p>
              {intake.email && <p className="text-xs" style={{ color: MUTED }}>{intake.email}</p>}
              {intake.phone && <p className="text-xs" style={{ color: MUTED }}>{intake.phone}</p>}
              <p className="text-xs flex items-center gap-1.5" style={{ color: MUTED }}>
                {(() => { const Icon = SOURCE_META[intake.source].icon; return <Icon size={12} />; })()}
                {SOURCE_META[intake.source].label}
              </p>
            </div>
          </div>

          {intake.status !== "enquiry" && intake.status !== "declined" && intake.status !== "active" && (
            <div className="rounded-lg border p-5" style={{ background: SURFACE, borderColor: BORDER }}>
              <label className="text-[10px] font-black uppercase tracking-wide mb-2 block" style={{ color: MUTED }}>Board card note</label>
              <Input
                value={boardSubtitle}
                onChange={(e) => setBoardSubtitle(e.target.value)}
                onBlur={() => onUpdate({ board_subtitle: boardSubtitle.trim() || undefined })}
                placeholder={subtitleForIntake(intake)}
                className="text-sm"
              />
              <p className="text-[10px] mt-1.5" style={{ color: MUTED }}>Shown as the second line on the board card.</p>
            </div>
          )}

          <div className="rounded-lg border p-5" style={{ background: SURFACE, borderColor: BORDER }}>
            <p className="text-[10px] font-black uppercase tracking-wide mb-4" style={{ color: MUTED }}>Progress</p>
            <IntakeStepper status={intake.status} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SignatureCard({
  label, signedName, signedAt, pendingLabel,
}: {
  label: string;
  signedName?: string | null;
  signedAt?: string | null;
  pendingLabel: string;
}) {
  const signed = !!signedAt;
  return (
    <div
      className="rounded-lg p-3.5 border"
      style={{ background: signed ? SUCCESS_BG : SOFT, borderColor: signed ? "transparent" : BORDER }}
    >
      <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: signed ? SUCCESS : MUTED }}>{label}</p>
      {signed ? (
        <div className="mt-1.5">
          <p className="text-sm font-black flex items-center gap-1.5" style={{ color: TEXT }}>
            <CheckCircle2 size={14} style={{ color: SUCCESS }} /> {signedName}
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: MUTED }}>
            Signed {new Date(signedAt!).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
      ) : (
        <p className="text-xs mt-1.5 flex items-center gap-1.5" style={{ color: MUTED }}><Clock3 size={13} /> {pendingLabel}</p>
      )}
    </div>
  );
}
