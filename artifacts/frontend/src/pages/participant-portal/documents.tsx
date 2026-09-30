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
const AMBER = "#9A5B0A";
const AMBER_SOFT = "#FBF2E6";

// One colour family per kind of document. Backgrounds are translucent tints
// of the accent, so the rows read on both the light and dark surface; the
// document name stays in the regular text colour for contrast.
const TONES = {
  agreement: { accent: "#0F8A83", tint: "rgba(15, 138, 131, 0.10)", tile: "rgba(15, 138, 131, 0.18)" },
  details: { accent: "#6366F1", tint: "rgba(99, 102, 241, 0.10)", tile: "rgba(99, 102, 241, 0.18)" },
  plan: { accent: "#E0513C", tint: "rgba(224, 81, 60, 0.10)", tile: "rgba(224, 81, 60, 0.18)" },
} as const;

// The file lives on Supabase Storage (another origin), where the HTML
// `download` attribute is ignored; Storage's own `download` query flag makes
// the response an attachment instead.
function downloadUrl(url: string) {
  return `${url}${url.includes("?") ? "&" : "?"}download=`;
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

type DocumentRow = {
  key: string;
  name: string;
  type: string;
  date: string;
  icon: typeof FileText;
  tone: keyof typeof TONES;
  file?: { url: string };
  view?: { href: string };
  status?: string;
};

function ActionButton({ label, children, ...props }: { label: string; children: React.ReactNode } & ({ href: string; external?: boolean })) {
  const className = "flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/10";
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
  const tone = TONES[row.tone];
  const Icon = row.icon;
  return (
    <li
      className="grid grid-cols-[auto_1fr_auto] items-center gap-4 rounded-2xl px-4 py-4 sm:grid-cols-[auto_1fr_220px_150px_auto] sm:px-5"
      style={{ background: tone.tint }}
    >
      <span className="flex h-12 w-12 items-center justify-center rounded-xl" style={{ background: tone.tile }}>
        <Icon size={20} style={{ color: tone.accent }} />
      </span>

      <div className="min-w-0">
        <p className="truncate text-[14px] font-black" style={{ color: TEXT }}>{row.name}</p>
        {/* Phones: type and date fold under the name. */}
        <p className="truncate text-[12px] sm:hidden" style={{ color: MUTED }}>
          {row.type} · {row.date}
        </p>
      </div>

      <p className="hidden truncate text-[12px] font-semibold sm:block" style={{ color: tone.accent }}>
        {row.type}{row.status ? ` · ${row.status}` : ""}
      </p>
      <p className="hidden text-[12px] font-bold sm:block" style={{ color: TEXT }}>{row.date}</p>

      <div className="flex items-center gap-1 rounded-xl p-1" style={{ background: tone.tile, color: tone.accent }}>
        {row.file && (
          <>
            <ActionButton href={row.file.url} external label={`Open ${row.name}`}>
              <ExternalLink size={16} />
            </ActionButton>
            <a
              href={downloadUrl(row.file.url)}
              aria-label={`Download ${row.name}`}
              title={`Download ${row.name}`}
              className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors hover:bg-black/10"
            >
              <Download size={16} />
            </a>
          </>
        )}
        {row.view && (
          <ActionButton href={row.view.href} label={`View ${row.name}`}>
            <ArrowRight size={16} />
          </ActionButton>
        )}
        {!row.file && !row.view && (
          <span className="px-2 text-[11px] font-bold" style={{ color: MUTED }}>On file</span>
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
      tone: "agreement",
      file: signedDocument.url ? { url: signedDocument.url } : undefined,
    });
  }
  for (const agreement of agreements) {
    rows.push({
      key: agreement.id,
      name: `Agreement ${formatDate(agreement.start_date)} – ${agreement.end_date ? formatDate(agreement.end_date) : "ongoing"}`,
      type: agreement.plan_management_type ? `Agreement · ${agreement.plan_management_type}` : "Agreement details",
      date: formatDate(agreement.start_date),
      icon: FileText,
      tone: "details",
      status: agreement.status,
    });
  }
  if (plan?.available) {
    rows.push({
      key: "ndis-plan",
      name: "NDIS Plan",
      type: "Dates, funding, budgets & goals",
      date: `${formatDate(plan.plan_start)} – ${formatDate(plan.plan_end)}`,
      icon: NotebookTabs,
      tone: "plan",
      view: { href: "/participant-portal/plan" },
    });
  }
  // The NDIS plan row comes from the overview; if that fails, still list the rest.
  const loading = data === null || (overview === null && !overviewError);

  return (
    <ParticipantPortalShell>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-black" style={{ color: TEXT }}>Documents</h1>
          <p className="mt-1 text-[12px] font-medium" style={{ color: MUTED }}>Everything on file for your supports.</p>
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
          <p className="rounded-2xl border border-dashed p-8 text-center text-[13px] font-medium" style={{ borderColor: "var(--cc-border)", color: MUTED }}>
            No documents on file yet.
          </p>
        ) : (
          <ul className="space-y-3">
            {rows.map((row) => <DocumentCard key={row.key} row={row} />)}
          </ul>
        )}
      </div>
    </ParticipantPortalShell>
  );
}
