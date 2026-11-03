import { Link, Redirect, useSearch } from "wouter";
import { Activity, ClipboardCheck, FileSearch, FolderLock, ShieldCheck } from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { PageHeader, PillTabs, ghostClass } from "@/components/layout/PageKit";
import QualityOverview from "./compliance";
import AuditEvidence from "./audit-readiness";
import { AuditPackPanel } from "@/pages/audit-pack";

const tabs = [
  { key: "quality", label: "Quality & risk", icon: Activity, detail: "Documentation quality, team trends and staff follow-up." },
  { key: "overview", label: "Evidence overview", icon: ShieldCheck, detail: "Evidence coverage, with missing and overdue records first." },
  { key: "checklist", label: "Evidence checklist", icon: ClipboardCheck, detail: "Find a requirement, link supporting records and review evidence." },
  { key: "packs", label: "Audit packs", icon: FileSearch, detail: "Export the NDIS audit pack, outstanding actions and documents for an auditor." },
] as const;

export function LegacyAuditRedirect() {
  const params = new URLSearchParams(useSearch());
  if (!params.has("view")) params.set("view", "overview");
  return <Redirect to={`/md/compliance?${params.toString()}`} />;
}

export default function ComplianceWorkspace() {
  const params = new URLSearchParams(useSearch());
  // Shift notes used to have a second list here; the one list is Shift notes.
  if (params.get("view") === "shifts") return <Redirect to="/sessions" replace />;
  const selected = tabs.find(tab => tab.key === params.get("view")) ?? tabs[0];
  return <HubLayout>
    <div className="space-y-8 pb-12">
      <PageHeader
        eyebrow="Oversight & Risk"
        title="Audit & Compliance"
        description="Quality signals, evidence reviews and audit preparation in one workspace."
        actions={<Link href="/md/vault" className={ghostClass}><FolderLock size={16} />Document vault</Link>}
      />
      <PillTabs
        label="Audit and compliance views"
        value={selected.key}
        options={tabs.map(({ key, label, icon, detail }) => ({ key, label, icon, title: detail, href: `/md/compliance?view=${key}` }))}
      />
      <section aria-label={selected.label}>
        {selected.key === "quality" ? <ProtectedRoute allowedRoles={["managing_director", "super_admin"]}><QualityOverview embedded /></ProtectedRoute> : <ProtectedRoute allowedRoles={["managing_director", "super_admin"]} requiredCapability="governance_vault" capabilityLabel="Audit evidence"><AuditEvidence embedded /></ProtectedRoute>}
        {/* The coordinator's audit pack export, here rather than as a second "Audit pack" page in the MD nav. */}
        {selected.key === "packs" && <div className="mt-10 space-y-4"><h2 className="text-base font-semibold text-cc-text">NDIS audit pack export</h2><AuditPackPanel embedded /></div>}
      </section>
    </div>
  </HubLayout>;
}
