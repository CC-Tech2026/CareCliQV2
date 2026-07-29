import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { CheckCircle2, FileText, Loader2 } from "lucide-react";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getHireForSigning, signHire } from "@/services/employeeOnboardingService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const PLUM = "var(--cc-plum)";
const SURFACE = "var(--cc-surface)";

const DOC_TYPE_LABELS: Record<string, string> = {
  offer_letter: "Offer letter",
  service_agreement: "Service agreement",
  other: "Other",
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
    <div className="min-h-screen flex items-center justify-center px-4 py-10" style={{ background: "var(--cc-bg)" }}>
      <div className="w-full max-w-lg rounded-2xl border p-6 sm:p-8 space-y-6" style={{ background: SURFACE, borderColor: BORDER }}>
        <div className="flex justify-center"><CareCliQLogo size={40} /></div>

        {alreadySigned ? (
          <div className="text-center space-y-2 py-6">
            <CheckCircle2 size={40} className="mx-auto" style={{ color: "var(--cc-status-success)" }} />
            <h1 className="text-lg font-black" style={{ color: TEXT }}>Thanks, you're all signed!</h1>
            <p className="text-sm" style={{ color: MUTED }}>
              We'll be in touch shortly with an invite to set up your CareCliQ login.
            </p>
          </div>
        ) : (
          <>
            <div className="text-center">
              <h1 className="text-lg font-black" style={{ color: TEXT }}>Review &amp; sign your offer</h1>
              <p className="text-sm mt-1" style={{ color: MUTED }}>
                Hi {hire.full_name}, please review the document{hire.documents.length !== 1 ? "s" : ""} below before signing.
              </p>
            </div>

            <div className="space-y-2">
              {hire.documents.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3" style={{ borderColor: BORDER }}>
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileText size={16} style={{ color: PLUM }} />
                    <div className="min-w-0">
                      <p className="text-sm font-bold truncate" style={{ color: TEXT }}>{d.title}</p>
                      <p className="text-xs" style={{ color: MUTED }}>{DOC_TYPE_LABELS[d.document_type] ?? d.document_type}</p>
                    </div>
                  </div>
                  {d.file_url && (
                    <a href={d.file_url} target="_blank" rel="noreferrer" className="text-xs font-bold underline shrink-0" style={{ color: PLUM }}>
                      View
                    </a>
                  )}
                </div>
              ))}
            </div>

            {hire.employer_signed_name && (
              <p className="text-xs" style={{ color: MUTED }}>
                Signed by {hire.employer_signed_name} on behalf of your employer.
              </p>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider" style={{ color: MUTED }}>
                Type your full legal name to sign
              </label>
              <Input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={hire.full_name} />
            </div>

            {signMut.isError && (
              <p className="text-xs font-bold" style={{ color: "var(--cc-status-danger)" }}>
                Could not sign — please try again.
              </p>
            )}

            <Button
              variant="navy"
              className="w-full rounded-xl gap-2"
              onClick={() => signMut.mutate()}
              disabled={!fullName.trim() || signMut.isPending}
            >
              {signMut.isPending ? <Loader2 size={14} className="animate-spin" /> : null} I agree and sign
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

function CenterMessage({ title, body, icon }: { title: string; body: string; icon?: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "var(--cc-bg)" }}>
      <div className="text-center space-y-2">
        {icon}
        <h1 className="text-lg font-black" style={{ color: TEXT }}>{title}</h1>
        {body && <p className="text-sm" style={{ color: MUTED }}>{body}</p>}
      </div>
    </div>
  );
}
