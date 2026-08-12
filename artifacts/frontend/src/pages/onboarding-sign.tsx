import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Check, FileText, Loader2, Briefcase, ClipboardCheck, ShieldCheck } from "lucide-react";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getHireForSigning, signHire } from "@/services/employeeOnboardingService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const PLUM = "var(--cc-plum)";
const SURFACE = "var(--cc-surface)";
const SIDEBAR_BG = "#1E1640";
const SIDEBAR_MUTED = "#8F86B3";

const DOC_TYPE_META: Record<string, { label: string; icon: typeof FileText }> = {
  offer_letter: { label: "Offer letter", icon: Briefcase },
  service_agreement: { label: "Service agreement", icon: ClipboardCheck },
  other: { label: "Other", icon: FileText },
};

const STEPS = ["Review documents", "Sign & confirm", "All done"];

function SidebarStep({ index, label, active, done }: { index: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div
        className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-black shrink-0"
        style={{
          background: done ? "#22C55E" : active ? "#fff" : "transparent",
          color: done ? "#fff" : active ? SIDEBAR_BG : SIDEBAR_MUTED,
          border: active || done ? "none" : `1.5px solid ${SIDEBAR_MUTED}`,
        }}
      >
        {done ? <Check size={13} strokeWidth={3} /> : index}
      </div>
      <span className="text-sm font-bold" style={{ color: active ? "#fff" : SIDEBAR_MUTED }}>{label}</span>
    </div>
  );
}

export default function OnboardingSignPage() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") ?? "";
  const [fullName, setFullName] = useState("");

  const query = useQuery({
    queryKey: ["onboarding-sign", token],
    queryFn: () => getHireForSigning(token),
    enabled: !!token,
    retry: false,
  });

  const signMut = useMutation({
    mutationFn: () => signHire(token, fullName.trim()),
    onSuccess: () => query.refetch(),
  });

  if (!token) {
    return <CenterMessage title="Missing signing link" body="This link is invalid. Please check the email you were sent." />;
  }

  if (query.isLoading) {
    return <CenterMessage title="Loading…" body="" icon={<Loader2 size={28} className="animate-spin" style={{ color: PLUM }} />} />;
  }

  if (query.isError || !query.data) {
    return <CenterMessage title="Link not found or expired" body="Please contact whoever sent you this invitation." />;
  }

  const hire = query.data;
  const alreadySigned = !!hire.worker_signed_at || hire.status !== "awaiting_signatures" || signMut.isSuccess;
  const currentStep = alreadySigned ? 2 : 1;

  return (
    <div className="min-h-screen flex" style={{ background: SURFACE }}>
      {/* Left step sidebar */}
      <aside className="hidden md:flex w-72 shrink-0 flex-col justify-between p-8" style={{ background: SIDEBAR_BG }}>
        <div>
          <div className="mb-10">
            <CareCliQLogo size={36} />
          </div>
          <div className="space-y-6">
            {STEPS.map((label, i) => (
              <SidebarStep key={label} index={i + 1} label={label} active={i === currentStep} done={i < currentStep} />
            ))}
          </div>
        </div>
        <p className="text-[11px]" style={{ color: SIDEBAR_MUTED }}>
          Questions about this offer? Reply to the email you received.
        </p>
      </aside>

      {/* Right content */}
      <main className="flex-1 flex items-center justify-center px-4 py-10 sm:py-16">
        <div className="w-full max-w-md">
          <div className="md:hidden flex justify-center mb-6"><CareCliQLogo size={36} /></div>

          {alreadySigned ? (
            <div className="text-center space-y-3">
              <div className="mx-auto h-14 w-14 rounded-full flex items-center justify-center" style={{ background: "var(--cc-status-success-bg)" }}>
                <Check size={26} strokeWidth={3} style={{ color: "var(--cc-status-success)" }} />
              </div>
              <h1 className="text-xl font-black" style={{ color: TEXT }}>You're all signed, {hire.full_name.split(" ")[0]}!</h1>
              <p className="text-sm max-w-xs mx-auto" style={{ color: MUTED }}>
                We'll be in touch shortly with an email to set up your CareCliQ login.
              </p>
            </div>
          ) : (
            <>
              <p className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: PLUM }}>Step {currentStep + 1} of {STEPS.length}</p>
              <h1 className="text-2xl font-black mt-1" style={{ color: TEXT }}>Review &amp; sign your offer</h1>
              <p className="text-sm mt-2" style={{ color: MUTED }}>
                Hi {hire.full_name}, please review the document{hire.documents.length !== 1 ? "s" : ""} below before signing.
              </p>

              <div className="mt-6 space-y-2">
                {hire.documents.map((d) => {
                  const meta = DOC_TYPE_META[d.document_type] ?? DOC_TYPE_META.other;
                  const Icon = meta.icon;
                  return (
                    <div key={d.id} className="flex items-center justify-between gap-3 rounded-lg border p-3.5" style={{ borderColor: BORDER }}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-lg shrink-0 flex items-center justify-center" style={{ background: "var(--cc-soft)", color: PLUM }}>
                          <Icon size={16} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-bold truncate" style={{ color: TEXT }}>{d.title}</p>
                          <p className="text-xs" style={{ color: MUTED }}>{meta.label}</p>
                        </div>
                      </div>
                      {d.file_url && (
                        <a href={d.file_url} target="_blank" rel="noreferrer" className="text-xs font-bold underline shrink-0" style={{ color: PLUM }}>
                          View
                        </a>
                      )}
                    </div>
                  );
                })}
              </div>

              {hire.employer_signed_name && (
                <div className="flex items-center gap-2 text-xs mt-4" style={{ color: MUTED }}>
                  <ShieldCheck size={14} style={{ color: "var(--cc-status-success)" }} className="shrink-0" />
                  Already signed by {hire.employer_signed_name} on behalf of your employer.
                </div>
              )}

              <div className="mt-6 border-t pt-6" style={{ borderColor: BORDER }}>
                <label className="text-xs font-bold" style={{ color: TEXT }}>
                  Type your full legal name to sign
                </label>
                <Input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder={hire.full_name}
                  className="mt-1.5"
                />
              </div>

              {signMut.isError && (
                <p className="text-xs font-bold mt-3" style={{ color: "var(--cc-status-danger)" }}>
                  Could not sign — please try again.
                </p>
              )}

              <Button
                variant="navy"
                className="w-full rounded-lg gap-2 h-11 mt-5"
                onClick={() => signMut.mutate()}
                disabled={!fullName.trim() || signMut.isPending}
              >
                {signMut.isPending ? <Loader2 size={14} className="animate-spin" /> : null} I agree and sign
              </Button>
              <p className="text-[10px] text-center mt-3" style={{ color: MUTED }}>
                By signing, you confirm you've read and agree to the document{hire.documents.length !== 1 ? "s" : ""} above.
              </p>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function CenterMessage({ title, body, icon }: { title: string; body: string; icon?: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: SURFACE }}>
      <div className="w-full max-w-sm text-center space-y-3">
        <div className="flex justify-center"><CareCliQLogo size={32} /></div>
        {icon}
        <h1 className="text-lg font-black" style={{ color: TEXT }}>{title}</h1>
        {body && <p className="text-sm" style={{ color: MUTED }}>{body}</p>}
      </div>
    </div>
  );
}
