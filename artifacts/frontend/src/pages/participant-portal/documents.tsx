import { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, ArrowRight, Download, ExternalLink, FileSignature, FileText, NotebookTabs } from "lucide-react";
import { ParticipantPortalShell } from "@/components/participant-portal/ParticipantPortalShell";
import { useViewingParticipant } from "@/components/participant-portal/ParticipantPortalContext";
import { usePortalOverview } from "@/components/participant-portal/usePortalOverview";
import {
  listMyServiceAgreements,
  type ParticipantServiceAgreementsResponse,
} from "@/services/participantPortalService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";
const PLUM = "var(--cc-plum)";
const AMBER = "#9A5B0A";
const AMBER_SOFT = "#FBF2E6";

// The file lives on Supabase Storage (another origin), where the HTML
// `download` attribute is ignored; Storage's own `download` query flag makes
// the response an attachment instead.
function downloadUrl(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}download=`;
}

function formatDate(value?: string | null) {
  if (!value) return "N/A";
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

type DocumentRow = {
  key: string;
  name: string;
  type: string;
  date: string;
  icon: typeof FileText;
  file?: { url: string };
  view?: { href: string };
  status?: string;
};

const ACTION_CLASS = "flex h-10 w-10 items-center justify-center rounded-lg transition-colors hover:bg-[var(--cc-plum-soft)]";

function ActionButton({ label, children, ...props }: { label: string; children: React.ReactNode } & ({ href: string; external?: boolean })) {
  const className = ACTION_CLASS;
  if (props.external) {
    return (
      <a href={props.href} target="_blank" rel="noreferrer" aria-label={label} title={label} className={className}>
        {children}
      </a>
    );
  }
  return (
    <Link href={props.href} aria-label={label} title={label} className={className}>
      {children}
    </Link>
  );
}

function DocumentCard({ row }: { row: DocumentRow }) {
  const Icon = row.icon;
  return (
    <li className="grid grid-cols-[auto_1fr_auto] items-center gap-4 px-4 py-4 sm:grid-cols-[auto_1fr_220px_auto] sm:px-5">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl" style={{ background: "var(--cc-soft)" }}>
        <Icon size={20} style={{ color: MUTED }} />
      </span>

      <div className="min-w-0">
        <p className="text-[15px] font-black" style={{ color: TEXT }}>{row.name}</p>
        <p className="text-[13px]" style={{ color: MUTED }}>
          {row.type}{row.status ? ` · ${row.status.charAt(0).toUpperCase()}${row.status.slice(1)}` : ""}
          {/* Phones: the date folds under the name. */}
          <span className="sm:hidden"> · {row.date}</span>
        </p>
      </div>

      <p className="hidden text-[13px] font-semibold sm:block" style={{ color: TEXT }}>{row.date}</p>

      <div className="flex items-center gap-1" style={{ color: PLUM }}>
        {row.file && (
          <>
            <ActionButton href={row.file.url} external label={`Open ${row.name}`}>
              <ExternalLink size={18} />
            </ActionButton>
            <a href={downloadUrl(row.file.url)} aria-label={`Download ${row.name}`} title={`Download ${row.name}`} className={ACTION_CLASS}>
              <Download size={18} />
            </a>
          </>
        )}
        {row.view && (
          <ActionButton href={row.view.href} label={`View ${row.name}`}>
            <ArrowRight size={18} />
          </ActionButton>
        )}
        {!row.file && !row.view && (
          <span className="rounded-lg px-2.5 py-1 text-[12px] font-bold" style={{ background: "var(--cc-soft)", color: MUTED }}>On file</span>
        )}
      </div>
    </li>
  );
}

export default function ParticipantDocumentsPage() {
  const { participantId } = useViewingParticipant();
  const { data: overview, error: overviewError } = usePortalOverview(participantId);
  const [data, setData] = useState<ParticipantServiceAgreementsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!participantId) return;
    let cancelled = false;
    setData(null);
    setLoadError(null);
    listMyServiceAgreements(participantId)
      .then((result) => { if (!cancelled) setData(result); })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Could not load your service agreement.");
        setData({ agreements: [], signed_document: null });
      });
    return () => { cancelled = true; };
  }, [participantId]);

  const agreements = data?.agreements ?? [];
  const signedDocument = data?.signed_document ?? null;
  const plan = overview?.pinned.ndis_plan;

  const rows: DocumentRow[] = [];
  if (signedDocument) {
    rows.push({
      key: "signed-agreement",
      name: signedDocument.name || "Service agreement",
      type: "Service agreement",
      date: `Signed ${formatDate(signedDocument.updated_at)}`,
      icon: FileSignature,
      file: signedDocument.url ? { url: signedDocument.url } : undefined,
    });
  }
  for (const agreement of agreements) {
    rows.push({
      key: agreement.id,
      name: `Service agreement, ${formatDate(agreement.start_date)} to ${agreement.end_date ? formatDate(agreement.end_date) : "ongoing"}`,
      type: agreement.plan_management_type
        ? `${agreement.plan_management_type.charAt(0).toUpperCase()}${agreement.plan_management_type.slice(1)}`
        : "Agreement details",
      date: `Starts ${formatDate(agreement.start_date)}`,
      icon: FileText,
      status: agreement.status,
    });
  }
  if (plan?.available) {
    rows.push({
      key: "ndis-plan",
      name: "NDIS Plan",
      type: "Dates, funding, budgets & goals",
      date: `${formatDate(plan.plan_start)} to ${formatDate(plan.plan_end)}`,
      icon: NotebookTabs,
      view: { href: "/participant-portal/plan" },
    });
  }
  // The NDIS plan row comes from the overview; if that fails, still list the rest.
  const loading = data === null || (overview === null && !overviewError);

  return (
    <ParticipantPortalShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>Documents</h1>
          <p className="mt-1 text-[14px]" style={{ color: MUTED }}>Everything on file for your supports.</p>
        </div>

        {loadError && (
          <div className="flex items-center gap-2 rounded-2xl border p-4" style={{ borderColor: AMBER, background: AMBER_SOFT }}>
            <AlertTriangle size={15} style={{ color: AMBER }} className="shrink-0" />
            <p className="text-[12px] font-bold" style={{ color: AMBER }}>Couldn't load your service agreement: {loadError}</p>
          </div>
        )}

        {loading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl" style={{ background: "var(--cc-soft)" }} />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-8 text-center text-[14px]" style={{ borderColor: BORDER, color: MUTED }}>
            No documents on file yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--cc-border)] rounded-2xl border" style={{ borderColor: BORDER, background: SURFACE }}>
            {rows.map((row) => <DocumentCard key={row.key} row={row} />)}
          </ul>
        )}
      </div>
    </ParticipantPortalShell>
  );
}
