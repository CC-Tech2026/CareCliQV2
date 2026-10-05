import { useState } from "react";
import { Clock, FileText, ExternalLink, Mail, MailCheck, Pencil, PenLine, Plus, Send, Trash2, XCircle } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { jsonFetch } from "@/services/http";
import {
  cancelAgreementEsign,
  deleteAgreementDraft,
  agreementsPath,
  openAgreementDocument,
  type AgreementEsignStatus,
  type AgreementOwner,
} from "@/services/serviceAgreementService";
import { EmailAgreementDialog } from "./EmailAgreementDialog";
import { ServiceAgreementBuilder, type BuilderDefaults } from "./ServiceAgreementBuilder";
import { SignAgreementDialog } from "./SignAgreementDialog";

type AgreementSupport = {
  id: string;
  support_item_code: string;
  item_name: string | null;
  unit: string | null;
  standard_rate: number | null;
  negotiated_rate: number | null;
  frequency: string | null;
  total_hours_allocated: number | null;
  total_funding: number | null;
  location: string | null;
  quantity?: number | null;
  rate?: number | null;
  /** False when the NDIS price guide no longer lists this code. */
  in_current_catalogue?: boolean | null;
};

type SignedDocument = {
  name: string | null;
  url: string | null;
  provider_signed_name: string | null;
  provider_signed_at: string | null;
  family_signed_name: string | null;
  family_signed_at: string | null;
};

type ServiceAgreement = {
  id: string;
  agreement_number?: string | null;
  sent_at?: string | null;
  status: string;
  plan_management_type: string;
  plan_manager_name: string | null;
  plan_manager_email: string | null;
  start_date: string;
  end_date: string | null;
  includes_price_adjustment_clause: boolean;
  gst_treatment_basis: string | null;
  cancellation_notice_hours: number | null;
  cancellation_fee_percentage: number | null;
  signed_by: string | null;
  signed_date: string | null;
  service_agreement_supports: AgreementSupport[];
  signed_document: SignedDocument | null;
  esign?: AgreementEsignStatus | null;
};

const PLAN_MANAGEMENT_LABELS: Record<string, string> = {
  "NDIA-managed": "NDIA-managed",
  "plan-managed": "Plan-managed",
  "self-managed": "Self-managed",
};
const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  pending_signature: "Awaiting signature",
  active: "Signed",
  expired: "Expired",
  ended: "Ended",
};
const UNIT_WORDS: Record<string, [string, string]> = {
  H: ["hour", "hours"], HOUR: ["hour", "hours"], D: ["day", "days"], WK: ["week", "weeks"],
  MON: ["month", "months"], YR: ["year", "years"],
};
const LOCATION_LABELS: Record<string, string> = {
  home: "At home",
  school: "School",
  preschool: "Preschool",
  clinic: "Clinic",
  other: "In the community",
};

const money = (value: number | null | undefined) =>
  value == null
    ? "Not recorded"
    : new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: "AUD",
      }).format(value);

function formatDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** "5 hours a week" from the agreement's total over its own period, so the
 * line reads the way the signed schedule of supports does. */
function hoursPerPeriod(
  support: AgreementSupport,
  agreement: ServiceAgreement,
) {
  if (!support.total_hours_allocated || !agreement.end_date) return null;
  const days =
    (new Date(`${agreement.end_date}T00:00:00`).getTime() -
      new Date(`${agreement.start_date}T00:00:00`).getTime()) /
    86_400_000;
  const weeks = days / 7;
  if (weeks <= 0) return null;
  if (support.frequency === "monthly") {
    const perMonth = Math.round(support.total_hours_allocated / (weeks / 4.33));
    return `${perMonth} hours a month`;
  }
  if (support.frequency === "fortnightly") {
    return `${Math.round(support.total_hours_allocated / (weeks / 2))} hours a fortnight`;
  }
  if (support.frequency === "weekly") {
    return `${Math.round(support.total_hours_allocated / weeks)} hours a week`;
  }
  return "As scheduled";
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-cc-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-cc-text">{value}</dd>
    </div>
  );
}

/** The participant's service agreements: build one from the NDIS price
 * catalogue, send it for signature, sign it on screen, and see the signed
 * schedule of supports, terms and PDF. During onboarding (intakeId) the
 * same agreement is built against the intake, and moves onto the
 * participant when they're made active. */
