import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  ArrowRight, UserRound, LayoutDashboard, Crown, Loader2,
  BarChart2, UserCheck, ShieldCheck, DollarSign, GraduationCap,
} from "lucide-react";

const PLUM   = "#5533CC";
const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const SOFT   = "#F5F3FC";
const BORDER = "#E2DEF2";
const CORAL  = "#F03060";
const AMBER  = "#F59E0B";

interface WorkspaceDef {
  title: string;
  subtitle: string;
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  allowedRoles: string[];
  accentColor: string;
}

const WORKSPACES: WorkspaceDef[] = [
  {
    title: "Support Worker Workspace",
    subtitle: "Client visits, shift notes, daily documentation and compliance tracking.",
    href: "/my-clients",
    icon: UserRound,
    allowedRoles: ["support_worker"],
    accentColor: PLUM,
  },
  {
    title: "Support Coordinator Workspace",
    subtitle: "Team oversight, NDIS plans, participant management and billing.",
    href: "/dashboard",
    icon: LayoutDashboard,
    allowedRoles: ["support_coordinator"],
    accentColor: CORAL,
  },
];

const MD_WORKSPACES: WorkspaceDef[] = [
  {
    title: "Executive Dashboard",
    subtitle: "KPIs, trend analysis and strategic overview.",
    href: "/md/executive",
    icon: BarChart2,
    allowedRoles: ["managing_director"],
    accentColor: AMBER,
  },
  {
    title: "Staff Management",
    subtitle: "People performance and retention tracking.",
    href: "/md/staff",
    icon: UserCheck,
    allowedRoles: ["managing_director"],
    accentColor: "#10B981",
  },
  {
    title: "Compliance Dashboard",
    subtitle: "Org-wide compliance scores and audit readiness.",
    href: "/md/compliance",
    icon: ShieldCheck,
    allowedRoles: ["managing_director"],
    accentColor: PLUM,
  },
  {
    title: "Financial Overview",
    subtitle: "Revenue, margins and billing performance.",
    href: "/md/financial",
    icon: DollarSign,
    allowedRoles: ["managing_director"],
    accentColor: "#0EA5E9",
  },
  {
    title: "Onboarding Centre",
    subtitle: "Design programs, track progress and approve completions.",
    href: "/md/onboarding",
    icon: GraduationCap,
    allowedRoles: ["managing_director"],
    accentColor: PLUM,
  },
];

export function WorkspaceLauncher() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [launching, setLaunching] = useState<WorkspaceDef | null>(null);

  const role = user?.role ?? "";

  if (role === "managing_director") {
    return <MDWorkspaceLauncher navigate={navigate} launching={launching} setLaunching={setLaunching} />;
  }

  const ws = WORKSPACES.find((w) => w.allowedRoles.includes(role));
  if (!ws) return null;

  const Icon = ws.icon;
  const isLaunching = launching?.href === ws.href;

  function handleLaunch(e: React.MouseEvent) {
    e.preventDefault();
    if (launching) return;
    setLaunching(ws!);
    setTimeout(() => navigate(ws!.href), 1800);
  }

  return (
    <>
      {isLaunching && <LaunchOverlay ws={ws} />}

      <section>
        <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>
          Your Workspace
        </p>

        <button
          onClick={handleLaunch}
          disabled={!!launching}
          className="group w-full flex items-center gap-4 rounded-xl border bg-white px-5 py-4 text-left transition-all duration-150 hover:shadow-md hover:-translate-y-px disabled:pointer-events-none"
          style={{ borderColor: BORDER }}
        >
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg" style={{ background: SOFT, color: ws.accentColor }}>
            <Icon size={20} strokeWidth={2.5} />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-black leading-snug" style={{ color: TEXT }}>{ws.title}</p>
            <p className="mt-0.5 truncate text-[12px] font-medium" style={{ color: MUTED }}>{ws.subtitle}</p>
          </div>

          <div
            className="flex shrink-0 items-center gap-2 rounded-lg px-4 py-2 text-[12px] font-black transition-all duration-150 group-hover:gap-3"
            style={{ background: ws.accentColor, color: "#fff" }}
          >
            {isLaunching ? <Loader2 size={13} strokeWidth={2.5} className="animate-spin" /> : <>Launch <ArrowRight size={13} strokeWidth={2.5} /></>}
          </div>
        </button>
      </section>
    </>
  );
}

function MDWorkspaceLauncher({
  navigate,
  launching,
  setLaunching,
}: {
  navigate: (path: string) => void;
  launching: WorkspaceDef | null;
  setLaunching: (ws: WorkspaceDef | null) => void;
}) {
  function handleLaunch(ws: WorkspaceDef) {
    if (launching) return;
    setLaunching(ws);
    setTimeout(() => navigate(ws.href), 1800);
  }

  return (
    <>
      {launching && <LaunchOverlay ws={launching} />}

      <section>
        <p className="mb-3 text-[11px] font-black uppercase tracking-[0.18em]" style={{ color: MUTED }}>
          <Crown size={11} strokeWidth={2.5} className="inline mr-1.5" style={{ color: AMBER }} />
          MD Workspaces
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {MD_WORKSPACES.map((ws) => {
            const Icon = ws.icon;
            const isLaunching = launching?.href === ws.href;
            return (
              <button
                key={ws.href}
                onClick={() => handleLaunch(ws)}
                disabled={!!launching}
                className="group flex flex-col items-start gap-3 rounded-xl border bg-white p-4 text-left transition-all duration-150 hover:shadow-md hover:-translate-y-px disabled:pointer-events-none"
                style={{ borderColor: BORDER }}
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg" style={{ background: SOFT, color: ws.accentColor }}>
                  {isLaunching ? <Loader2 size={17} strokeWidth={2.5} className="animate-spin" /> : <Icon size={17} strokeWidth={2.5} />}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-black leading-snug" style={{ color: TEXT }}>{ws.title}</p>
                  <p className="mt-0.5 text-[11px] font-medium leading-snug" style={{ color: MUTED }}>{ws.subtitle}</p>
                </div>

                <div
                  className="flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-[11px] font-black transition-all duration-150"
                  style={{ background: ws.accentColor, color: "#fff" }}
                >
                  {isLaunching ? "Launching…" : "Launch"}
                  <ArrowRight size={11} strokeWidth={2.5} />
                </div>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}

function LaunchOverlay({ ws }: { ws: WorkspaceDef }) {
  const Icon = ws.icon;
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6"
      style={{ background: "rgba(245,243,252,0.96)", backdropFilter: "blur(6px)" }}
    >
      <div className="relative flex items-center justify-center">
        <span className="absolute h-24 w-24 animate-ping rounded-full opacity-20" style={{ background: ws.accentColor }} />
        <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl shadow-lg" style={{ background: ws.accentColor }}>
          <Icon size={32} strokeWidth={2.5} color="#fff" />
        </div>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Loader2 size={22} strokeWidth={2.5} className="animate-spin" style={{ color: ws.accentColor }} />
        <p className="text-[15px] font-black" style={{ color: TEXT }}>Launching {ws.title}</p>
        <p className="text-[12px] font-medium" style={{ color: MUTED }}>Setting up your workspace…</p>
      </div>
    </div>
  );
}
