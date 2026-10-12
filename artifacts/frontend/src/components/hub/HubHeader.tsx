import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { format } from "date-fns";
import { Link } from "wouter";
import { ArrowRight, CalendarDays } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { PageHeader, ctaClass, ghostClass } from "@/components/layout/PageKit";

interface OrgResponse {
  organization_name?: string;
  provider_number?: string;
}

export function HubHeader() {
  const { user } = useAuth();
  const { translate, translateParams } = useAccessibility();

  const [orgName, setOrgName] = useState(
    translate("hub.orgFallback")
  );

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const hour = now.getHours();

  const firstName =
    user?.full_name?.trim().split(/\s+/)[0] ||
    translate("hub.header.greetingFallback");

  const greeting =
    hour < 12
      ? translateParams("hub.header.greetingMorning", {
          name: firstName,
        })
      : hour < 17
        ? translateParams("hub.header.greetingAfternoon", {
            name: firstName,
          })
        : translateParams("hub.header.greetingEvening", {
            name: firstName,
          });

  const today = format(now, "EEEE, d MMMM yyyy");
  const isMD = user?.role === "managing_director";

  useEffect(() => {
    let cancelled = false;

    apiFetch("/api/hub/org")
      .then((res) =>
        res.ok ? res.json() : Promise.reject()
      )
      .then((data: OrgResponse) => {
        if (!cancelled) {
          setOrgName(
            data.organization_name ||
              translate("hub.orgFallback")
          );
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [translate, user?.organizationId]);

  if (isMD) {
    return (
      <PageHeader
        eyebrow={greeting}
        title="Your executive briefing"
        description={
          <>
            <span className="break-words">{orgName}</span>
            <time dateTime={format(now, "yyyy-MM-dd")} className="ml-2 inline-flex items-center gap-1.5">
              <CalendarDays size={14} />
              {today}
            </time>
          </>
        }
        actions={
          <nav aria-label="Executive resources" className="flex w-full flex-wrap items-center gap-1 sm:w-auto sm:gap-2">
            <Link href="/reports" className={ghostClass}>Report library</Link>
            <Link href="/md/executive" className={`${ctaClass} order-first w-full sm:order-none sm:w-auto`}>
              Performance review
              <ArrowRight size={15} />
            </Link>
          </nav>
        }
      />
    );
  }

  return (
    <header className="flex items-end justify-between gap-6 px-1">

      <div className="min-w-0">

        <h1
          className="text-[25px] font-black tracking-tight"
          style={{
            color: "var(--cc-text)",
          }}
        >
          {greeting}
        </h1>

        <p
          className="mt-1 text-[12px]"
          style={{
            color: "var(--cc-muted)",
          }}
        >
          {orgName}
        </p>

      </div>

      <time
        className="hidden shrink-0 text-[11px] font-semibold sm:block"
        style={{
          color: "var(--cc-muted)",
        }}
      >
        {today}
      </time>

    </header>
  );
}
