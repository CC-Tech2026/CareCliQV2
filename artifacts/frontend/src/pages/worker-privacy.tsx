import { useEffect, useState } from "react";
import { ChevronDown, Download, Loader2, Shield, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  getPrivacyOverview,
  listPrivacyPolicyVersions,
  requestAccountDeletion,
  requestDataExport,
  setAnalyticsOptOut,
  type PrivacyOverview,
} from "@/services/complianceService";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const BORDER = "#E2DEF2";

export default function WorkerPrivacy() {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [overview, setOverview] = useState<PrivacyOverview | null>(null);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [versions, setVersions] = useState<Array<{ version: string; published_at: string; is_current?: boolean }>>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
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
          title: "Could not load privacy settings",
          description: err instanceof Error ? err.message : "Please try again.",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast]);

  async function handleExport() {
    setExportBusy(true);
    try {
      const result = await requestDataExport();
      toast({ title: "Export requested", description: result.message });
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setExportBusy(false);
    }
  }

  async function handleDeletion() {
    setDeleteBusy(true);
    try {
      const result = await requestAccountDeletion(deleteText);
      toast({ title: "Request submitted", description: result.message });
      setDeleteText("");
    } catch (err) {
      toast({
        title: "Could not submit request",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setDeleteBusy(false);
    }
  }

  async function handleAnalyticsToggle(checked: boolean) {
    setAnalyticsBusy(true);
    try {
      await setAnalyticsOptOut(checked);
      setOverview((prev) => (prev ? { ...prev, analytics_opt_out: checked } : prev));
      toast({ title: checked ? "Analytics opt-out enabled" : "Analytics opt-out disabled" });
    } catch (err) {
      toast({
        title: "Could not update preference",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setAnalyticsBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-[#5533CC]" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-10">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
          Privacy
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>
          Your data &amp; privacy
        </h1>
        <p className="mt-2 text-sm text-[#7A6A9E]">
          Transparency and control over your personal data, in line with the Australian Privacy Act 1988.
        </p>
      </div>

      <section className="rounded-[1.5rem] border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <h2 className="mb-4 flex items-center gap-2 text-lg font-bold text-[#1E1640]">
          <Shield className="h-5 w-5 text-[#5533CC]" /> What data we hold about you
        </h2>
        <div className="space-y-3">
          {(overview?.data_categories ?? []).map((cat) => (
            <div key={cat.id} className="rounded-xl border px-4 py-3" style={{ borderColor: BORDER }}>
              <p className="font-bold text-[#1E1640]">{cat.title}</p>
              <p className="mt-1 text-sm text-[#7A6A9E]">{cat.description}</p>
              <p className="mt-2 text-xs font-semibold text-[#5533CC]">Retention: {cat.retention}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-[1.5rem] border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <h2 className="mb-2 text-lg font-bold text-[#1E1640]">Download personal data</h2>
        <p className="mb-4 text-sm text-[#7A6A9E]">
          Request a human-readable JSON export of your data. You will receive an email with a secure download link that expires after 48 hours.
        </p>
        <Button
          type="button"
          className="rounded-xl gap-2"
          style={{ background: PLUM }}
          disabled={exportBusy}
          onClick={() => void handleExport()}
        >
          {exportBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download my data
        </Button>
      </section>

      <section className="rounded-[1.5rem] border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <h2 className="mb-2 text-lg font-bold text-[#1E1640]">Privacy policy</h2>
        <p className="text-sm leading-relaxed text-[#1E1640]">
          {overview?.privacy_policy.summary_text}
        </p>
        {overview?.privacy_policy.published_at && (
          <p className="mt-2 text-xs text-[#7A6A9E]">
            Last updated: {new Date(overview.privacy_policy.published_at).toLocaleDateString()} · Version {overview.privacy_policy.version}
          </p>
        )}
        <button
          type="button"
          className="mt-3 flex items-center gap-1 text-sm font-bold text-[#5533CC]"
          onClick={() => setPolicyOpen(!policyOpen)}
        >
          Version history <ChevronDown className={policyOpen ? "rotate-180" : ""} size={16} />
        </button>
        {policyOpen && (
          <ul className="mt-2 space-y-1 text-sm text-[#7A6A9E]">
            {versions.map((v) => (
              <li key={v.version}>
                v{v.version} · {v.published_at ? new Date(v.published_at).toLocaleDateString() : "—"}
                {v.is_current ? " (current)" : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-[1.5rem] border bg-white p-6 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-[#1E1640]">Analytics opt-out</h2>
            <p className="text-sm text-[#7A6A9E]">Disable product analytics tracking for your account.</p>
          </div>
          <Switch
            checked={overview?.analytics_opt_out ?? false}
            disabled={analyticsBusy}
            onCheckedChange={(v) => void handleAnalyticsToggle(v)}
          />
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-red-200 bg-red-50/40 p-6 shadow-sm">
        <h2 className="mb-2 flex items-center gap-2 text-lg font-bold text-red-800">
          <Trash2 className="h-5 w-5" /> Request account deletion
        </h2>
        <p className="mb-4 text-sm text-red-700">
          This submits a formal request to your coordinator. Type <strong>DELETE MY ACCOUNT</strong> to confirm.
        </p>
        <div className="space-y-3">
          <div>
            <Label htmlFor="delete-confirm">Confirmation</Label>
            <Input
              id="delete-confirm"
              value={deleteText}
              onChange={(e) => setDeleteText(e.target.value)}
              placeholder="DELETE MY ACCOUNT"
              className="mt-1 rounded-xl"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            className="rounded-xl border-red-300 text-red-700 hover:bg-red-100"
            disabled={deleteBusy || deleteText.trim() !== "DELETE MY ACCOUNT"}
            onClick={() => void handleDeletion()}
          >
            {deleteBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Request account deletion"}
          </Button>
        </div>
      </section>
    </div>
  );
}
