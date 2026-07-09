import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileDataWarningModal } from "@/components/offline/MobileDataWarningModal";
import { useOfflineSync } from "@/contexts/OfflineSyncContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { formatBytes } from "@/lib/format-bytes";
import { setMobileUploadConsent } from "@/lib/mobile-data-guard";
import { getShiftDataUsageBytes } from "@/lib/shift-data-usage";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

export default function WorkerSyncStatusPage() {
  const { translate } = useAccessibility();
  const {
    online,
    syncing,
    queueItems,
    lastResults,
    activeShiftId,
    retryAll,
  } = useOfflineSync();
  const [mobilePromptOpen, setMobilePromptOpen] = useState(false);
  const [mobileSizeLabel, setMobileSizeLabel] = useState("");
  const [localResults, setLocalResults] = useState(lastResults);

  useEffect(() => {
    setLocalResults(lastResults);
  }, [lastResults]);

  const dataUsage = getShiftDataUsageBytes(activeShiftId);

  const resultById = useMemo(() => {
    const map = new Map<string, { ok: boolean; error?: string }>();
    for (const row of localResults) {
      map.set(row.id, row);
    }
    return map;
  }, [localResults]);

  async function handleRetry() {
    const totalBytes = queueItems.reduce((sum, item) => sum + item.sizeBytes, 0);
    if (totalBytes >= 10 * 1024 * 1024) {
      setMobileSizeLabel(formatBytes(totalBytes));
      setMobilePromptOpen(true);
      return;
    }
    const result = await retryAll();
    if (result) setLocalResults(result.results);
  }

  async function runSyncAfterConsent(allow: boolean) {
    setMobilePromptOpen(false);
    if (!allow) {
      setMobileUploadConsent("wifi_only");
      return;
    }
    setMobileUploadConsent("allow");
    const result = await retryAll();
    if (result) setLocalResults(result.results);
  }

  return (
    <div className="w-full space-y-6 pb-10 text-safe">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: PLUM }}>
          {translate("sync.page.eyebrow")}
        </p>
        <h1 className="mt-1 text-2xl font-black" style={{ color: TEXT }}>
          {translate("sync.page.title")}
        </h1>
        <p className="mt-2 text-sm" style={{ color: MUTED }}>
          {translate("sync.page.hint")}
        </p>
      </div>

      {activeShiftId && (
        <div className="rounded-2xl border border-cc-border bg-card p-4">
          <p className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>
            {translate("sync.page.mobileData")}
          </p>
          <p className="mt-1 text-2xl font-black" style={{ color: PLUM }}>
            {formatBytes(dataUsage)}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {queueItems.length === 0 ? (
          <div
            className="rounded-2xl border border-dashed border-cc-border bg-card p-8 text-center text-sm"
            style={{ color: MUTED }}
          >
            {translate("sync.page.empty")}
          </div>
        ) : (
          queueItems.map((item) => {
            const result = resultById.get(item.id);
            const queuedLabel = formatDistanceToNow(parseISO(item.queuedAt), { addSuffix: true });
            return (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3 rounded-2xl border border-cc-border bg-card p-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-black text-safe" style={{ color: TEXT }}>
                    {item.label} · {item.detail} · {translate("sync.page.queued")} {queuedLabel}
                  </p>
                  {result && !result.ok && (
                    <p className="mt-1 text-xs text-red-600">{result.error}</p>
                  )}
                </div>
                {result?.ok && (
                  <Check className="h-5 w-5 shrink-0 text-emerald-600" aria-label={translate("sync.page.synced")} />
                )}
                {result && !result.ok && (
                  <X className="h-5 w-5 shrink-0 text-red-500" aria-label={translate("sync.page.failed")} />
                )}
              </div>
            );
          })
        )}
      </div>

      <Button
        className="w-full min-h-11 gap-2 rounded-xl"
        disabled={!online || syncing || queueItems.length === 0}
        onClick={() => void handleRetry()}
        style={{ background: PLUM }}
        aria-label={translate("sync.page.retry")}
      >
        {syncing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RefreshCw className="h-4 w-4" aria-hidden />}
        {translate("sync.page.retry")}
      </Button>

      <MobileDataWarningModal
        open={mobilePromptOpen}
        sizeLabel={mobileSizeLabel}
        onUploadNow={() => void runSyncAfterConsent(true)}
        onWaitForWifi={() => void runSyncAfterConsent(false)}
      />
    </div>
  );
}
