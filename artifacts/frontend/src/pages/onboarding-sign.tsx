import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, FileText, Loader2, Briefcase, ClipboardCheck, PenLine, ShieldCheck } from "lucide-react";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getHireForSigning, signHire } from "@/services/employeeOnboardingService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const PLUM = "var(--cc-plum)";
const SURFACE = "var(--cc-surface)";

const DOC_TYPE_META: Record<string, { label: string; icon: typeof FileText }> = {
  offer_letter: { label: "Offer letter", icon: Briefcase },
  service_agreement: { label: "Service agreement", icon: ClipboardCheck },
  other: { label: "Other", icon: FileText },
};

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
  const alreadySigned = hire.status === "signed" || signMut.isSuccess;

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ background: "linear-gradient(180deg, var(--cc-active-bg), var(--cc-bg) 240px)" }}>
      <div className="w-full max-w-lg space-y-4">
        <div className="flex justify-center"><CareCliQLogo size={44} /></div>

        <div className="rounded-2xl border p-6 sm:p-8 space-y-6 shadow-sm" style={{ background: SURFACE, borderColor: BORDER }}>
          {alreadySigned ? (
            <div className="text-center space-y-3 py-6">
              <div className="mx-auto h-16 w-16 rounded-full flex items-center justify-center" style={{ background: "var(--cc-status-success-bg)" }}>
                <CheckCircle2 size={32} style={{ color: "var(--cc-status-success)" }} />
              </div>
              <h1 className="text-xl font-black" style={{ color: TEXT }}>You're all signed, {hire.full_name.split(" ")[0]}!</h1>
              <p className="text-sm max-w-xs mx-auto" style={{ color: MUTED }}>
                We'll be in touch shortly with an email to set up your CareCliQ login.
              </p>
            </div>
          ) : (
            <>
              <div className="text-center space-y-1">
                <p className="text-[11px] font-black uppercase tracking-[0.16em]" style={{ color: PLUM }}>You've been offered a role</p>
                <h1 className="text-xl font-black" style={{ color: TEXT }}>Review &amp; sign your offer</h1>
                <p className="text-sm mt-1" style={{ color: MUTED }}>
                  Hi {hire.full_name}, please review the document{hire.documents.length !== 1 ? "s" : ""} below before signing.
                </p>
              </div>

              <div className="space-y-2">
                {hire.documents.map((d) => {
                  const meta = DOC_TYPE_META[d.document_type] ?? DOC_TYPE_META.other;
                  const Icon = meta.icon;
                  return (
                    <div key={d.id} className="flex items-center justify-between gap-3 rounded-xl p-3.5" style={{ background: "var(--cc-soft)" }}>
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="h-9 w-9 rounded-lg shrink-0 flex items-center justify-center" style={{ background: "var(--cc-active-bg)", color: PLUM }}>
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
                <div className="flex items-center gap-2 text-xs" style={{ color: MUTED }}>
                  <ShieldCheck size={14} style={{ color: "var(--cc-status-success)" }} className="shrink-0" />
                  Already signed by {hire.employer_signed_name} on behalf of your employer.
                </div>
              )}

              <div className="rounded-xl p-4 space-y-3" style={{ background: "var(--cc-active-bg)" }}>
                <div className="flex items-center gap-2">
                  <PenLine size={15} style={{ color: PLUM }} />
                  <p className="text-xs font-black uppercase tracking-wide" style={{ color: TEXT }}>Your signature</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold" style={{ color: MUTED }}>
                    Type your full legal name to sign
                  </label>
                  <Input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={hire.full_name}
                    className="bg-white"
                    style={{ fontFamily: "cursive", fontSize: "16px" }}
                  />
                </div>
              </div>

              {signMut.isError && (
                <p className="text-xs font-bold text-center" style={{ color: "var(--cc-status-danger)" }}>
                  Could not sign — please try again.
                </p>
              )}

              <Button
                variant="navy"
                className="w-full rounded-xl gap-2 h-11"
                onClick={() => signMut.mutate()}
                disabled={!fullName.trim() || signMut.isPending}
              >
                {signMut.isPending ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={15} />} I agree and sign
              </Button>
              <p className="text-[10px] text-center" style={{ color: MUTED }}>
                By signing, you confirm you've read and agree to the document{hire.documents.length !== 1 ? "s" : ""} above.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function CenterMessage({ title, body, icon }: { title: string; body: string; icon?: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "linear-gradient(180deg, var(--cc-active-bg), var(--cc-bg) 240px)" }}>
      <div className="w-full max-w-sm rounded-2xl border p-8 text-center space-y-3 shadow-sm" style={{ background: SURFACE, borderColor: BORDER }}>
        <div className="flex justify-center"><CareCliQLogo size={32} /></div>
        {icon}
        <h1 className="text-lg font-black" style={{ color: TEXT }}>{title}</h1>
        {body && <p className="text-sm" style={{ color: MUTED }}>{body}</p>}
      </div>
    </div>
  );
}
