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

const PLUM   = "var(--cc-plum)";
const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const SOFT   = "var(--cc-soft)";
const BORDER = "var(--cc-border)";
const CORAL  = "var(--cc-coral)";
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
    shortLabel: "My Workspace",
    subtitle: "Client visits, shift notes and compliance tracking.",
    href: "/my-clients",
    icon: UserRound,
    allowedRoles: ["support_worker"],
    accentColor: PLUM,
  },
  {
    title: "Support Coordinator Workspace",
    shortLabel: "My Workspace",
    subtitle: "Team oversight, NDIS plans and billing.",
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
    subtitle: "Design programs and track staff progress.",
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
    setTimeout(() => navigate(ws!.href), 1400);
  }

  return (
    <>
      {isLaunching && <LaunchOverlay ws={ws} />}
      <div className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
        <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: MUTED }}>
            Workspace
          </p>
        </div>
        <div className="p-3">
          <button
            onClick={handleLaunch}
            disabled={!!launching}
            className="w-full flex items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-[#F8F8FE] disabled:pointer-events-none"
          >
            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ background: SOFT, color: ws.accentColor }}
            >
              {isLaunching
                ? <Loader2 size={16} strokeWidth={2} className="animate-spin" />
                : <Icon size={16} strokeWidth={2} />
              }
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold leading-snug" style={{ color: TEXT }}>
                {ws.shortLabel}
              </p>
              <p className="mt-0.5 truncate text-[11px]" style={{ color: MUTED }}>
                {ws.subtitle}
              </p>
            </div>
            <ArrowRight size={14} strokeWidth={2} style={{ color: MUTED }} />
          </button>
        </div>
      </div>
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
    setTimeout(() => navigate(ws.href), 1400);
  }

  return (
    <>
      {launching && <LaunchOverlay ws={launching} />}
      <div className="rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
        <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
          <p className="text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: MUTED }}>
            MD Workspaces
          </p>
        </div>
        <div className="p-3 space-y-0.5">
          {MD_WORKSPACES.map((ws) => {
            const Icon        = ws.icon;
            const isLaunching = launching?.href === ws.href;
            return (
              <button
                key={ws.href}
                onClick={() => handleLaunch(ws)}
                disabled={!!launching}
                className="w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-[#F8F8FE] disabled:pointer-events-none"
              >
                <div
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                  style={{ background: SOFT, color: ws.accentColor }}
                >
                  {isLaunching
                    ? <Loader2 size={13} strokeWidth={2} className="animate-spin" style={{ color: ws.accentColor }} />
                    : <Icon size={13} strokeWidth={2} />
                  }
                </div>
                <span className="flex-1 text-[13px] font-bold text-left" style={{ color: TEXT }}>
                  {ws.shortLabel}
                </span>
                <ArrowRight size={12} strokeWidth={2} style={{ color: MUTED }} />
              </button>
            );
          })}
        </div>
      </div>
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
        <p className="text-[16px] font-bold" style={{ color: "var(--cc-text)" }}>
          {ws.title}
        </p>
        <p className="flex items-center gap-2 text-[12px]" style={{ color: "var(--cc-muted)" }}>
          <Loader2 size={12} strokeWidth={2} className="animate-spin" />
          Opening workspace…
        </p>
      </div>
    </div>
  );
}
