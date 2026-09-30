import { useCallback, useEffect, useState } from "react";
import { Copy, KeyRound, Loader2, MailPlus, RefreshCw, ShieldOff, UserX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import {
  IDENTITY_METHOD_OPTIONS,
  NOT_USING_REASON_OPTIONS,
  RELATIONSHIP_OPTIONS,
  getPortalSummary,
  grantPortalAccess,
  recordNotUsingPortal,
  resendPortalInvite,
  revokePortalAccess,
  type GrantResult,
  type NotUsingReason,
  type PortalAccess,
  type PortalIdentityMethod,
  type PortalRelationship,
  type PortalSummary,
} from "@/services/participantPortalAccessService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";
const SUCCESS = "#1F7A4D";
const SUCCESS_BG = "#E7F5EE";
const WARNING = "#9A5B0A";
const WARNING_BG = "#FBF2E6";
const DANGER = "#B42318";

const STATUS_BADGE: Record<PortalSummary["status"], { label: string; color: string; bg: string }> = {
  active: { label: "Active", color: SUCCESS, bg: SUCCESS_BG },
  pending: { label: "Invite pending", color: WARNING, bg: WARNING_BG },
  not_using: { label: "Not using portal", color: MUTED, bg: "var(--cc-bg)" },
  not_set: { label: "Not set up", color: MUTED, bg: "var(--cc-bg)" },
};

function formatDate(value: string | null | undefined) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function accessStateLine(a: PortalAccess): { text: string; color: string } {
  if (a.status === "active") return { text: `Active since ${formatDate(a.accepted_at)}`, color: SUCCESS };
  if (a.status === "revoked") return { text: `Revoked ${formatDate(a.revoked_at)} — ${a.revoked_reason ?? ""}`, color: MUTED };
  if (a.identity_locked_at) return { text: "Locked after too many identity attempts — resend to unlock", color: DANGER };
  if (a.invite_expired) return { text: "Invite expired — resend to issue a new link", color: DANGER };
  return { text: `Invite sent ${formatDate(a.invite_sent_at)} · expires ${formatDate(a.invite_expires_at)}`, color: WARNING };
}

/** The one-off details the MD may need to pass on — shown once, never retrievable later. */
export function GrantResultNotice({ result, onClose }: { result: GrantResult; onClose: () => void }) {
  const { toast } = useToast();
  const fullLink = result.invite_url ? `${window.location.origin}${result.invite_url}` : null;
  const emailSent = result.email_delivery?.status === "queued";
  return (
    <div className="space-y-3 rounded-lg border p-4" style={{ borderColor: BORDER, background: SURFACE }}>
      <p className="text-sm font-bold" style={{ color: TEXT }}>
        {result.invite_url
          ? `Invite ${emailSent ? "emailed" : "created"} for ${result.access.full_name}`
          : `${result.access.full_name}'s existing login now has access`}
      </p>
      {result.invite_url && !emailSent && (
        <p className="text-xs" style={{ color: WARNING }}>
          Email isn't sending right now ({result.email_delivery?.status}). Copy the link below and send it to {result.access.email} yourself.
        </p>
      )}
      {result.identity_code && (
        <div className="flex items-center gap-2 rounded-lg p-3" style={{ background: WARNING_BG }}>
          <KeyRound size={16} style={{ color: WARNING }} />
          <p className="text-xs" style={{ color: TEXT }}>
            Identity code: <strong className="font-mono text-sm tracking-widest">{result.identity_code}</strong> — give this to them by phone or in person, not by email. It won't be shown again.
          </p>
        </div>
      )}
      {fullLink && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            void navigator.clipboard?.writeText(fullLink);
            toast({ title: "Invite link copied" });
          }}
        >
          <Copy size={13} /> Copy invite link
        </Button>
      )}
      <div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>Done</Button>
      </div>
    </div>
  );
}

type GrantDraft = {
  full_name: string;
  email: string;
  relationship: PortalRelationship;
  identity_method: PortalIdentityMethod;
  authority_notes: string;
  consent_method: "" | "written" | "verbal";
};

function emptyDraft(summary: PortalSummary | null): GrantDraft {
  const hasSelf = summary?.access.some((a) => a.relationship === "self" && a.status !== "revoked");
  return {
    full_name: hasSelf ? "" : summary?.participant_name ?? "",
    email: hasSelf ? "" : summary?.participant_email ?? "",
    relationship: hasSelf ? "plan_nominee" : "self",
    identity_method: "participant_dob",
    authority_notes: "",
    consent_method: "",
  };
}

/**
 * Participants Portal access for one participant — who can log in to see
 * their information, pending invites, and a recorded "not using portal"
 * decision. Only the Managing Director can change anything; coordinators
 * see it read-only.
 */
