import { ArrowDown, ArrowUp, Award, GraduationCap, Minus, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { getPerformanceDashboard } from "@/services/workerPerformanceService";
import { BORDER, CORAL, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

function TrendIcon({ direction }: { direction: string }) {
  if (direction === "up") return <ArrowUp size={28} className="text-emerald-600" />;
  if (direction === "down") return <ArrowDown size={28} className="text-red-600" />;
  return <Minus size={28} style={{ color: MUTED }} />;
}

export default function WorkerPerformanceDashboardPage() {
  const { translate, translateParams } = useAccessibility();
  const { data, isLoading, error } = useOrgQuery(["worker", "performance-dashboard"], {
    queryFn: getPerformanceDashboard,
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="p-6 text-sm font-bold" style={{ color: MUTED }}>
        {translate("performance.loading")}
      </div>
    );
  }
  if (error) {
    return <div className="p-6 text-sm font-bold text-red-600">{(error as Error).message}</div>;
  }

  const trend = data?.trend;

  return (
    <div className="w-full space-y-6 pb-12">
      <header>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
          {translate("performance.eyebrow")}
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>
          {translate("performance.title")}
        </h1>
        <p className="mt-2 text-sm font-medium" style={{ color: MUTED }}>
          {translate("performance.subtitle")}
        </p>
      </header>

      <section
        className="overflow-hidden rounded-2xl border bg-cc-surface shadow-sm"
        style={{ borderColor: BORDER }}
      >
        <div className="grid sm:grid-cols-[1fr_auto]">
          <div className="p-6">
            <p className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>
              {translate("performance.complianceAvg")}
            </p>
            <p className="mt-2 text-5xl font-black tracking-tight" style={{ color: TEXT }}>
              {data?.average_score_30d ?? "—"}
              {data?.average_score_30d != null && (
                <span className="text-2xl font-black" style={{ color: MUTED }}>%</span>
              )}
            </p>
            <p className="mt-3 max-w-md text-sm font-medium leading-relaxed" style={{ color: TEXT }}>
              {trend?.sentence}
            </p>
            <p className="mt-1 text-xs font-bold" style={{ color: MUTED }} title={trend?.tooltip}>
              {trend?.tooltip}
            </p>
          </div>
          <div
            className="flex flex-col items-center justify-center gap-2 border-t px-8 py-6 sm:border-l sm:border-t-0"
            style={{ borderColor: BORDER, background: "#FAFAFE" }}
          >
            <TrendIcon direction={trend?.direction ?? "stable"} />
            <span className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>
              {translate("performance.vsPriorMonth")}
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-2xl border bg-cc-surface p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <div className="flex items-center gap-2">
            <TrendingUp size={18} style={{ color: "#059669" }} />
            <h2 className="text-sm font-black" style={{ color: TEXT }}>{translate("performance.strengths")}</h2>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {(data?.strengths ?? []).length ? (
              data?.strengths.map((s) => (
                <span
                  key={s.label}
                  className="rounded-full px-3 py-1.5 text-xs font-black"
                  style={{ background: "var(--cc-status-success-bg)", color: "#059669" }}
                >
                  {s.label}
                </span>
              ))
            ) : (
              <p className="text-sm font-medium" style={{ color: MUTED }}>
                {translate("performance.strengthsHint")}
              </p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-cc-surface p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <div className="flex items-center gap-2">
            <TrendingUp size={18} style={{ color: "#D97706" }} />
            <h2 className="text-sm font-black" style={{ color: TEXT }}>{translate("performance.focusAreas")}</h2>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {(data?.focus_areas ?? []).length ? (
              data?.focus_areas.map((s) => (
                <span
                  key={s.label}
                  className="rounded-full px-3 py-1.5 text-xs font-black"
                  style={{ background: "var(--cc-status-warning-bg)", color: "#D97706" }}
                >
                  {s.label}
                </span>
              ))
            ) : (
              <p className="text-sm font-medium" style={{ color: MUTED }}>
                {translate("performance.noFocusAreas")}
              </p>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border bg-cc-surface p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="flex items-center gap-2">
          <Award size={18} style={{ color: PLUM }} />
          <h2 className="text-sm font-black" style={{ color: TEXT }}>{translate("performance.badges")}</h2>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(data?.badges ?? []).map((badge) => (
            <div
              key={badge.key}
              className="rounded-xl border p-4 transition"
              style={{
                borderColor: BORDER,
                opacity: badge.unlocked ? 1 : 0.55,
                background: badge.unlocked ? "#F8F6FE" : "var(--cc-surface)",
              }}
            >
              <p className="text-sm font-black" style={{ color: TEXT }}>{badge.title}</p>
              <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: MUTED }}>
                {badge.description}
              </p>
              {badge.unlocked && badge.unlocked_at && (
                <p className="mt-2 text-[10px] font-black uppercase" style={{ color: "#059669" }}>
                  {translateParams("performance.unlocked", {
                    date: new Date(badge.unlocked_at).toLocaleDateString(),
                  })}
                </p>
              )}
            </div>
          ))}
        </div>
      </section>

      {data?.recommended_training && (
        <Link href="/worker/training">
          <section
            className="block rounded-2xl border p-5 shadow-sm transition hover:shadow-md"
            style={{ borderColor: BORDER, background: "linear-gradient(135deg, var(--cc-bg) 0%, var(--cc-surface) 100%)" }}
          >
            <div className="flex items-start gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{ background: "var(--cc-active)" }}
              >
                <GraduationCap size={22} style={{ color: PLUM }} />
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>
                  {translate("performance.recommendedTraining")}
                </p>
                <p className="mt-1 text-base font-black" style={{ color: TEXT }}>
                  {translateParams("performance.recommendedFor", { title: data.recommended_training.title })}
                </p>
                <p className="mt-1 text-xs font-bold" style={{ color: PLUM }}>{translate("performance.viewTraining")}</p>
              </div>
            </div>
          </section>
        </Link>
      )}

      {/* <div className="flex flex-wrap gap-4 text-center text-xs font-bold">
        <Link href="/worker/shift-history" style={{ color: PLUM }}>{translate("performance.shiftHistory")}</Link>
        <Link href="/worker/training" style={{ color: PLUM }}>{translate("performance.trainingLink")}</Link>
      </div> */}
    </div>
  );
}