export function ParticipantServiceAgreementSection({
  participantId,
  intakeId,
  participantName = "the participant",
  participantEmail,
  defaults = {},
  onChanged,
}: {
  participantId?: string;
  /** Onboarding: the agreement belongs to the intake until activation. */
  intakeId?: string;
  participantName?: string;
  /** Called after anything changes (built, sent, signed, deleted). */
  onChanged?: () => void;
  /** Pre-fills the address when emailing an agreement for signature. */
  participantEmail?: string | null;
  /** Prefills a new agreement (plan dates, plan management). */
  defaults?: BuilderDefaults;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const orgId = user?.organizationId ?? "__no_org__";
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [builder, setBuilder] = useState<{ open: boolean; agreementId: string | null; defaults: BuilderDefaults }>({
    open: false, agreementId: null, defaults: {},
  });
  const [signing, setSigning] = useState(false);
  const [emailing, setEmailing] = useState(false);
  const [busy, setBusy] = useState(false);
  const owner: AgreementOwner = intakeId
    ? { kind: "intake", id: intakeId }
    : { kind: "participant", id: participantId ?? "" };
  const { data, isLoading, isError, refetch } = useOrgQuery<ServiceAgreement[]>(
    [owner.kind, owner.id, "service-agreements"],
    { queryFn: () => jsonFetch(agreementsPath(owner)) },
  );

  const changed = () => {
    void refetch();
    onChanged?.();
    // The vault and audit readiness both read agreement status.
    void queryClient.invalidateQueries({ queryKey: [orgId, "audit-readiness"] });
    void queryClient.invalidateQueries({ queryKey: [orgId, "md-vault"] });
  };
  const run = async (action: () => Promise<unknown>, success: string) => {
    setBusy(true);
    try {
      await action();
      toast({ title: success });
      changed();
    } catch (err) {
      toast({ title: "Something went wrong", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };
  const openDoc = (id: string) =>
    openAgreementDocument(id).catch((err) =>
      toast({ title: "Couldn't open the agreement", description: err instanceof Error ? err.message : undefined, variant: "destructive" }),
    );

  if (isLoading) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (isError) {
    return (
      <div role="alert" className="text-sm text-cc-text">
        The service agreement could not be loaded.{" "}
        <Button variant="link" className="px-1" onClick={() => void refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  const agreements = data ?? [];
  const agreement =
    agreements.find((a) => a.id === selectedId) ??
    agreements.find((a) => a.status === "active") ??
    agreements[0];

  const builderSheet = (
    <ServiceAgreementBuilder
      open={builder.open}
      onOpenChange={(open) => setBuilder((b) => ({ ...b, open }))}
      owner={owner}
      participantName={participantName}
      agreementId={builder.agreementId}
      defaults={builder.defaults}
      onSaved={changed}
    />
  );
  const newAgreement = () => setBuilder({ open: true, agreementId: null, defaults });

  if (!agreement) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-cc-muted">
          {intakeId
            ? `Build ${participantName}'s service agreement with the supports they'll receive. It has to be signed before they can be made active.`
            : "No service agreement recorded yet. Build one here, or agreements signed through participant onboarding appear automatically."}
        </p>
        <Button className="gap-1.5" onClick={newAgreement}>
          <Plus size={15} /> New agreement
        </Button>
        {builderSheet}
      </div>
    );
  }

  const supports = agreement.service_agreement_supports ?? [];
  const totalFunding = supports.reduce(
    (sum, s) => sum + (Number(s.total_funding) || 0),
    0,
  );
  const doc = agreement.signed_document;
  const active = agreement.status === "active";
  const isDraft = agreement.status === "draft";
  const signable = isDraft || agreement.status === "pending_signature";
  const esign = signable ? agreement.esign ?? null : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-cc-text">
            {formatDate(agreement.start_date)} to{" "}
            {formatDate(agreement.end_date) ?? "ongoing"}
            <span
              className="rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize"
              style={{
                background: active
                  ? "var(--cc-status-success-bg)"
                  : "var(--cc-soft)",
                color: active ? "var(--cc-status-success)" : "var(--cc-muted)",
              }}
            >
              {STATUS_LABELS[agreement.status] ?? agreement.status.replace(/_/g, " ")}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-cc-muted">
            {agreement.agreement_number ? `${agreement.agreement_number} · ` : ""}
            {esign
              ? `Emailed to ${esign.signer_name ?? "the signer"} ${formatDate(agreement.sent_at) ? `on ${formatDate(agreement.sent_at)}` : ""}`.trim()
              : signable
              ? agreement.sent_at
                ? `Ready for signature since ${formatDate(agreement.sent_at)}`
                : "Draft — not yet sent"
              : <>
                  Signed{" "}
                  {formatDate(agreement.signed_date) ??
                    formatDate(doc?.family_signed_at) ??
                    "date not recorded"}
                  {agreement.signed_by ? ` by ${agreement.signed_by}` : ""}
                </>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {doc?.url ? (
            <Button asChild variant="outline" className="min-h-10 gap-1.5">
              <a href={doc.url} target="_blank" rel="noreferrer">
                <FileText size={15} /> View signed agreement
                <ExternalLink size={13} className="text-cc-muted" />
              </a>
            </Button>
          ) : (
            <Button variant="outline" className="min-h-10 gap-1.5" onClick={() => void openDoc(agreement.id)}>
              <FileText size={15} /> {signable ? "Preview" : "View agreement"}
            </Button>
          )}
          {isDraft && (
            <Button
              variant="outline"
              className="min-h-10 gap-1.5"
              onClick={() =>
                setBuilder({
                  open: true,
                  agreementId: agreement.id,
                  defaults: {
                    ...agreement,
                    supports: supports.map((s) => ({
                      support_item_code: s.support_item_code,
                      quantity: s.quantity ?? s.total_hours_allocated,
                      rate: s.rate ?? null,
                      location: s.location,
                      frequency: s.frequency,
                    })),
                  },
                })
              }
            >
              <Pencil size={15} /> Edit
            </Button>
          )}
          {signable && !esign && (
            <Button className="min-h-10 gap-1.5" onClick={() => setEmailing(true)}>
              <Mail size={15} /> Email for signature
            </Button>
          )}
          {signable && (
            <Button variant={esign ? "default" : "outline"} className="min-h-10 gap-1.5" onClick={() => setSigning(true)}>
              <PenLine size={15} /> Sign in person
            </Button>
          )}
          {isDraft && (
            <Button
              variant="ghost"
              className="min-h-10 gap-1.5"
              disabled={busy}
              aria-label="Delete draft"
              onClick={() => {
                if (window.confirm("Delete this draft agreement?")) {
                  void run(() => deleteAgreementDraft(agreement.id), "Draft deleted");
                  setSelectedId(null);
                }
              }}
            >
              <Trash2 size={15} />
            </Button>
          )}
          <Button variant="ghost" className="min-h-10 gap-1.5" onClick={newAgreement}>
            <Plus size={15} /> New
          </Button>
        </div>
      </div>

      {esign && (
        <div
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
          style={{
            borderColor: esign.expired ? "var(--cc-status-warning)" : "var(--cc-border)",
            background: esign.expired ? "var(--cc-status-warning-bg)" : "var(--cc-soft)",
          }}
          role="status"
        >
          <div className="flex min-w-0 items-start gap-2.5">
            {esign.expired ? (
              <Clock size={16} className="mt-0.5 shrink-0" style={{ color: "var(--cc-status-warning)" }} />
            ) : esign.email_verified ? (
              <MailCheck size={16} className="mt-0.5 shrink-0" style={{ color: "var(--cc-status-success)" }} />
            ) : (
              <Mail size={16} className="mt-0.5 shrink-0" style={{ color: "var(--cc-plum)" }} />
            )}
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-cc-text">
                {esign.expired
                  ? "Signing link expired"
                  : esign.email_verified
                    ? `${esign.signer_name ?? "The signer"} has opened the agreement`
                    : `Waiting for ${esign.signer_name ?? "the signer"} to sign`}
              </p>
              <p className="text-xs text-cc-muted">
                {esign.signer_email}
                {esign.relationship && esign.relationship !== "participant" ? ` · ${esign.relationship}` : ""}
                {esign.expires_at && !esign.expired ? ` · link works until ${formatDate(esign.expires_at)}` : ""}
                {esign.expired ? " · send a new link to carry on" : ""}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="gap-1.5" disabled={busy} onClick={() => setEmailing(true)}>
              <Send size={14} /> {esign.expired ? "Send new link" : "Resend"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="gap-1.5"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Cancel the signing link? It will stop working straight away.")) {
                  void run(() => cancelAgreementEsign(agreement.id), "Signing link cancelled");
                }
              }}
            >
              <XCircle size={14} /> Cancel link
            </Button>
          </div>
        </div>
      )}

      {agreements.length > 1 && (
        <div className="flex flex-wrap gap-1.5" aria-label="Agreements">
          {agreements.map((a) => (
            <button
              key={a.id}
              type="button"
              onClick={() => setSelectedId(a.id)}
              aria-pressed={a.id === agreement.id}
              className="rounded-full border px-2.5 py-1 text-xs"
              style={{
                borderColor: a.id === agreement.id ? "var(--cc-plum)" : "var(--cc-border)",
                color: a.id === agreement.id ? "var(--cc-plum)" : "var(--cc-muted)",
              }}
            >
              {a.agreement_number ?? formatDate(a.start_date)} · {STATUS_LABELS[a.status] ?? a.status}
            </button>
          ))}
        </div>
      )}

      <dl className="grid gap-3 rounded-lg border border-cc-border p-3 sm:grid-cols-3">
        <Fact
          label="Plan management"
          value={
            PLAN_MANAGEMENT_LABELS[agreement.plan_management_type] ??
            agreement.plan_management_type
          }
        />
        {agreement.plan_management_type === "plan-managed" && (
          <Fact
            label="Plan manager"
            value={
              agreement.plan_manager_name ? (
                <>
                  {agreement.plan_manager_name}
                  {agreement.plan_manager_email && (
                    <span className="block text-xs font-normal text-cc-muted">
                      {agreement.plan_manager_email}
                    </span>
                  )}
                </>
              ) : (
                "Not recorded"
              )
            }
          />
        )}
        {doc && (
          <Fact
            label="Signatories"
            value={
              <>
                {doc.provider_signed_name ?? "Provider"} (provider)
                <span className="block">{doc.family_signed_name}</span>
              </>
            }
          />
        )}
      </dl>

      <section aria-label="Schedule of supports">
        <h4 className="mb-2 text-sm font-semibold text-cc-text">
          Schedule of supports
        </h4>
        {supports.length === 0 ? (
          <p className="text-sm text-cc-muted">No support lines recorded.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-cc-border">
            {supports.map((s) => {
              const rate = s.rate ?? s.negotiated_rate ?? s.standard_rate;
              const unit = UNIT_WORDS[(s.unit ?? "").toUpperCase()];
              return (
                <div
                  key={s.id}
                  className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 border-b border-cc-border px-3 py-2.5 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-cc-text">
                      {s.item_name ?? s.support_item_code}
                    </p>
                    <p className="text-xs text-cc-muted">
                      {[
                        hoursPerPeriod(s, agreement),
                        s.location ? LOCATION_LABELS[s.location] : null,
                        rate != null
                          ? `${money(rate)}${unit ? ` per ${unit[0]}` : " each"}${s.negotiated_rate != null ? " (negotiated)" : ""}`
                          : null,
                        s.support_item_code,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {s.in_current_catalogue === false && (
                      <p className="mt-0.5 text-xs" style={{ color: "var(--cc-status-danger)" }}>
                        {s.support_item_code} is no longer in the NDIS price guide. Start a new agreement with the current code.
                      </p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-cc-text">
                      {money(s.total_funding)}
                    </p>
                    {(s.quantity ?? s.total_hours_allocated) != null && (
                      <p className="text-xs tabular-nums text-cc-muted">
                        {Number(s.quantity ?? s.total_hours_allocated).toLocaleString(
                          "en-AU",
                        )}{" "}
                        {unit ? unit[1] : s.quantity != null ? "units" : "hours"}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-between bg-cc-soft px-3 py-2 text-sm">
              <span className="font-medium text-cc-text">
                Total agreed funding
              </span>
              <span className="font-semibold tabular-nums text-cc-text">
                {money(totalFunding)}
              </span>
            </div>
          </div>
        )}
      </section>

      <dl className="grid gap-3 sm:grid-cols-2">
        <Fact
          label="Cancellations"
          value={
            agreement.cancellation_notice_hours != null
              ? `${agreement.cancellation_notice_hours} hours' notice. Later cancellations are charged at ${agreement.cancellation_fee_percentage ?? 100}% of the agreed rate.`
              : "Not recorded"
          }
        />
        <Fact
          label="Price changes"
          value={
            agreement.includes_price_adjustment_clause
              ? "Prices follow NDIS Pricing Arrangements updates."
              : "Prices fixed for the agreement period."
          }
        />
        {agreement.gst_treatment_basis && (
          <div className="sm:col-span-2">
            <Fact label="GST" value={agreement.gst_treatment_basis} />
          </div>
        )}
      </dl>

      {builderSheet}
      {signable && (
        <SignAgreementDialog
          open={signing}
          onOpenChange={setSigning}
          agreementId={agreement.id}
          agreementNumber={agreement.agreement_number}
          participantName={participantName}
          providerName={user?.full_name}
          onSigned={changed}
        />
      )}
      {signable && (
        <EmailAgreementDialog
          open={emailing}
          onOpenChange={setEmailing}
          agreementId={agreement.id}
          agreementNumber={agreement.agreement_number}
          participantName={participantName}
          participantEmail={participantEmail}
          providerName={user?.full_name}
          resend={esign ? { signer_name: esign.signer_name, relationship: esign.relationship } : null}
          onSent={changed}
        />
      )}
    </div>
  );
}
