import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus, Check, Copy, ExternalLink, Loader2 } from "lucide-react";
import { SidePanel } from "@/components/layout/SidePanel";
import { ctaClass, ghostClass, outlineClass } from "@/components/layout/PageKit";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useToast } from "@/hooks/use-toast";
import { formatAppDate, formatAppTime } from "@/lib/datetime";
import {
  calendarFeedUrl,
  calendarSubscribeLinks,
  createCalendarFeedToken,
  getCalendarFeedStatus,
  stopCalendarFeed,
} from "@/services/workerCalendarService";

const STATUS_KEY = ["worker", "calendar", "feed-status"];

function whenChecked(iso: string) {
  return `${formatAppDate(iso)}, ${formatAppTime(iso)}`;
}

/** Shifts into Google Calendar, Outlook or Apple Calendar: a private
 *  subscription link the worker's calendar app keeps checking. The link is
 *  shown once (only its hash is stored), so a new one replaces the old. */
export function CalendarSyncSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { translate, translateParams } = useAccessibility();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [feedUrl, setFeedUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmStop, setConfirmStop] = useState(false);

  const status = useOrgQuery(STATUS_KEY, { queryFn: getCalendarFeedStatus, enabled: open, staleTime: 30_000 });

  const make = useMutation({
    mutationFn: createCalendarFeedToken,
    onSuccess: (res) => {
      setFeedUrl(calendarFeedUrl(res.feed_path));
      setCopied(false);
      setConfirmStop(false);
      void qc.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (e: Error) => toast({ title: translate("common.error"), description: e.message, variant: "destructive" }),
  });

  const stop = useMutation({
    mutationFn: stopCalendarFeed,
    onSuccess: () => {
      setFeedUrl(null);
      setConfirmStop(false);
      toast({ title: translate("calendar.sync.stopped") });
      void qc.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (e: Error) => toast({ title: translate("common.error"), description: e.message, variant: "destructive" }),
  });

  const copy = async () => {
    if (!feedUrl) return;
    try {
      await navigator.clipboard.writeText(feedUrl);
      setCopied(true);
    } catch {
      toast({ title: translate("common.error"), variant: "destructive" });
    }
  };

  const links = feedUrl ? calendarSubscribeLinks(feedUrl) : null;
  const active = status.data?.active ?? false;

  return (
    <SidePanel
      open={open}
      onOpenChange={(next) => {
        if (!next) setConfirmStop(false);
        onOpenChange(next);
      }}
      icon={CalendarPlus}
      title={translate("calendar.sync.title")}
      description={translate("calendar.sync.intro")}
      footer={
        active && !feedUrl ? (
          confirmStop ? (
            <>
              <button type="button" className={ghostClass} onClick={() => setConfirmStop(false)}>
                {translate("common.cancel")}
              </button>
              <button type="button" className={ctaClass} disabled={stop.isPending} onClick={() => stop.mutate()}>
                {stop.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {translate("calendar.sync.stop")}
              </button>
            </>
          ) : (
            <>
              <button type="button" className={ghostClass} onClick={() => setConfirmStop(true)}>
                {translate("calendar.sync.stop")}
              </button>
              <button type="button" className={ctaClass} disabled={make.isPending} onClick={() => make.mutate()}>
                {make.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {translate("calendar.sync.newLink")}
              </button>
            </>
          )
        ) : !feedUrl ? (
          <button
            type="button"
            className={ctaClass}
            disabled={make.isPending || status.isLoading}
            onClick={() => make.mutate()}
          >
            {make.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {translate("calendar.sync.connect")}
          </button>
        ) : undefined
      }
    >
      {status.isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin text-cc-muted" />
      ) : links && feedUrl ? (
        <section className="space-y-3" aria-label={translate("calendar.sync.pick")}>
          <p className="text-sm font-semibold text-cc-text">{translate("calendar.sync.pick")}</p>
          <div className="divide-y divide-cc-border rounded-xl border border-cc-border">
            {(
              [
                ["calendar.sync.google", links.google],
                ["calendar.sync.outlookPersonal", links.outlookPersonal],
                ["calendar.sync.outlookWork", links.outlookWork],
                ["calendar.sync.apple", links.webcal],
              ] as const
            ).map(([key, href]) => (
              <a
                key={key}
                href={href}
                target={href.startsWith("webcal:") ? undefined : "_blank"}
                rel="noreferrer"
                className="flex min-h-12 items-center justify-between gap-3 px-4 text-sm font-medium text-cc-text hover:bg-cc-soft"
              >
                {translate(key)}
                <ExternalLink className="h-4 w-4 shrink-0 text-cc-muted" />
              </a>
            ))}
          </div>
          <div className="rounded-xl bg-cc-soft p-3">
            <p className="text-xs text-cc-muted">{translate("calendar.sync.linkLabel")}</p>
            <p className="mt-1 break-all font-mono text-xs text-cc-text">{feedUrl}</p>
            <button type="button" className={`${outlineClass} mt-3`} onClick={() => void copy()}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {translate(copied ? "calendar.sync.copied" : "calendar.sync.copy")}
            </button>
          </div>
          <p className="text-xs leading-5 text-cc-muted">{translate("calendar.sync.linkHint")}</p>
        </section>
      ) : active ? (
        <section className="space-y-2 rounded-xl border border-cc-border p-4">
          <p className="text-sm font-semibold text-cc-text">{translate("calendar.sync.active")}</p>
          <p className="text-sm text-cc-muted">
            {status.data?.last_accessed_at
              ? translateParams("calendar.sync.lastChecked", { time: whenChecked(status.data.last_accessed_at) })
              : translate("calendar.sync.notChecked")}
          </p>
          <p className="text-xs leading-5 text-cc-muted">
            {translate(confirmStop ? "calendar.sync.stopHint" : "calendar.sync.newLinkHint")}
          </p>
        </section>
      ) : null}

      <section className="space-y-2 text-xs leading-5 text-cc-muted">
        <p>{translate("calendar.sync.privacy")}</p>
        <p>{translate("calendar.sync.delay")}</p>
      </section>
    </SidePanel>
  );
}
