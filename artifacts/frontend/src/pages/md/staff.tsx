import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Users, UserCheck, AlertTriangle, ArrowLeft, TrendingDown, Star, Shield } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { HubLayout } from "@/components/layout/HubLayout";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT = "var(--cc-soft)";
const PLUM = "var(--cc-plum)";

interface StaffMember {
  id: string;
  full_name: string;
  email?: string;
  role?: string;
  compliance_score: number;
  sessions: number;
  participant_count: number;
  last_login?: string;
  joined_at?: string;
}

interface MDData {
  active_staff: number;
  support_workers: number;
  staff_retention_rate: number;
  staff_directory: StaffMember[];
}

type Filter = "all" | "at_risk" | "strong";

function StatusBadge({ score }: { score: number }) {
  if (score >= 90)
    return <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10px] font-black text-emerald-700 border border-emerald-200">Strong Performer</span>;
  if (score >= 85)
    return <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10px] font-black text-blue-700 border border-blue-200">On Track</span>;
  if (score >= 70)
    return <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-[10px] font-black text-amber-700 border border-amber-200">Needs Attention</span>;
  return <span className="rounded-full bg-red-50 px-2.5 py-0.5 text-[10px] font-black text-red-700 border border-red-200">Retention Risk</span>;
}

function ScoreBar({ score }: { score: number }) {
  const color = score >= 85 ? "#10B981" : score >= 70 ? "#F59E0B" : "#EF4444";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full" style={{ background: BORDER }}>
        <div className="h-1.5 rounded-full transition-all" style={{ width: `${Math.min(score, 100)}%`, background: color }} />
      </div>
      <span className="w-8 text-right text-[11px] font-black" style={{ color }}>{score > 0 ? `${score}%` : "—"}</span>
    </div>
  );
}