export function PortalAccessCard({ participantId }: { participantId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const isMD = user?.role === "managing_director";
  const [summary, setSummary] = useState<PortalSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<GrantResult | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const [grantOpen, setGrantOpen] = useState(false);
  const [draft, setDraft] = useState<GrantDraft>(emptyDraft(null));
  const [revokeTarget, setRevokeTarget] = useState<PortalAccess | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [notUsingOpen, setNotUsingOpen] = useState(false);
  const [notUsing, setNotUsing] = useState<{ reason: NotUsingReason | ""; note: string; review_date: string }>({
    reason: "",
    note: "",
    review_date: "",
  });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getPortalSummary(participantId)
      .then((data) => { setSummary(data); setLoadError(null); })
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Could not load portal access."));
  }, [participantId]);

  useEffect(() => { load(); }, [load]);

  async function run<T>(action: () => Promise<T>, success?: (value: T) => void) {
    setBusy(true);
    try {
      const value = await action();
      success?.(value);
      load();
      return true;
    } catch (e) {
      toast({ title: "Couldn't save", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const live = summary?.access.filter((a) => a.status !== "revoked") ?? [];
  const revoked = summary?.access.filter((a) => a.status === "revoked") ?? [];
  const badge = STATUS_BADGE[summary?.status ?? "not_set"];
  const relationshipHint = RELATIONSHIP_OPTIONS.find((o) => o.value === draft.relationship)?.hint;
  const needsAuthority = draft.relationship !== "self";
  const grantValid =
    draft.full_name.trim() &&
    draft.email.includes("@") &&
    (!needsAuthority || draft.authority_notes.trim()) &&
    (draft.relationship !== "consented_family" || draft.consent_method);

  return (
    <div className="rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-4" style={{ borderColor: BORDER }}>
        <div className="flex items-center gap-2">
          <p className="text-sm font-black" style={{ color: TEXT }}>Participants Portal access</p>
          {summary && (
            <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ color: badge.color, background: badge.bg }}>
              {badge.label}
            </span>
          )}
        </div>
        {isMD && summary && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="gap-1.5" onClick={() => { setDraft(emptyDraft(summary)); setGrantOpen(true); }}>
              <MailPlus size={13} /> Invite someone
            </Button>
            {live.length === 0 && summary.status !== "not_using" && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setNotUsingOpen(true)}>
                <UserX size={13} /> Not using portal
              </Button>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3 p-5">
        {loadError && <p className="text-xs" style={{ color: DANGER }}>{loadError}</p>}
        {!summary && !loadError && <Loader2 className="animate-spin" size={18} style={{ color: PLUM }} />}

        {lastResult && <GrantResultNotice result={lastResult} onClose={() => setLastResult(null)} />}

        {summary?.status === "not_using" && summary.not_using && (
          <div className="rounded-lg border p-3 text-xs" style={{ borderColor: BORDER, color: TEXT }}>
            <p className="font-bold">
              {NOT_USING_REASON_OPTIONS.find((o) => o.value === summary.not_using?.reason)?.label}
            </p>
            {summary.not_using.note && <p className="mt-1" style={{ color: MUTED }}>{summary.not_using.note}</p>}
            <p className="mt-1" style={{ color: MUTED }}>
              Recorded {formatDate(summary.not_using.recorded_at)} · Review by {formatDate(summary.not_using.review_date)}
            </p>
          </div>
        )}

        {summary && summary.status === "not_set" && (
          <p className="text-xs" style={{ color: MUTED }}>
            No one has portal access yet. {isMD ? "Invite the participant or an authorised representative, or record that they won't use the portal." : ""}
          </p>
        )}

        {live.map((a) => {
          const state = accessStateLine(a);
          return (
            <div key={a.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3" style={{ borderColor: BORDER }}>
              <div className="min-w-0">
                <p className="text-sm font-bold" style={{ color: TEXT }}>
                  {a.full_name} <span className="font-medium" style={{ color: MUTED }}>· {a.relationship_label}</span>
                </p>
                <p className="text-xs" style={{ color: MUTED }}>{a.email}</p>
                <p className="mt-1 text-xs font-semibold" style={{ color: state.color }}>{state.text}</p>
                {a.authority_notes && <p className="mt-1 text-xs" style={{ color: MUTED }}>Authority: {a.authority_notes}</p>}
              </div>
              {isMD && (
                <div className="flex gap-2">
                  {a.status === "pending" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1.5"
                      disabled={busy}
                      onClick={() => run(() => resendPortalInvite(a.id), (r) => { setLastResult(r); toast({ title: "Invite resent" }); })}
                    >
                      <RefreshCw size={13} /> Resend
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setRevokeTarget(a); setRevokeReason(""); }}>
                    <ShieldOff size={13} /> Revoke
                  </Button>
                </div>
              )}
            </div>
          );
        })}

        {revoked.length > 0 && (
          <div>
            <button className="text-xs font-bold" style={{ color: PLUM }} onClick={() => setShowHistory((v) => !v)}>
              {showHistory ? "Hide" : "Show"} revoked access ({revoked.length})
            </button>
            {showHistory && (
              <div className="mt-2 space-y-2">
                {revoked.map((a) => (
                  <div key={a.id} className="rounded-lg border p-3 text-xs" style={{ borderColor: BORDER, color: MUTED }}>
                    <p className="font-bold" style={{ color: TEXT }}>{a.full_name} · {a.relationship_label}</p>
                    <p>{accessStateLine(a).text}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Grant / invite */}
      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Invite to the Participants Portal</DialogTitle>
            <DialogDescription>
              They'll get an email link, confirm their identity, and set a password. They sign in with this email.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Relationship to participant</Label>
              <Select value={draft.relationship} onValueChange={(v) => setDraft((d) => ({ ...d, relationship: v as PortalRelationship }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {RELATIONSHIP_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {relationshipHint && <p className="text-xs" style={{ color: MUTED }}>{relationshipHint}</p>}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="portal-full-name">Full name</Label>
                <Input id="portal-full-name" value={draft.full_name} onChange={(e) => setDraft((d) => ({ ...d, full_name: e.target.value }))} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="portal-email">Email</Label>
                <Input id="portal-email" type="email" value={draft.email} onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))} />
              </div>
            </div>
            {needsAuthority && (
              <div className="space-y-1.5">
                <Label htmlFor="portal-authority">Authority or consent (required)</Label>
                <Textarea
                  id="portal-authority"
                  rows={2}
                  placeholder="e.g. NDIA nominee appointment letter dated 3 Mar 2026, sighted by MD"
                  value={draft.authority_notes}
                  onChange={(e) => setDraft((d) => ({ ...d, authority_notes: e.target.value }))}
                />
              </div>
            )}
            {draft.relationship === "consented_family" && (
              <div className="space-y-1.5">
                <Label>How did the participant consent?</Label>
                <Select value={draft.consent_method} onValueChange={(v) => setDraft((d) => ({ ...d, consent_method: v as "written" | "verbal" }))}>
                  <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="written">Written</SelectItem>
                    <SelectItem value="verbal">Verbal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Identity check when they accept</Label>
              <Select value={draft.identity_method} onValueChange={(v) => setDraft((d) => ({ ...d, identity_method: v as PortalIdentityMethod }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {IDENTITY_METHOD_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setGrantOpen(false)}>Cancel</Button>
            <Button
              disabled={!grantValid || busy}
              onClick={async () => {
                const ok = await run(
                  () =>
                    grantPortalAccess(participantId, {
                      full_name: draft.full_name.trim(),
                      email: draft.email.trim(),
                      relationship: draft.relationship,
                      identity_method: draft.identity_method,
                      authority_notes: draft.authority_notes.trim() || undefined,
                      consent_method: draft.consent_method || undefined,
                    }),
                  (r) => setLastResult(r),
                );
                if (ok) setGrantOpen(false);
              }}
            >
              {busy && <Loader2 size={14} className="mr-1.5 animate-spin" />} Send invite
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke */}
      <Dialog open={!!revokeTarget} onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke portal access</DialogTitle>
            <DialogDescription>
              {revokeTarget?.full_name} will immediately lose access to this participant's information. The record is kept for audit.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="portal-revoke-reason">Reason (required)</Label>
            <Textarea id="portal-revoke-reason" rows={2} value={revokeReason} onChange={(e) => setRevokeReason(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRevokeTarget(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!revokeReason.trim() || busy}
              onClick={async () => {
                if (!revokeTarget) return;
                const ok = await run(() => revokePortalAccess(revokeTarget.id, revokeReason.trim()), () => toast({ title: "Access revoked" }));
                if (ok) setRevokeTarget(null);
              }}
            >
              Revoke access
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Not using portal */}
      <Dialog open={notUsingOpen} onOpenChange={setNotUsingOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record: not using the portal</DialogTitle>
            <DialogDescription>
              Records a deliberate decision so it's clear this wasn't missed. Agreements and invoices still go out by email or post.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Select value={notUsing.reason} onValueChange={(v) => setNotUsing((n) => ({ ...n, reason: v as NotUsingReason }))}>
                <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
                <SelectContent>
                  {NOT_USING_REASON_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              {notUsing.reason === "unable_no_representative" && (
                <p className="text-xs" style={{ color: WARNING }}>
                  Consider flagging this to the support coordinator — the participant may need an advocate or a nominee.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="portal-not-using-note">Note{notUsing.reason === "other" ? " (required)" : ""}</Label>
              <Textarea id="portal-not-using-note" rows={2} value={notUsing.note} onChange={(e) => setNotUsing((n) => ({ ...n, note: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="portal-review-date">Review by</Label>
              <Input
                id="portal-review-date"
                type="date"
                value={notUsing.review_date}
                onChange={(e) => setNotUsing((n) => ({ ...n, review_date: e.target.value }))}
              />
              <p className="text-xs" style={{ color: MUTED }}>Usually the next plan review or reassessment.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNotUsingOpen(false)}>Cancel</Button>
            <Button
              disabled={!notUsing.reason || !notUsing.review_date || (notUsing.reason === "other" && !notUsing.note.trim()) || busy}
              onClick={async () => {
                if (!notUsing.reason) return;
                const ok = await run(() =>
                  recordNotUsingPortal(participantId, {
                    reason: notUsing.reason as NotUsingReason,
                    note: notUsing.note.trim() || undefined,
                    review_date: notUsing.review_date,
                  }),
                );
                if (ok) setNotUsingOpen(false);
              }}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
