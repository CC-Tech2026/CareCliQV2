/**
 * Settings > Privacy: voice recording and transcription for the whole
 * organisation (voice notes in the worker app, plan meeting and
 * meet-and-greet recordings). Off until the managing director switches it
 * on and agrees that audio goes overseas to be transcribed; who agreed and
 * when is shown. Coordinators see where it stands. See
 * backend/app/services/voice_access.py.
 */
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Mic } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { formatAppDate } from "@/lib/datetime";
import { jsonFetch } from "@/services/http";

export type VoiceSetting = {
  enabled: boolean;
  /** What the director chose (the server can still force it on or off). */
  chosen: boolean;
  forced: "on" | "off" | null;
  /** A demo organisation: always on. */
  demo: boolean;
  agreed_by_name: string | null;
  agreed_at: string | null;
  terms: string;
  terms_version: string;
  agreed_terms_version: string | null;
  can_change: boolean;
};

const PATH = "/api/organization/voice-transcription";
export function getVoiceSetting() {
  return jsonFetch<VoiceSetting>(PATH);
}
export function saveVoiceSetting(enabled: boolean, agreed: boolean) {
  return jsonFetch<VoiceSetting>(PATH, { method: "PUT", body: JSON.stringify({ enabled, agreed }) });
}

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";

export function VoiceTranscriptionCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const query = useOrgQuery(["voice-setting"], { queryFn: getVoiceSetting, retry: false });
  const s = query.data;
  const [confirming, setConfirming] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function save(enabled: boolean) {
    setBusy(true);
    try {
      await saveVoiceSetting(enabled, enabled && agreed);
      await queryClient.invalidateQueries({ predicate: (q) => q.queryKey.includes("voice-setting") || q.queryKey.includes("meeting-voice-access") });
      setConfirming(false);
      setAgreed(false);
      toast({ title: enabled ? "Voice recording is on" : "Voice recording is off" });
    } catch (err) {
      toast({ title: "Couldn't change voice recording", description: err instanceof Error ? err.message : "Try again.", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  if (query.isLoading) return null;
  if (!s) return null;

  const fixed = s.forced !== null || s.demo;
  const status = s.forced === "off"
    ? "Switched off for every organisation by CareCliQ for now."
    : s.forced === "on" || s.demo
      ? "On for this organisation."
      : s.enabled
        ? `On${s.agreed_by_name ? `, switched on by ${s.agreed_by_name}` : ""}${s.agreed_at ? ` on ${formatAppDate(s.agreed_at)}` : ""}.`
        : "Off. Workers and coordinators type their notes.";

  return (
    <section className="space-y-3 rounded-2xl border border-cc-border bg-cc-surface p-5" aria-label="Voice recording">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 gap-3">
          <Mic size={18} className="mt-0.5 shrink-0" style={{ color: MUTED }} aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-semibold" style={{ color: TEXT }}>Voice recording and transcription</p>
            <p className="mt-0.5 text-[13px]" style={{ color: MUTED }}>
              Voice notes in the worker app, and recording plan meetings and meet and greets, turned into text.
            </p>
            <p className="mt-1.5 text-[13px] font-medium" style={{ color: TEXT }} role="status">{status}</p>
          </div>
        </div>
        {s.can_change && !fixed && (
          <Switch
            aria-label="Voice recording and transcription"
            checked={s.chosen || confirming}
            disabled={busy}
            onCheckedChange={(on) => (on ? setConfirming(true) : confirming ? setConfirming(false) : void save(false))}
          />
        )}
      </div>

      {confirming && (
        <div className="space-y-3 border-t border-cc-border pt-3">
          <p className="text-[13px]" style={{ color: TEXT }}>{s.terms}</p>
          <label className="flex items-start gap-2.5 text-[13px]" style={{ color: TEXT }}>
            <Checkbox checked={agreed} onCheckedChange={(v) => setAgreed(v === true)} aria-label="I agree" className="mt-0.5" />
            <span>I agree, on behalf of the organisation, and we'll tell participants and staff before recording them.</span>
          </label>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => { setConfirming(false); setAgreed(false); }} disabled={busy}>Cancel</Button>
            <Button onClick={() => void save(true)} disabled={!agreed || busy} className="gap-1.5" style={{ background: "var(--cc-cta)", color: "#fff" }}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Switch voice recording on
            </Button>
          </div>
        </div>
      )}

      {!s.can_change && !fixed && !s.enabled && (
        <p className="text-xs" style={{ color: MUTED }}>Your managing director can switch it on here.</p>
      )}
    </section>
  );
}
