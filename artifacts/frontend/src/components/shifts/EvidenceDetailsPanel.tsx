import { useState } from "react";
import { format } from "date-fns";
import { ChevronDown, Fingerprint, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import type { EvidenceMetadata } from "@/services/complianceService";
import { MUTED, TEXT } from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type Props = {
  metadata: EvidenceMetadata;
  defaultOpen?: boolean;
  showRetention?: boolean;
};

function formatTs(value?: string | null) {
  if (!value) return "N/A";
  try {
    const d = new Date(value);
    return `${d.toLocaleString()} (UTC: ${format(d, "yyyy-MM-dd HH:mm")}Z)`;
  } catch {
    return value;
  }
}

export function EvidenceDetailsPanel({ metadata, defaultOpen = false, showRetention = true }: Props) {
  const { translate, translateParams } = useAccessibility();
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="rounded-xl border border-cc-border bg-cc-bg">
      <button
        type="button"
        className="flex w-full items-center justify-between px-3 py-2.5 text-left"
        onClick={() => setOpen(!open)}
      >
        <span className="flex items-center gap-1.5 text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>
          <Shield size={12} /> {translate("shift.evidence.details")}
        </span>
        <ChevronDown size={16} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} />
      </button>
      {open && (
        <dl className="space-y-2 border-t border-cc-border px-3 py-3 text-xs">
          <Detail label={translate("shift.evidence.uploader")} value={metadata.uploader_name ?? metadata.uploaded_by} />
          <Detail label={translate("shift.evidence.uploaded")} value={formatTs(metadata.uploaded_at)} />
          <Detail label={translate("shift.evidence.device")} value={metadata.device_type ?? translate("shift.evidence.unknown")} />
          <Detail label={translate("shift.evidence.sha256")} value={metadata.file_hash ?? translate("shift.evidence.pendingSync")} mono />
          {showRetention && metadata.retention_until && (
            <p className="rounded-lg border border-cc-border bg-cc-surface px-2.5 py-2 text-xs font-semibold leading-snug" style={{ color: TEXT }}>
              {translateParams("shift.evidence.retention", {
                date: format(new Date(metadata.retention_until), "d MMM yyyy"),
              })}
            </p>
          )}
          {metadata.is_quarantined && (
            <p className="flex items-center gap-1.5 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 font-bold text-amber-800">
              <Fingerprint size={14} /> {translate("shift.evidence.quarantined")}
            </p>
          )}
        </dl>
      )}
    </div>
  );
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="font-black uppercase tracking-wider text-[10px]" style={{ color: MUTED }}>{label}</dt>
      <dd className={cn("mt-0.5 font-semibold break-all", mono && "font-mono text-[11px]")} style={{ color: TEXT }}>
        {value}
      </dd>
    </div>
  );
}