export default function MDStaffPage() {
  const [, navigate] = useLocation();
  const [data, setData] = useState<MDData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");

  useEffect(() => {
    let cancelled = false;
    apiFetch("/api/dashboard/managing-director")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setError(true); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const allStaff: StaffMember[] = data?.staff_directory ?? [];
  const atRiskCount = allStaff.filter((w) => w.compliance_score > 0 && w.compliance_score < 85).length;
  const strongCount = allStaff.filter((w) => w.compliance_score >= 90).length;

  const filtered = allStaff.filter((w) => {
    const matchesSearch = !search || w.full_name.toLowerCase().includes(search.toLowerCase());
    const matchesFilter =
      filter === "all" ||
      (filter === "at_risk" && w.compliance_score > 0 && w.compliance_score < 85) ||
      (filter === "strong" && w.compliance_score >= 90);
    return matchesSearch && matchesFilter;
  });

  return (
    <HubLayout>
      <div className="space-y-6 pb-10">
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate("/hub")}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11px] font-black transition-colors hover:bg-white"
            style={{ color: MUTED, background: SOFT }}
          >
            <ArrowLeft size={13} strokeWidth={2.5} /> Hub
          </button>
          <div>
            <h1 className="text-xl font-black" style={{ color: TEXT }}>Staff Management</h1>
            <p className="text-[12px] font-medium" style={{ color: MUTED }}>People overview, performance & retention</p>
          </div>
          <div className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: SOFT, color: "#10B981" }}>
            <UserCheck size={16} strokeWidth={2.5} />
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => <div key={i} className="h-20 animate-pulse rounded-2xl" style={{ background: SOFT }} />)}
          </div>
        ) : error || !data ? (
          <div className="rounded-2xl border p-8 text-center" style={{ borderColor: BORDER }}>
            <AlertTriangle size={28} className="mx-auto mb-3" style={{ color: "#F97316" }} />
            <p className="font-black" style={{ color: TEXT }}>Could not load staff data</p>
          </div>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              {[
                { label: "Active Staff", value: data.active_staff, icon: Users, color: PLUM },
                { label: "Retention Rate", value: `${data.staff_retention_rate}%`, icon: UserCheck, color: "#10B981" },
                { label: "Workers at Risk", value: atRiskCount, icon: TrendingDown, color: atRiskCount > 0 ? "#EF4444" : "#10B981" },
              ].map(({ label, value, icon: Icon, color }) => (
                <div key={label} className="rounded-xl border bg-white p-4 shadow-sm" style={{ borderColor: BORDER }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-black uppercase tracking-[0.14em]" style={{ color: MUTED }}>{label}</span>
                    <div className="flex h-7 w-7 items-center justify-center rounded-lg" style={{ background: SOFT, color }}>
                      <Icon size={13} strokeWidth={2.5} />
                    </div>
                  </div>
                  <p className="text-2xl font-black" style={{ color: TEXT }}>{value}</p>
                </div>
              ))}
            </div>

            {atRiskCount > 0 && (
              <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
                <AlertTriangle size={15} strokeWidth={2.5} className="mt-0.5 shrink-0 text-red-600" />
                <div>
                  <p className="text-[13px] font-black text-red-700">
                    {atRiskCount} worker{atRiskCount > 1 ? "s" : ""} below 85% compliance threshold
                  </p>
                  <p className="mt-0.5 text-[11px] font-medium text-red-600">
                    Schedule check-ins and review documentation support needs.
                  </p>
                </div>
              </div>
            )}

            <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-[14px] font-black" style={{ color: TEXT }}>
                  Staff Directory ({allStaff.length})
                </h2>
                <div className="flex flex-wrap items-center gap-2">
                  {(["all", "at_risk", "strong"] as Filter[]).map((f) => (
                    <button
                      key={f}
                      onClick={() => setFilter(f)}
                      className="rounded-lg px-3 py-1 text-[11px] font-black transition-colors"
                      style={{
                        background: filter === f ? PLUM : SOFT,
                        color: filter === f ? "#fff" : MUTED,
                      }}
                    >
                      {f === "all" ? `All (${allStaff.length})` : f === "at_risk" ? `At Risk (${atRiskCount})` : `Strong (${strongCount})`}
                    </button>
                  ))}
                </div>
              </div>

              <input
                type="text"
                placeholder="Search staff…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mb-4 w-full rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-1"
                style={{ borderColor: BORDER }}
              />

              {filtered.length === 0 ? (
                <div className="py-8 text-center">
                  <Users size={24} className="mx-auto mb-2" style={{ color: MUTED }} />
                  <p className="text-[13px] font-black" style={{ color: TEXT }}>No staff found</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {filtered.map((worker) => (
                    <div key={worker.id} className="rounded-xl border p-4" style={{ borderColor: BORDER }}>
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex items-center gap-3">
                          <div className="flex h-9 w-9 items-center justify-center rounded-full font-black text-[13px]" style={{ background: SOFT, color: PLUM }}>
                            {worker.full_name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase()}
                          </div>
                          <div>
                            <p className="text-[13px] font-black" style={{ color: TEXT }}>{worker.full_name}</p>
                            {worker.email && <p className="text-[11px] font-medium" style={{ color: MUTED }}>{worker.email}</p>}
                            {worker.role && (
                              <p className="text-[10px] font-medium capitalize" style={{ color: MUTED }}>
                                {worker.role.replace(/_/g, " ")}
                              </p>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {worker.compliance_score >= 90 && <Star size={12} strokeWidth={2.5} className="text-amber-500" />}
                          {worker.compliance_score > 0 && worker.compliance_score < 85 && <Shield size={12} strokeWidth={2.5} className="text-red-500" />}
                          <StatusBadge score={worker.compliance_score} />
                        </div>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-3">
                        <div>
                          <p className="mb-1 text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>Compliance</p>
                          <ScoreBar score={worker.compliance_score} />
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>Participants</p>
                          <p className="mt-0.5 text-[13px] font-black" style={{ color: TEXT }}>{worker.participant_count}</p>
                        </div>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.12em]" style={{ color: MUTED }}>Sessions recorded</p>
                          <p className="mt-0.5 text-[13px] font-black" style={{ color: TEXT }}>{worker.sessions}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-2xl border bg-white p-5 shadow-sm" style={{ borderColor: BORDER }}>
              <h2 className="mb-2 text-[14px] font-black" style={{ color: TEXT }}>Hire & Onboard Tracking</h2>
              <div className="rounded-xl p-4 text-center" style={{ background: SOFT }}>
                <Users size={24} className="mx-auto mb-2" style={{ color: MUTED }} />
                <p className="text-[13px] font-black" style={{ color: TEXT }}>No active onboarding pipelines</p>
                <p className="mt-1 text-[11px] font-medium" style={{ color: MUTED }}>
                  Hire tracking will be available once onboarding data is connected.
                </p>
              </div>
            </section>
          </>
        )}
      </div>
    </HubLayout>
  );
}
