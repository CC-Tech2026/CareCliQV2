import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, FileText, Loader2, Mail, ShieldCheck } from "lucide-react";
import { CareCliQLogo } from "@/components/CareCliQLogoSVG";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { OtpInput } from "@/components/auth/OtpInput";
import { SignatureCanvas, useSignatureCanvasState } from "@/components/shifts/SignatureCanvas";
import {
  getAgreementForSigning,
  openSigningDocument,
  sendAgreementSigningCode,
  signAgreementByLink,
  verifyAgreementSigningCode,
  type PublicAgreementView,
} from "@/services/serviceAgreementService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const PLUM = "var(--cc-plum)";
const SURFACE = "var(--cc-surface)";
const SIDEBAR_BG = "#1E1640";
const SIDEBAR_MUTED = "#8F86B3";
const DANGER = "var(--cc-status-danger)";

const STEPS = ["Confirm it's you", "Read & sign", "Done"];

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" });
}

function SidebarStep({ index, label, active, done }: { index: number; label: string; active: boolean; done: boolean }) {
  return (
    <div className="flex items-center gap-3" aria-current={active ? "step" : undefined}>
      <div
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-black"
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

function MobileSteps({ current }: { current: number }) {
  return (
    <ol className="mb-6 flex items-center gap-2 md:hidden" aria-label="Progress">
      {STEPS.map((label, i) => (
        <li key={label} className="flex flex-1 flex-col gap-1">
          <span className="h-1 rounded-full" style={{ background: i <= current ? PLUM : BORDER }} />
          <span className="text-[10px] font-bold" style={{ color: i === current ? TEXT : MUTED }}>{label}</span>
        </li>
      ))}
    </ol>
  );
}

function errorStatus(error: unknown) {
  return (error as (Error & { status?: number }) | null)?.status;
}

export default function AgreementSignPage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [code, setCode] = useState("");
  const [codeRequested, setCodeRequested] = useState(false);
  const [codeMessage, setCodeMessage] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [fullName, setFullName] = useState("");
  const [understood, setUnderstood] = useState(false);
  const [docError, setDocError] = useState<string | null>(null);
  const signature = useSignatureCanvasState();

  const query = useQuery({
    queryKey: ["agreement-sign", token],
    queryFn: () => getAgreementForSigning(token),
    enabled: !!token,
    retry: false,
  });
  const view = query.data;
  const signed = view?.status === "signed";
  const needsCode = !!view && !signed && !view.email_verified;

  const sendCode = useMutation({
    mutationFn: () => sendAgreementSigningCode(token),
    onSuccess: (data) => {
      setCodeMessage(data.message ?? "We've sent you a 6-digit code.");
      setCodeError(null);
    },
    onError: (e) => setCodeError(e instanceof Error ? e.message : "We couldn't send a code. Try again."),
  });

  const verify = useMutation({
    mutationFn: () => verifyAgreementSigningCode(token, code),
    onSuccess: () => {
      setCodeError(null);
      void query.refetch();
    },
    onError: (e) => {
      setCode("");
      setCodeError(e instanceof Error ? e.message : "That code isn't right.");
    },
  });

  const sign = useMutation({
    mutationFn: () =>
      signAgreementByLink(token, { full_name: fullName.trim(), signature_png: signature.signaturePng, understood }),
    onSuccess: () => void query.refetch(),
  });

  // Send the first code automatically when the page opens.
  useEffect(() => {
    if (needsCode && !codeRequested) {
      setCodeRequested(true);
      sendCode.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsCode, codeRequested]);

  // Pre-fill the signer's name from the invitation.
  useEffect(() => {
    if (view?.signer_name && !fullName) setFullName(view.signer_name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view?.signer_name]);

  // Submit as soon as all six digits are in.
  useEffect(() => {
    if (code.length === 6 && !verify.isPending && !codeError) verify.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  if (!token) {
    return <CenterMessage title="This link is incomplete" body="Open the link from your email again, or ask your provider to resend it." />;
  }
  if (query.isLoading) {
    return <CenterMessage title="Opening your agreement…" body="" icon={<Loader2 size={28} className="mx-auto animate-spin" style={{ color: PLUM }} />} />;
  }
  if (query.isError || !view) {
    const status = errorStatus(query.error);
    if (status === 410) {
      return <CenterMessage title="This link has expired" body="Signing links work for 14 days. Ask your provider to send you a new one." />;
    }
    if (status === 404) {
      return (
        <CenterMessage
          title="This link doesn't work any more"
          body="It may have been replaced by a newer email, or cancelled by your provider. Check your inbox for the latest one, or contact your provider."
        />
      );
    }
    return (
      <CenterMessage
        title="Something went wrong on our side"
        body="Your link is fine — we just couldn't load the agreement. Please try again in a few minutes."
        action={<Button variant="outline" onClick={() => void query.refetch()}>Try again</Button>}
      />
    );
  }

  const org = view.organization_name ?? "Your NDIS provider";
  const whose = view.relationship && view.relationship !== "participant" ? `${view.participant_first_name}'s` : "your";
  const current = signed ? 2 : needsCode ? 0 : 1;
  const canSign = fullName.trim().length >= 2 && signature.hasStroke && understood;
  const openDoc = () => {
    setDocError(null);
    openSigningDocument(token).catch((e) => setDocError(e instanceof Error ? e.message : "Couldn't open the PDF."));
  };

  return (
    <div className="flex min-h-screen" style={{ background: SURFACE }}>
      <aside className="hidden w-72 shrink-0 flex-col justify-between p-8 md:flex" style={{ background: SIDEBAR_BG }}>
        <div>
          <div className="mb-10">
            {view.logo_url ? (
              <img src={view.logo_url} alt={org} className="max-h-10 max-w-[180px] rounded bg-white p-1.5 object-contain" />
            ) : (
              <CareCliQLogo size={36} />
            )}
          </div>
          <p className="mb-6 text-xs font-semibold" style={{ color: SIDEBAR_MUTED }}>Service agreement from {org}</p>
          <div className="space-y-6">
            {STEPS.map((label, i) => (
              <SidebarStep key={label} index={i + 1} label={label} active={i === current} done={i < current} />
            ))}
          </div>
        </div>
        <p className="text-[11px] leading-relaxed" style={{ color: SIDEBAR_MUTED }}>
          Questions before you sign? Contact {org} — you don't have to sign straight away.
        </p>
      </aside>

      <main className="flex flex-1 justify-center px-4 py-10 sm:py-14">
        <div className={needsCode || signed ? "w-full max-w-md self-center" : "w-full max-w-2xl"}>
          <div className="mb-6 flex justify-center md:hidden">
            {view.logo_url ? <img src={view.logo_url} alt={org} className="max-h-10 object-contain" /> : <CareCliQLogo size={36} />}
          </div>
          <MobileSteps current={current} />

          {signed ? (
            <div className="space-y-4 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full" style={{ background: "var(--cc-status-success-bg)" }}>
                <Check size={26} strokeWidth={3} style={{ color: "var(--cc-status-success)" }} />
              </div>
              <h1 className="text-2xl font-black" style={{ color: TEXT }}>Signed — thank you</h1>
              <p className="mx-auto max-w-sm text-sm" style={{ color: MUTED }}>
                {view.participant_signed_name ? `${view.participant_signed_name} signed` : "Signed"}
                {formatDate(view.participant_signed_at) ? ` on ${formatDate(view.participant_signed_at)}` : ""}. {org} has been
                told and keeps the signed copy. Keep this link to see it again.
              </p>
              <Button variant="outline" className="gap-1.5" onClick={openDoc}>
                <FileText size={15} /> Download signed agreement
              </Button>
              {docError && <p className="text-xs" style={{ color: DANGER }}>{docError}</p>}
            </div>
          ) : needsCode ? (
            <>
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full" style={{ background: "var(--cc-soft)" }}>
                <Mail size={20} style={{ color: PLUM }} />
              </div>
              <h1 className="mt-3 text-center text-2xl font-black" style={{ color: TEXT }}>
                Hi {view.signer_name?.split(" ")[0] ?? "there"}, confirm it's you
              </h1>
              <p className="mt-2 text-center text-sm" style={{ color: MUTED }}>
                {org} has sent you {whose} NDIS service agreement. It contains personal details, so enter the
                6-digit code we emailed to <strong style={{ color: TEXT }}>{view.email_hint}</strong>.
              </p>
              <div className="mt-6">
                <label id="agreement-code-label" className="mb-3 block text-[11px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
                  Code from your email
                </label>
                <OtpInput
                  ariaLabelledBy="agreement-code-label"
                  value={code}
                  onChange={(v) => {
                    setCode(v);
                    if (codeError) setCodeError(null);
                  }}
                  disabled={verify.isPending}
                  error={!!codeError}
                />
                <p role={codeError ? "alert" : "status"} className="mt-2 min-h-[18px] text-[12px] font-medium" style={{ color: codeError ? DANGER : MUTED }}>
                  {codeError ?? (sendCode.isPending ? "Sending a code…" : codeMessage)}
                </p>
              </div>
              <Button
                variant="navy"
                className="mt-4 h-11 w-full gap-2 rounded-lg"
                onClick={() => verify.mutate()}
                disabled={code.length !== 6 || verify.isPending}
              >
                {verify.isPending ? <Loader2 size={14} className="animate-spin" /> : null} Continue
                {!verify.isPending && <ArrowRight size={14} />}
              </Button>
              <button
                type="button"
                onClick={() => sendCode.mutate()}
                disabled={sendCode.isPending}
                className="mt-4 w-full text-center text-[12px] font-bold disabled:opacity-50"
                style={{ color: PLUM }}
              >
                Didn't get it? Send a new code
              </button>
            </>
          ) : (
            <ReviewAndSign
              view={view}
              org={org}
              whose={whose}
              fullName={fullName}
              setFullName={setFullName}
              understood={understood}
              setUnderstood={setUnderstood}
              onSignatureChange={signature.onCanvasChange}
              openDoc={openDoc}
              docError={docError}
              canSign={canSign}
              signing={sign.isPending}
              signError={sign.isError ? (sign.error instanceof Error ? sign.error.message : "Couldn't sign. Try again.") : null}
              onSign={() => sign.mutate()}
            />
          )}
        </div>
      </main>
    </div>
  );
}

function ReviewAndSign({
  view, org, whose, fullName, setFullName, understood, setUnderstood, onSignatureChange, openDoc, docError,
  canSign, signing, signError, onSign,
}: {
  view: PublicAgreementView;
  org: string;
  whose: string;
  fullName: string;
  setFullName: (v: string) => void;
  understood: boolean;
  setUnderstood: (v: boolean) => void;
  onSignatureChange: ReturnType<typeof useSignatureCanvasState>["onCanvasChange"];
  openDoc: () => void;
  docError: string | null;
  canSign: boolean;
  signing: boolean;
  signError: string | null;
  onSign: () => void;
}) {
  const a = view.agreement;
  return (
    <>
      <p className="text-[11px] font-black uppercase tracking-[0.14em]" style={{ color: PLUM }}>
        {a?.agreement_number ?? "Service agreement"}
      </p>
      <h1 className="mt-1 text-2xl font-black" style={{ color: TEXT }}>Read {whose} service agreement</h1>
      <p className="mt-2 text-sm" style={{ color: MUTED }}>
        Here's a summary. Open the full agreement to read every term before you sign.
      </p>

      {a && (
        <div className="mt-6 space-y-4">
          <dl className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3" style={{ borderColor: BORDER }}>
            <div>
              <dt className="text-xs" style={{ color: MUTED }}>Provider</dt>
              <dd className="text-sm font-semibold" style={{ color: TEXT }}>{org}</dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: MUTED }}>Agreement period</dt>
              <dd className="text-sm font-semibold" style={{ color: TEXT }}>{a.period}</dd>
            </div>
            <div>
              <dt className="text-xs" style={{ color: MUTED }}>Plan management</dt>
              <dd className="text-sm font-semibold" style={{ color: TEXT }}>
                {a.plan_management}
                {a.plan_manager && <span className="block text-xs font-normal" style={{ color: MUTED }}>{a.plan_manager}</span>}
              </dd>
            </div>
          </dl>

          <section aria-label="Supports" className="overflow-hidden rounded-xl border" style={{ borderColor: BORDER }}>
            <h2 className="border-b px-4 py-2.5 text-sm font-bold" style={{ borderColor: BORDER, color: TEXT }}>Supports and prices</h2>
            {a.supports.map((s, i) => (
              <div key={i} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b px-4 py-3 last:border-b-0" style={{ borderColor: BORDER }}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium" style={{ color: TEXT }}>{s.name}</p>
                  <p className="text-xs" style={{ color: MUTED }}>{[s.detail, `${s.quantity} at ${s.rate}`].filter(Boolean).join(" · ")}</p>
                </div>
                <p className="text-sm font-semibold tabular-nums" style={{ color: TEXT }}>{s.total}</p>
              </div>
            ))}
            <div className="flex items-center justify-between px-4 py-2.5 text-sm" style={{ background: "var(--cc-soft)" }}>
              <span className="font-medium" style={{ color: TEXT }}>Total</span>
              <span className="font-bold tabular-nums" style={{ color: TEXT }}>{a.total}</span>
            </div>
          </section>

          <dl className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border p-3" style={{ borderColor: BORDER }}>
              <dt className="text-xs" style={{ color: MUTED }}>Cancellations</dt>
              <dd className="mt-0.5 text-sm" style={{ color: TEXT }}>{a.cancellations}</dd>
            </div>
            <div className="rounded-xl border p-3" style={{ borderColor: BORDER }}>
              <dt className="text-xs" style={{ color: MUTED }}>Price changes</dt>
              <dd className="mt-0.5 text-sm" style={{ color: TEXT }}>{a.price_changes}</dd>
            </div>
          </dl>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="outline" className="gap-1.5" onClick={openDoc}>
          <FileText size={15} /> Read the full agreement (PDF)
        </Button>
        {view.provider_signed_name && (
          <span className="flex items-center gap-1.5 text-xs" style={{ color: MUTED }}>
            <ShieldCheck size={14} style={{ color: "var(--cc-status-success)" }} />
            Signed by {view.provider_signed_name} for {org}
          </span>
        )}
      </div>
      {docError && <p className="mt-2 text-xs" style={{ color: DANGER }}>{docError}</p>}

      <section className="mt-8 border-t pt-6" style={{ borderColor: BORDER }} aria-label="Sign">
        <h2 className="text-lg font-black" style={{ color: TEXT }}>Sign</h2>
        <div className="mt-4 space-y-1.5">
          <label htmlFor="signer-full-name" className="text-xs font-bold" style={{ color: TEXT }}>Your full name</label>
          <Input id="signer-full-name" value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" />
        </div>
        <div className="mt-4 space-y-1.5">
          <p className="text-xs font-bold" style={{ color: TEXT }}>Your signature</p>
          <SignatureCanvas minWidth={280} minHeight={120} onChange={onSignatureChange} />
        </div>
        <label className="mt-4 flex items-start gap-2.5 text-sm" style={{ color: TEXT }}>
          <input type="checkbox" className="mt-1 h-4 w-4" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
          <span>
            I've read the agreement, I understand it, and I agree to it
            {whose === "your" ? "" : ` on ${view.participant_first_name}'s behalf`}.
          </span>
        </label>
        {signError && <p role="alert" className="mt-3 text-xs font-bold" style={{ color: DANGER }}>{signError}</p>}
        <Button variant="navy" className="mt-5 h-11 w-full gap-2 rounded-lg sm:w-auto sm:px-8" onClick={onSign} disabled={!canSign || signing}>
          {signing ? <Loader2 size={14} className="animate-spin" /> : null} Sign agreement
        </Button>
        <p className="mt-3 text-[11px]" style={{ color: MUTED }}>
          Your name, signature, the time, and your device's IP address are recorded with the signed copy.
        </p>
      </section>
    </>
  );
}

function CenterMessage({ title, body, icon, action }: { title: string; body: string; icon?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: SURFACE }}>
      <div className="w-full max-w-sm space-y-3 text-center">
        <div className="flex justify-center"><CareCliQLogo size={32} /></div>
        {icon}
        <h1 className="text-lg font-black" style={{ color: TEXT }}>{title}</h1>
        {body && <p className="text-sm" style={{ color: MUTED }}>{body}</p>}
        {action}
      </div>
    </div>
  );
}
