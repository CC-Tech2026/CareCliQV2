import { ArrowDown, ArrowUp, Award, GraduationCap, Minus, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { getPerformanceDashboard } from "@/services/workerPerformanceService";

const PLUM = "#5533CC";
const CORAL = "#F03060";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const BORDER = "#E2DEF2";

function TrendIcon({ direction }: { direction: string }) {
  if (direction === "up") return <ArrowUp size={28} className="text-emerald-600" />;
  if (direction === "down") return <ArrowDown size={28} className="text-red-600" />;
  return <Minus size={28} style={{ color: MUTED }} />;
}

export default function WorkerPerformanceDashboardPage() {
  const { data, isLoading, error } = useOrgQuery(["worker", "performance-dashboard"], {
    queryFn: getPerformanceDashboard,
    staleTime: 30_000,
  });

  if (isLoading) {
    return <div className="p-6 text-sm font-bold" style={{ color: MUTED }}>Loading dashboard…</div>;
  }
  if (error) {
    return <div className="p-6 text-sm font-bold text-red-600">{(error as Error).message}</div>;
  }

  const trend = data?.trend;

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <header>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Performance</p>
        <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>Your progress</h1>
        <p className="mt-2 text-sm font-medium" style={{ color: MUTED }}>
          Trends, strengths, and milestones from your recent work.
        </p>
      </header>

      <section
        className="overflow-hidden rounded-2xl border bg-white shadow-sm"
        style={{ borderColor: BORDER }}
      >
        <div className="grid sm:grid-cols-[1fr_auto]">
          <div className="p-6">
            <p className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>
              30-day compliance average
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
              vs prior month
            </span>
          </div>
        </div>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <div className="flex items-center gap-2">
            <TrendingUp size={18} style={{ color: "#059669" }} />
            <h2 className="text-sm font-black" style={{ color: TEXT }}>Recurring strengths</h2>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {(data?.strengths ?? []).length ? (
              data?.strengths.map((s) => (
                <span
                  key={s.label}
                  className="rounded-full px-3 py-1.5 text-xs font-black"
                  style={{ background: "#ECFDF5", color: "#059669" }}
                >
                  {s.label}
                </span>
              ))
            ) : (
              <p className="text-sm font-medium" style={{ color: MUTED }}>
                Strengths appear as coordinators tag your feedback.
              </p>
            )}
          </div>
        </section>

        <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
          <div className="flex items-center gap-2">
            <TrendingUp size={18} style={{ color: "#D97706" }} />
            <h2 className="text-sm font-black" style={{ color: TEXT }}>Focus areas</h2>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {(data?.focus_areas ?? []).length ? (
              data?.focus_areas.map((s) => (
                <span
                  key={s.label}
                  className="rounded-full px-3 py-1.5 text-xs font-black"
                  style={{ background: "#FFFBEB", color: "#D97706" }}
                >
                  {s.label}
                </span>
              ))
            ) : (
              <p className="text-sm font-medium" style={{ color: MUTED }}>
                No focus areas identified yet.
              </p>
            )}
          </div>
        </section>
      </div>

      <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
        <div className="flex items-center gap-2">
          <Award size={18} style={{ color: PLUM }} />
          <h2 className="text-sm font-black" style={{ color: TEXT }}>Achievement badges</h2>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(data?.badges ?? []).map((badge) => (
            <div
              key={badge.key}
              className="rounded-xl border p-4 transition"
              style={{
                borderColor: BORDER,
                opacity: badge.unlocked ? 1 : 0.55,
                background: badge.unlocked ? "#F8F6FE" : "#fff",
              }}
            >
              <p className="text-sm font-black" style={{ color: TEXT }}>{badge.title}</p>
              <p className="mt-1 text-xs font-medium leading-relaxed" style={{ color: MUTED }}>
                {badge.description}
              </p>
              {badge.unlocked && badge.unlocked_at && (
                <p className="mt-2 text-[10px] font-black uppercase" style={{ color: "#059669" }}>
                  Unlocked {new Date(badge.unlocked_at).toLocaleDateString()}
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
            style={{ borderColor: BORDER, background: "linear-gradient(135deg, #F8F6FE 0%, #fff 100%)" }}
          >
            <div className="flex items-start gap-3">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
                style={{ background: "#EDEAFF" }}
              >
                <GraduationCap size={22} style={{ color: PLUM }} />
              </div>
              <div>
                <p className="text-xs font-black uppercase tracking-wider" style={{ color: MUTED }}>
                  Recommended training
                </p>
                <p className="mt-1 text-base font-black" style={{ color: TEXT }}>
                  Your coordinator recommends: {data.recommended_training.title}
                </p>
                <p className="mt-1 text-xs font-bold" style={{ color: PLUM }}>View training →</p>
              </div>
            </div>
          </section>
        </Link>
      )}

      <div className="flex flex-wrap gap-4 text-center text-xs font-bold">
        <Link href="/worker/shift-history" style={{ color: PLUM }}>Shift history →</Link>
        <Link href="/worker/training" style={{ color: PLUM }}>Training & certifications →</Link>
      </div>
    </div>
  );
}
