import { useState } from "react";
import { useLocation } from "wouter";
import { CareCliQLogoWithText } from "@/components/CareCliQLogoSVG";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, CheckCircle2 } from "lucide-react";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const PLUM = "var(--cc-plum)";
const SURFACE = "var(--cc-surface)";
const SOFT = "var(--cc-soft)";
const SUCCESS = "var(--cc-status-success)";
const SUCCESS_BG = "var(--cc-status-success-bg)";

const STEPS = ["Participant details", "NDIS & support needs", "Your details", "Review & submit"];

type ReferralForm = {
  fullName: string;
  dob: string;
  phone: string;
  email: string;
  ndisNumber: string;
  primaryDisability: string;
  supportNeeds: string;
  referrerName: string;
  referrerRelationship: string;
  referrerPhone: string;
  referrerEmail: string;
};

const EMPTY_FORM: ReferralForm = {
  fullName: "", dob: "", phone: "", email: "",
  ndisNumber: "", primaryDisability: "", supportNeeds: "",
  referrerName: "", referrerRelationship: "family", referrerPhone: "", referrerEmail: "",
};

/**
 * Public, unauthenticated referral intake form — reached from the
 * "View public referral form" link on the MD's Participant Onboarding
 * board. No participant_onboarding backend exists yet (same constraint as
 * the rest of that page), so submitting here doesn't yet create a real
 * Enquiry card — it's the UI/UX of the intake flow, not wired to storage.
 */
