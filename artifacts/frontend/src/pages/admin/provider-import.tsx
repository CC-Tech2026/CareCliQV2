import { useEffect, useState } from "react";
import { useLocation, useParams } from "wouter";
import { ArrowLeft } from "lucide-react";
import { AdminShell } from "@/components/admin/AdminShell";
import { DataImportFlow } from "@/pages/md/data-import";
import { getAdminOrganization } from "@/services/adminService";

/** CareCliQ bringing a provider's records across from their old system, so
 *  they don't have to. Same steps the provider's own MD would use; staff
 *  invitations are held for that MD to send. */
export default function AdminProviderImportPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const [, navigate] = useLocation();
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getAdminOrganization(organizationId)
      .then((o) => setName(o.display_name))
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load this provider."));
  }, [organizationId]);

  const back = () => navigate(`/admin/organizations/${organizationId}`);

  return (
    <AdminShell>
      <div className="space-y-5 pb-12">
        <button type="button" onClick={back} className="inline-flex items-center gap-1.5 text-sm font-semibold text-cc-muted">
          <ArrowLeft size={14} /> {name ?? "Back"}
        </button>
        <header>
          <p className="text-xs font-semibold text-[var(--cc-brand-purple)]">Move to CareCliQ</p>
          <h1 className="text-2xl font-bold text-cc-text" style={{ fontFamily: "var(--app-font-display)" }}>
            Bring {name ? `${name}'s` : "their"} records across
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-cc-muted">
            Upload the CSV export they sent us. Nothing is saved until you've checked every row. Participants land on their onboarding board;
            staff invitations wait for their managing director to send.
          </p>
        </header>
        {error && <p role="alert" className="text-sm" style={{ color: "var(--cc-status-danger)" }}>{error}</p>}
        {name && (
          <DataImportFlow target={{ kind: "admin", organizationId, organizationName: name, onFinished: back }} />
        )}
      </div>
    </AdminShell>
  );
}
