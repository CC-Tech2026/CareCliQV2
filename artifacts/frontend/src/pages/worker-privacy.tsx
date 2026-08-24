import { useEffect, useState } from "react";
import { CreditCard, ChevronDown, Download, Loader2, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { BORDER, CORAL, PLUM } from "@/lib/shift-utils";
import {
  getPrivacyOverview,
  listPrivacyPolicyVersions,
  requestDataExport,
  setAnalyticsOptOut,
  type PrivacyOverview,
} from "@/services/complianceService";

type WorkerPrivacyProps = {
  showHeader?: boolean;
  /** Settings embeds this and can jump to its own Billing tab; the standalone
   * /worker/privacy route (workers only, never MD) leaves this unset. */
  onManageSubscription?: () => void;
};

export default function WorkerPrivacy({ showHeader = true, onManageSubscription }: WorkerPrivacyProps = {}) {
  const { user } = useAuth();
  const isMD = user?.role === "managing_director";
  const { toast } = useToast();
  const { translate, translateParams } = useAccessibility();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<PrivacyOverview | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [versions, setVersions] = useState<Array<{ version: string; published_at: string; is_current?: boolean }>>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [analyticsBusy, setAnalyticsBusy] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.all([getPrivacyOverview(), listPrivacyPolicyVersions()])
      .then(([data, vers]) => {
        if (!active) return;
        setOverview(data);
        setVersions(vers.versions ?? []);
      })
      .catch((err) => {
        if (!active) return;
        toast({
          title: translate("privacy.loadFailed"),
          description: err instanceof Error ? err.message : translate("toast.tryAgain"),
          variant: "destructive",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast, translate]);

  async function handleExport() {
    setExportBusy(true);
    try {
      const result = await requestDataExport();
      toast({ title: translate("privacy.exportRequested"), description: result.message });
    } catch (err) {
      toast({
        title: translate("privacy.exportFailed"),
        description: err instanceof Error ? err.message : translate("toast.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setExportBusy(false);
    }
  }

  async function handleAnalyticsToggle(checked: boolean) {
    setAnalyticsBusy(true);
    try {
      await setAnalyticsOptOut(checked);
      setOverview((prev) => (prev ? { ...prev, analytics_opt_out: checked } : prev));
      toast({
        title: checked
          ? translate("privacy.analyticsOptOutEnabled")
          : translate("privacy.analyticsOptOutDisabled"),
      });
    } catch (err) {
      toast({
        title: translate("privacy.preferenceUpdateFailed"),
        description: err instanceof Error ? err.message : translate("toast.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setAnalyticsBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-cc-plum" />
        <span className="sr-only">{translate("common.loading")}</span>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      {showHeader && (
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
            {translate("privacy.eyebrow")}
          </p>
          <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: "var(--cc-text)" }}>
            {translate("privacy.title")}
          </h1>
          <p className="mt-2 text-sm text-cc-muted">
            {translate("privacy.subtitle")}
          </p>
        </div>
      )}

      <section className="rounded-[1.5rem] border bg-card p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-cc-text">
          <Shield className="h-5 w-5 text-cc-plum" /> {translate("privacy.dataHeld")}
        </h2>
        <div className="space-y-3">
          {(overview?.data_categories ?? []).map((cat) => (
            <div key={cat.id} className="rounded-xl border px-4 py-3" style={{ borderColor: BORDER }}>
              <p className="font-bold text-cc-text">{cat.title}</p>
              <p className="mt-1 text-sm text-cc-muted">{cat.description}</p>
              <p className="mt-2 text-xs font-semibold text-cc-plum">
                {translate("privacy.retention")} {cat.retention}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[1.5rem] border bg-card p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <h2 className="mb-2 text-lg font-bold text-cc-text">{translate("privacy.downloadData")}</h2>
        <p className="mb-4 text-sm text-cc-muted">
          {translate("privacy.downloadHint")}
        </p>
        <Button
          type="button"
          className="rounded-xl gap-2"
          style={{ background: "var(--cc-cta)" }}
          disabled={exportBusy}
          onClick={() => void handleExport()}
        >
          {exportBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          {translate("privacy.downloadMyData")}
        </Button>
      </section>

      <section className="rounded-[1.5rem] border bg-card p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <h2 className="mb-2 text-lg font-bold text-cc-text">{translate("privacy.policy")}</h2>
        <p className="text-sm leading-relaxed text-cc-text">
          {overview?.privacy_policy.summary_text}
        </p>
        {overview?.privacy_policy.published_at && (
          <p className="mt-2 text-xs text-cc-muted">
            {translateParams("privacy.lastUpdated", {
              date: new Date(overview.privacy_policy.published_at).toLocaleDateString(),
              version: overview.privacy_policy.version,
            })}
          </p>
        )}
        <button
          type="button"
          className="mt-3 flex items-center gap-1 text-sm font-bold text-cc-plum"
          onClick={() => setPolicyOpen(!policyOpen)}
        >
          {translate("privacy.versionHistory")} <ChevronDown className={policyOpen ? "rotate-180" : ""} size={16} />
        </button>
        {policyOpen && (
          <ul className="mt-2 space-y-1 text-sm text-cc-muted">
            {versions.map((v) => (
              <li key={v.version}>
                {translateParams("privacy.versionEntry", {
                  version: v.version,
                  date: v.published_at ? new Date(v.published_at).toLocaleDateString() : translate("common.emDash"),
                  current: v.is_current ? ` ${translate("privacy.current")}` : "",
                })}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[1.5rem] border bg-card p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-cc-text">{translate("privacy.analyticsOptOut")}</h2>
            <p className="text-sm text-cc-muted">{translate("privacy.analyticsOptOutHint")}</p>
          </div>
          <Switch
            checked={overview?.analytics_opt_out ?? false}
            disabled={analyticsBusy}
            onCheckedChange={(v) => void handleAnalyticsToggle(v)}
          />
        </div>
      </section>

      {isMD ? (
        <section className="rounded-[1.5rem] border p-6 shadow-sm" style={{ borderColor: BORDER }}>
          <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-cc-text">
            <CreditCard className="h-5 w-5 text-cc-plum" /> {translate("privacy.mdUnsubscribeTitle")}
          </h2>
          <p className="mb-4 text-sm text-cc-muted">
            {translate("privacy.mdUnsubscribeHint")}
          </p>
          {onManageSubscription && (
            <Button type="button" variant="outline" className="rounded-xl" onClick={onManageSubscription}>
              {translate("privacy.manageSubscription")}
            </Button>
          )}
        </section>
      ) : (
        <section className="rounded-[1.5rem] border p-6 shadow-sm" style={{ borderColor: BORDER }}>
          <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-cc-text">
            <Shield className="h-5 w-5 text-cc-plum" /> {translate("privacy.staffDeletionTitle")}
          </h2>
          <p className="text-sm text-cc-muted">
            {translate("privacy.staffDeletionHint")}
          </p>
        </section>
      )}
    </div>
  );
}