export default function ParticipantReferralPage() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<ReferralForm>(EMPTY_FORM);
  const [submitted, setSubmitted] = useState(false);

  function update<K extends keyof ReferralForm>(key: K, value: ReferralForm[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  const canLeaveStep0 = form.fullName.trim() && form.dob.trim();
  const canLeaveStep2 = form.referrerName.trim();

  function next() {
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  }
  function back() {
    setStep((s) => Math.max(s - 1, 0));
  }
  function submit() {
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ background: "#F7F5F2" }}>
        <div className="w-full max-w-md rounded-2xl p-8 text-center" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          <div className="mx-auto mb-4 h-14 w-14 rounded-full flex items-center justify-center" style={{ background: SUCCESS_BG }}>
            <CheckCircle2 size={28} style={{ color: SUCCESS }} />
          </div>
          <h1 className="text-xl font-black" style={{ color: TEXT }}>Thanks — referral received</h1>
          <p className="text-sm mt-2" style={{ color: MUTED }}>
            We'll review {form.fullName.split(" ")[0] || "the participant"}'s details and be in touch within 2 business days.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen relative flex items-start justify-center px-4 py-12" style={{ background: "#F7F5F2" }}>
      <button
        type="button"
        onClick={() => navigate("/onboard-participant")}
        className="absolute top-15 left-10 flex items-center gap-1.5 text-[15px] font-bold hover:opacity-70"
        style={{ color: "var(--cc-plum)" }}
      >
        <ArrowLeft size={20} style={{ color: "var(--cc-plum)" }} /> Back to Participant Onboarding
      </button>
      <div className="w-full max-w-lg">
        <div className="flex justify-center mb-6">
          <CareCliQLogoWithText size={40} />
        </div>
        <div className="text-center mb-6">
          <h1 className="text-2xl font-black tracking-tight" style={{ color: TEXT }}>Refer someone to our team</h1>
          <p className="text-sm mt-1.5" style={{ color: MUTED }}>Takes about 3 minutes. We'll be in touch within 2 business days.</p>
        </div>
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((_, i) => (
            <span key={i} className="h-2.5 w-2.5 rounded-full" style={{ background: i === step ? PLUM : BORDER }} />
          ))}
        </div>

        <div className="rounded-2xl p-6 sm:p-8 space-y-4" style={{ background: SURFACE, border: `1px solid ${BORDER}` }}>
          {step === 0 && (
            <>
              <h2 className="text-lg font-black" style={{ color: TEXT }}>Participant details</h2>
              <div className="space-y-1.5">
                <label className="text-xs font-bold" style={{ color: TEXT }}>Full name <span style={{ color: PLUM }}>*</span></label>
                <Input value={form.fullName} onChange={(e) => update("fullName", e.target.value)} placeholder="Jordan Blake" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold" style={{ color: TEXT }}>Date of birth <span style={{ color: PLUM }}>*</span></label>
                <Input type="date" value={form.dob} onChange={(e) => update("dob", e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold" style={{ color: TEXT }}>Contact phone</label>
                <Input value={form.phone} onChange={(e) => update("phone", e.target.value)} placeholder="0412 345 678" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold" style={{ color: TEXT }}>Contact email</label>
                <Input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} placeholder="jordan@example.com" />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="text-lg font-black" style={{ color: TEXT }}>NDIS &amp; support needs</h2>
              <div className="space-y-1.5">
                <label className="text-xs font-bold" style={{ color: TEXT }}>NDIS number (if known)</label>
                <Input value={form.ndisNumber} onChange={(e) => update("ndisNumber", e.target.value)} placeholder="430123456" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold" style={{ color: TEXT }}>Primary disability</label>
                <Input value={form.primaryDisability} onChange={(e) => update("primaryDisability", e.target.value)} placeholder="e.g. Autism spectrum disorder" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold" style={{ color: TEXT }}>Support needs / notes</label>
                <Textarea
                  value={form.supportNeeds}
                  onChange={(e) => update("supportNeeds", e.target.value)}
                  placeholder="Tell us a bit about the support they're looking for…"
                  className="min-h-[90px]"
                />
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-lg font-black" style={{ color: TEXT }}>Your details</h2>
              <div className="space-y-1.5">
                <label className="text-xs font-bold" style={{ color: TEXT }}>Your name <span style={{ color: PLUM }}>*</span></label>
                <Input value={form.referrerName} onChange={(e) => update("referrerName", e.target.value)} placeholder="Your full name" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold" style={{ color: TEXT }}>Relationship to participant</label>
                <Select value={form.referrerRelationship} onValueChange={(v) => update("referrerRelationship", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="self">Myself (the participant)</SelectItem>
                    <SelectItem value="family">Family member / carer</SelectItem>
                    <SelectItem value="support_coordinator">Support coordinator</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold" style={{ color: TEXT }}>Your phone</label>
                <Input value={form.referrerPhone} onChange={(e) => update("referrerPhone", e.target.value)} placeholder="0412 345 678" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-bold" style={{ color: TEXT }}>Your email</label>
                <Input type="email" value={form.referrerEmail} onChange={(e) => update("referrerEmail", e.target.value)} placeholder="you@example.com" />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-lg font-black" style={{ color: TEXT }}>Review &amp; submit</h2>
              <div className="rounded-xl p-4 space-y-1.5 text-sm" style={{ background: SOFT }}>
                <p style={{ color: TEXT }}><strong>{form.fullName || "—"}</strong> · {form.dob || "DOB not provided"}</p>
                <p style={{ color: MUTED }}>{form.phone || "No phone"} · {form.email || "No email"}</p>
                {form.ndisNumber && <p style={{ color: MUTED }}>NDIS {form.ndisNumber}</p>}
                <p style={{ color: MUTED }}>Referred by {form.referrerName || "—"} ({form.referrerRelationship.replace("_", " ")})</p>
              </div>
              <p className="text-xs" style={{ color: MUTED }}>
                By submitting, you confirm the information above is accurate to the best of your knowledge.
              </p>
            </>
          )}

          <div className="flex items-center justify-between gap-3 pt-4 border-t" style={{ borderColor: BORDER }}>
            {step > 0 ? (
              <Button variant="outline" className="rounded-lg" onClick={back}>Back</Button>
            ) : <span />}
            {step < STEPS.length - 1 ? (
              <Button
                variant="navy"
                className="rounded-lg px-8"
                onClick={next}
                disabled={(step === 0 && !canLeaveStep0) || (step === 2 && !canLeaveStep2)}
              >
                Next
              </Button>
            ) : (
              <Button variant="navy" className="rounded-lg px-8" onClick={submit}>Submit referral</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
