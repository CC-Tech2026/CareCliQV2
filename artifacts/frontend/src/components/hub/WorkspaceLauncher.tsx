import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import {
  ArrowRight,
  UserRound,
  LayoutDashboard,
  Loader2,
  BarChart2,
  UserCheck,
  ShieldCheck,
  DollarSign,
  GraduationCap,
} from "lucide-react";

const PLUM   = "#5533CC";
const TEXT   = "#1E1640";
const MUTED  = "#7A6A9E";
const SOFT   = "#F5F3FC";
const BORDER = "#E2DEF2";
const CORAL  = "#F03060";
const AMBER  = "#F59E0B";
const GREEN  = "#10B981";
const SKY    = "#0EA5E9";

interface WorkspaceDef {
  title: string;
  shortLabel: string;
  subtitle: string;
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  allowedRoles: string[];
  accentColor: string;
}

const WORKSPACES: WorkspaceDef[] = [
  {
    title: "Support Worker Workspace",
    shortLabel: "Support Worker",
    subtitle: "Client visits, shift notes, daily documentation and compliance tracking.",
    href: "/my-clients",
    icon: UserRound,
    allowedRoles: ["support_worker"],
    accentColor: PLUM,
  },
  {
    title: "Support Coordinator Workspace",
    shortLabel: "Coordinator",
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
    shortLabel: "Executive",
    subtitle: "KPIs, trend analysis and strategic overview.",
    href: "/md/executive",
    icon: BarChart2,
    allowedRoles: ["managing_director"],
    accentColor: AMBER,
  },
  {
    title: "Staff Management",
    shortLabel: "Staff",
    subtitle: "People performance and retention tracking.",
    href: "/md/staff",
    icon: UserCheck,
    allowedRoles: ["managing_director"],
    accentColor: GREEN,
  },
  {
    title: "Compliance Dashboard",
    shortLabel: "Compliance",
    subtitle: "Org-wide compliance scores and audit readiness.",
    href: "/md/compliance",
    icon: ShieldCheck,
    allowedRoles: ["managing_director"],
    accentColor: PLUM,
  },
  {
    title: "Financial Overview",
    shortLabel: "Financial",
    subtitle: "Revenue, margins and billing performance.",
    href: "/md/financial",
    icon: DollarSign,
    allowedRoles: ["managing_director"],
    accentColor: SKY,
  },
  {
    title: "Onboarding Centre",
    shortLabel: "Onboarding",
    subtitle: "Design programs, track progress and approve completions.",
    href: "/md/onboarding",
    icon: GraduationCap,
    allowedRoles: ["managing_director"],
    accentColor: CORAL,
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

  const Icon        = ws.icon;
  const isLaunching = launching?.href === ws.href;

  function handleLaunch(e: React.MouseEvent) {
    e.preventDefault();
    if (launching) return;
    setLaunching(ws!);
    setTimeout(() => navigate(ws!.href), 1600);
  }

  return (
    <>
      {isLaunching && <LaunchOverlay ws={ws} />}

      <section>
        <SectionLabel>Your Workspace</SectionLabel>

        <button
          onClick={handleLaunch}
          disabled={!!launching}
          className="group w-full flex items-center gap-5 rounded-xl border bg-white px-6 py-4 text-left transition-all duration-150 hover:shadow-md hover:-translate-y-px disabled:pointer-events-none"
          style={{ borderColor: BORDER, borderLeft: `3px solid ${ws.accentColor}` }}
        >
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
            style={{ background: SOFT, color: ws.accentColor }}
          >
            <Icon size={20} strokeWidth={2} />
          </div>

          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-bold leading-snug" style={{ color: TEXT }}>
              {ws.title}
            </p>
            <p className="mt-0.5 truncate text-[12px]" style={{ color: MUTED }}>
              {ws.subtitle}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2 text-[12px] font-bold" style={{ color: ws.accentColor }}>
            {isLaunching
              ? <><Loader2 size={14} strokeWidth={2} className="animate-spin" /> Launching</>
              : <>Open <ArrowRight size={14} strokeWidth={2} /></>
            }
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
    setTimeout(() => navigate(ws.href), 1600);
  }

  return (
    <>
      {launching && <LaunchOverlay ws={launching} />}

      <section>
        <SectionLabel>MD Workspaces</SectionLabel>

        <nav
          className="flex items-stretch rounded-xl border bg-white overflow-hidden"
          style={{ borderColor: BORDER }}
        >
          {MD_WORKSPACES.map((ws, idx) => {
            const Icon        = ws.icon;
            const isLaunching = launching?.href === ws.href;

            return (
              <button
                key={ws.href}
                onClick={() => handleLaunch(ws)}
                disabled={!!launching}
                className="group flex flex-1 flex-col items-center gap-2 px-3 py-3.5 text-center transition-colors duration-150 hover:bg-[#F5F3FC] disabled:pointer-events-none"
                style={{
                  borderLeft: idx > 0 ? `1px solid ${BORDER}` : undefined,
                  borderTop: `3px solid ${ws.accentColor}`,
                }}
              >
                <div
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ background: SOFT, color: ws.accentColor }}
                >
                  {isLaunching
                    ? <Loader2 size={14} strokeWidth={2} className="animate-spin" style={{ color: ws.accentColor }} />
                    : <Icon size={14} strokeWidth={2} />
                  }
                </div>
                <span className="text-[11px] font-bold leading-tight" style={{ color: TEXT }}>
                  {ws.shortLabel}
                </span>
              </button>
            );
          })}
        </nav>
      </section>
    </>
  );
}

function LaunchOverlay({ ws }: { ws: WorkspaceDef }) {
  const Icon = ws.icon;
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6"
      style={{ background: "rgba(245,243,252,0.97)", backdropFilter: "blur(8px)" }}
    >
      <div className="relative flex items-center justify-center">
        <span
          className="absolute h-20 w-20 animate-ping rounded-full opacity-10"
          style={{ background: ws.accentColor }}
        />
        <div
          className="relative flex h-16 w-16 items-center justify-center rounded-2xl shadow-lg"
          style={{ background: ws.accentColor }}
        >
          <Icon size={28} strokeWidth={2} color="#fff" />
        </div>
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <p className="text-[16px] font-bold" style={{ color: "#1E1640" }}>
          {ws.title}
        </p>
        <p className="flex items-center gap-2 text-[12px]" style={{ color: "#7A6A9E" }}>
          <Loader2 size={12} strokeWidth={2} className="animate-spin" />
          Opening workspace…
        </p>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-3 text-[10px] font-black uppercase tracking-[0.22em]"
      style={{ color: MUTED }}
    >
      {children}
    </p>
  );
}
