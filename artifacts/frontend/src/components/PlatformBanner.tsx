import { useEffect, useState } from "react";
import { Info, TriangleAlert, X } from "lucide-react";
import { getCurrentBanners, type Banner } from "@/services/adminMessagesService";

// One fetch shared by every page the user visits, refreshed every 10 minutes.
let cache: { at: number; banners: Banner[] } | null = null;
const TTL = 10 * 60 * 1000;
const DISMISSED_KEY = "cc-dismissed-banners";

function readDismissed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(DISMISSED_KEY) || "[]");
  } catch {
    return [];
  }
}

/** The site banner CareCliQ staff set in the admin portal (System page):
 *  maintenance, outages, news. Each person can close it; it stays closed
 *  on this device. Shows nothing when there's no banner or on any error. */
export function PlatformBanner() {
  const [banners, setBanners] = useState<Banner[]>(cache?.banners ?? []);
  const [dismissed, setDismissed] = useState<string[]>(readDismissed);

  useEffect(() => {
    if (cache && Date.now() - cache.at < TTL) return;
    let cancelled = false;
    getCurrentBanners()
      .then((r) => {
        cache = { at: Date.now(), banners: r.banners ?? [] };
        if (!cancelled) setBanners(cache.banners);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const shown = banners.filter((b) => !dismissed.includes(b.id) && new Date(b.ends_at).getTime() > Date.now());
  if (!shown.length) return null;

  function dismiss(id: string) {
    const next = [...dismissed, id].slice(-50);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify(next));
    } catch {
      // private window: it just comes back on the next page load
    }
  }

  return (
    <div className="mb-3 space-y-2">
      {shown.map((b) => {
        const warning = b.tone === "warning";
        const Icon = warning ? TriangleAlert : Info;
        return (
          <div
            key={b.id}
            role={warning ? "alert" : "status"}
            className="flex items-start gap-3 rounded-2xl px-4 py-3"
            style={{ background: warning ? "var(--cc-status-warning-bg)" : "var(--cc-status-info-bg)" }}
          >
            <Icon size={17} className="mt-0.5 shrink-0" style={{ color: warning ? "var(--cc-status-warning)" : "var(--cc-status-info)" }} />
            <p className="min-w-0 flex-1 text-sm text-cc-text">
              {b.message}
              {b.link_label && b.link_url && (
                <>
                  {" "}
                  <a href={b.link_url} className="font-semibold text-cc-plum underline-offset-2 hover:underline" target={b.link_url.startsWith("http") && !b.link_url.startsWith(window.location.origin) ? "_blank" : undefined} rel="noopener noreferrer">
                    {b.link_label}
                  </a>
                </>
              )}
            </p>
            <button type="button" onClick={() => dismiss(b.id)} className="-m-1.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-black/5" aria-label="Close this notice">
              <X size={15} className="text-cc-muted" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
