import { useEffect, useMemo, useState } from "react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Check, Loader2, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MobileDataWarningModal } from "@/components/offline/MobileDataWarningModal";
import { useOfflineSync } from "@/contexts/OfflineSyncContext";
import { formatBytes } from "@/lib/format-bytes";
import { setMobileUploadConsent } from "@/lib/mobile-data-guard";
import { getShiftDataUsageBytes } from "@/lib/shift-data-usage";
import { PLUM, MUTED, TEXT } from "@/lib/shift-utils";

const PLUM_LOCAL = PLUM;
const TEXT_LOCAL = TEXT;
const MUTED_LOCAL = MUTED;

export default function WorkerSyncStatusPage() {
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
    <div className="mx-auto max-w-2xl space-y-6 pb-10">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: PLUM_LOCAL }}>
          Sync status
        </p>
        <h1 className="mt-1 text-2xl font-black" style={{ color: TEXT_LOCAL }}>
          Pending uploads
        </h1>
        <p className="mt-2 text-sm" style={{ color: MUTED_LOCAL }}>
          Compliance items cannot be deleted. They will sync automatically when you are back online.
        </p>
      </div>

      {activeShiftId && (
        <div className="rounded-2xl border border-[#E2DEF2] bg-white p-4">
          <p className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED_LOCAL }}>
            Mobile data this shift
          </p>
          <p className="mt-1 text-2xl font-black" style={{ color: PLUM_LOCAL }}>
            {formatBytes(dataUsage)}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {queueItems.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[#E2DEF2] bg-white p-8 text-center text-sm" style={{ color: MUTED_LOCAL }}>
            No pending items — everything is synced.
          </div>
        ) : (
          queueItems.map((item) => {
            const result = resultById.get(item.id);
            const queuedLabel = formatDistanceToNow(parseISO(item.queuedAt), { addSuffix: true });
            return (
              <div
                key={item.id}
                className="flex items-start justify-between gap-3 rounded-2xl border border-[#E2DEF2] bg-white p-4"
              >
                <div className="min-w-0">
                  <p className="text-sm font-black" style={{ color: TEXT_LOCAL }}>
                    {item.label} — {item.detail} — queued {queuedLabel}
                  </p>
                  {result && !result.ok && (
                    <p className="mt-1 text-xs text-red-600">{result.error}</p>
                  )}
                </div>
                {result?.ok && <Check className="h-5 w-5 shrink-0 text-emerald-600" aria-label="Synced" />}
                {result && !result.ok && <X className="h-5 w-5 shrink-0 text-red-500" aria-label="Failed" />}
              </div>
            );
          })
        )}
      </div>

      <Button
        className="w-full gap-2 rounded-xl"
        disabled={!online || syncing || queueItems.length === 0}
        onClick={() => void handleRetry()}
        style={{ background: PLUM_LOCAL }}
      >
        {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Retry sync
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
