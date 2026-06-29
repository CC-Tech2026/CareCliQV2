import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { format, parseISO } from "date-fns";
import { Loader2, Mail, MessageCircle, Phone, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { WORKER_FAQ_FALLBACK } from "@/content/worker-faq-fallback";
import { useWorkerTutorial } from "@/hooks/useWorkerTutorial";
import { WORKER_TUTORIAL_STEPS } from "@/lib/worker-tutorial-steps";
import { BORDER, CORAL, MUTED, PLUM, SOFT, TEXT } from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  getKnownIssues,
  getSupportConfig,
  searchFaq,
  type FaqArticle,
  type KnownIssue,
  type SupportConfig,
} from "@/services/helpService";


type Tab = "tutorial" | "faq" | "chat" | "issues";

function isWithinBusinessHours(config: SupportConfig | null): boolean {
  if (!config?.business_hours_json) return true;
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-AU", {
      timeZone: config.business_hours_json.timezone || "Australia/Sydney",
      weekday: "short",
      hour: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "12");
    const isWeekday = !["Sat", "Sun"].includes(weekday);
    return isWeekday && hour >= 9 && hour < 17;
  } catch {
    return true;
  }
}

function IntercomPanel({ appId, translate }: { appId?: string | null; translate: (key: string) => string }) {
  useEffect(() => {
    if (!appId || typeof window === "undefined") return;
    const w = window as Window & { Intercom?: (...args: unknown[]) => void; intercomSettings?: Record<string, unknown> };
    w.intercomSettings = { app_id: appId };
    if (w.Intercom) {
      w.Intercom("boot", { app_id: appId });
      return;
    }
    const script = document.createElement("script");
    script.src = `https://widget.intercom.io/widget/${appId}`;
    script.async = true;
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, [appId]);

  if (!appId) {
    return (
      <p className="text-sm" style={{ color: MUTED }}>
        {translate("help.chat.unconfigured")}
      </p>
    );
  }

  return (
    <div className="rounded-2xl border border-cc-border bg-cc-bg p-6 text-center">
      <MessageCircle className="mx-auto h-8 w-8 text-cc-plum" />
      <p className="mt-3 text-sm font-bold" style={{ color: TEXT }}>
        {translate("help.chat.prompt")}
      </p>
      <Button
        className="mt-4 rounded-xl"
        style={{ background: PLUM }}
        onClick={() => {
          const w = window as Window & { Intercom?: (...args: unknown[]) => void };
          w.Intercom?.("show");
        }}
      >
        {translate("help.chat.open")}
      </Button>
    </div>
  );
}

export default function WorkerHelp() {
  const { translate, translateParams } = useAccessibility();
  const [tab, setTab] = useState<Tab>("faq");
  const [query, setQuery] = useState("");
  const [faq, setFaq] = useState<FaqArticle[]>([]);
  const [issues, setIssues] = useState<KnownIssue[]>([]);
  const [config, setConfig] = useState<SupportConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const tutorial = useWorkerTutorial();

  useEffect(() => {
    let active = true;
    Promise.all([
      searchFaq().catch(() => ({ articles: WORKER_FAQ_FALLBACK })),
      getKnownIssues().catch(() => ({ issues: [] })),
      getSupportConfig().catch(() => null),
    ]).then(([faqRes, issuesRes, cfg]) => {
      if (!active) return;
      setFaq(faqRes.articles?.length ? faqRes.articles : WORKER_FAQ_FALLBACK);
      setIssues(issuesRes.issues ?? []);
      setConfig(cfg);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, []);

  const filteredFaq = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return faq;
    return faq.filter((article) => {
      const hay = `${article.title} ${article.body_markdown} ${(article.tags ?? []).join(" ")}`.toLowerCase();
      return hay.includes(term);
    });
  }, [faq, query]);

  const selectedArticle = filteredFaq.find((a) => a.slug === selectedSlug) ?? filteredFaq[0];
  const inHours = isWithinBusinessHours(config);

  const tabs: { id: Tab; label: string }[] = useMemo(
    () => [
      { id: "tutorial", label: translate("help.tab.tutorial") },
      { id: "faq", label: translate("help.tab.faq") },
      { id: "chat", label: translate("help.tab.chat") },
      { id: "issues", label: translate("help.tab.issues") },
    ],
    [translate],
  );

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12 text-safe">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: PLUM }}>
          {translate("nav.help")}
        </p>
        <h1 className="mt-1 text-3xl font-black" style={{ color: TEXT }}>
          {translate("help.title")}
        </h1>
        <p className="mt-2 text-sm font-medium" style={{ color: MUTED }}>
          {translate("help.subtitle")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            className={`rounded-full px-4 py-2 text-xs font-black transition ${
              tab === item.id ? "bg-cc-plum text-white" : "bg-cc-bg text-cc-muted"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex justify-center py-12">
          <Loader2 className="h-7 w-7 animate-spin text-cc-plum" />
        </div>
      )}

      {!loading && tab === "tutorial" && (
        <div className="space-y-4 rounded-2xl border border-cc-border bg-cc-surface p-6">
          <p className="text-sm" style={{ color: MUTED }}>
            {translate("help.tutorial.intro")}
          </p>
          <Button className="rounded-xl" style={{ background: PLUM }} onClick={() => tutorial.replay()}>
            {translate("help.tutorial.replay")}
          </Button>
          <div className="grid gap-2 sm:grid-cols-2">
            {WORKER_TUTORIAL_STEPS.map((step) => (
              <button
                key={step.key}
                type="button"
                onClick={() => tutorial.start(0, step.key)}
                className="rounded-xl border border-cc-border p-4 text-left transition hover:bg-cc-bg"
              >
                <p className="text-sm font-black" style={{ color: TEXT }}>
                  {step.title}
                </p>
                <p className="mt-1 text-xs" style={{ color: MUTED }}>
                  {translate("help.tutorial.topicHint")}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {!loading && tab === "faq" && (
        <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
          <div className="space-y-3">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-cc-muted" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={translate("help.faq.search")}
                className="rounded-xl pl-9"
              />
            </div>
            <div className="max-h-[420px] space-y-1 overflow-y-auto rounded-2xl border border-cc-border bg-cc-surface p-2">
              {filteredFaq.map((article) => (
                <button
                  key={article.slug}
                  type="button"
                  onClick={() => setSelectedSlug(article.slug)}
                  className={`w-full rounded-xl px-3 py-2 text-left text-sm font-bold ${
                    selectedArticle?.slug === article.slug ? "bg-[#EDEAFF] text-cc-plum" : "text-cc-text"
                  }`}
                >
                  {article.title}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-2xl border border-cc-border bg-cc-surface p-6">
            {selectedArticle ? (
              <>
                <h2 className="text-xl font-black" style={{ color: TEXT }}>
                  {selectedArticle.title}
                </h2>
                <p className="mt-4 whitespace-pre-wrap text-sm leading-relaxed" style={{ color: MUTED }}>
                  {selectedArticle.body_markdown}
                </p>
                {selectedArticle.slug === "offline" && (
                  <Link href="/worker/sync-status">
                    <Button variant="outline" className="mt-4 rounded-xl">
                      Open sync status
                    </Button>
                  </Link>
                )}
              </>
            ) : (
              <p className="text-sm" style={{ color: MUTED }}>
                {translate("help.faq.empty")}
              </p>
            )}
          </div>
        </div>
      )}

      {!loading && tab === "chat" && (
        <div className="space-y-6">
          {inHours ? (
            <IntercomPanel appId={config?.intercom_app_id} translate={translate} />
          ) : (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-950">
              {config?.outside_hours_message || translate("help.chat.outsideHours")}
            </div>
          )}

          <div className="rounded-2xl border border-cc-border bg-cc-surface p-6">
            <h2 className="text-lg font-black" style={{ color: TEXT }}>
              {translate("help.chat.fallbackTitle")}
            </h2>
            <p className="mt-2 text-sm" style={{ color: MUTED }}>
              {config?.business_hours_json?.weekdays || translate("help.chat.hoursDefault")}
            </p>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <a
                href={`tel:${(config?.support_phone || "").replace(/\s/g, "")}`}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-cc-border px-4 py-3 text-sm font-bold"
              >
                <Phone className="h-4 w-4" />
                {translateParams("help.chat.callNow", { phone: config?.support_phone || "" })}
              </a>
              <a
                href={`mailto:${config?.support_email}`}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-cc-border px-4 py-3 text-sm font-bold"
              >
                <Mail className="h-4 w-4" />
                {config?.support_email}
              </a>
            </div>
          </div>
        </div>
      )}

      {!loading && tab === "issues" && (
        <div className="space-y-3">
          {issues.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-cc-border bg-cc-surface p-8 text-center text-sm" style={{ color: MUTED }}>
              {translate("help.issues.empty")}
            </div>
          ) : (
            issues.map((issue) => (
              <div key={issue.id} className="rounded-2xl border border-cc-border bg-cc-surface p-5">
                <h3 className="font-black" style={{ color: TEXT }}>
                  {issue.title}
                </h3>
                <p className="mt-2 text-sm" style={{ color: MUTED }}>
                  {issue.description}
                </p>
                {issue.affected_version && (
                  <p className="mt-2 text-xs font-bold" style={{ color: MUTED }}>
                    {translateParams("help.issues.affectedVersion", { version: issue.affected_version })}
                  </p>
                )}
                {issue.workaround && (
                  <p className="mt-2 text-sm">
                    <span className="font-bold">{translate("help.issues.workaround")}</span> {issue.workaround}
                  </p>
                )}
                {issue.expected_fix_date && (
                  <p className="mt-2 text-xs" style={{ color: MUTED }}>
                    {translateParams("help.issues.expectedFix", {
                      date: format(parseISO(issue.expected_fix_date), "d MMM yyyy"),
                    })}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
