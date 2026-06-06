import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { ArrowRight, UserRound, LayoutDashboard, Crown, Loader2 } from "lucide-react";

const PLUM = "#5533CC";
const TEXT = "#1E1640";
const MUTED = "#7A6A9E";
const SOFT = "#F5F3FC";
const BORDER = "#E2DEF2";

interface WorkspaceCard {
  roleKey: string;
  title: string;
  description: string;
  href: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  gradient: string;
  comingSoon?: boolean;
}

const WORKSPACES: WorkspaceCard[] = [
  {
    roleKey: "support_worker",
    title: "Support Worker",
    description: "Client visits, shift notes, daily documentation, and compliance tracking.",
    href: "/my-clients",
    icon: UserRound,
    gradient: "linear-gradient(135deg, #5533CC 0%, #7B4FE0 100%)",
  },
  {
    roleKey: "support_coordinator",
    title: "Support Coordinator",
    description: "Team oversight, NDIS plans, participant management, and billing.",
    href: "/dashboard",
    icon: LayoutDashboard,
    gradient: "linear-gradient(135deg, #F03060 0%, #FF6B95 100%)",
  },
  {
    roleKey: "managing_director",
    title: "Managing Director",
    description: "Executive overview, organisation analytics, and strategic reporting.",
    href: "/compliance",
    icon: Crown,
    gradient: "linear-gradient(135deg, #F59E0B 0%, #FCD34D 100%)",
    comingSoon: true,
  },
];

export function WorkspaceLauncher() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [launching, setLaunching] = useState(false);

  const role = user?.role ?? "";

  const myWorkspace = WORKSPACES.find((ws) => ws.roleKey === role);

  function handleLaunch(href: string) {
    if (launching) return;
    setLaunching(true);
    setTimeout(() => {
      navigate(href);
    }, 1400);
  }

  if (!myWorkspace) return null;

  const Icon = myWorkspace.icon;

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-black" style={{ color: TEXT }}>
          Your Workspace
        </h2>
      </div>

      {/* Launching overlay */}
      {launching && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-5"
          style={{ background: "rgba(21, 14, 60, 0.82)", backdropFilter: "blur(8px)" }}
        >
          <div
            className="flex h-20 w-20 items-center justify-center rounded-2xl shadow-2xl text-white"
            style={{ background: myWorkspace.gradient }}
          >
            <Icon size={36} strokeWidth={2} />
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="flex items-center gap-2.5">
              <Loader2 size={18} className="animate-spin text-white/80" />
              <span className="text-[17px] font-black text-white tracking-tight">
                Launching workspace…
              </span>
            </div>
            <span className="text-[13px] font-medium text-white/50">
              {myWorkspace.title}
            </span>
          </div>
        </div>
      )}

      {/* Single card */}
      <div className="max-w-sm">
        {myWorkspace.comingSoon ? (
          <div
            className="relative flex flex-col overflow-hidden rounded-2xl border p-6 opacity-70 cursor-default"
            style={{ borderColor: BORDER, background: "#FFFFFF" }}
          >
            <WorkspaceCardBody ws={myWorkspace} Icon={Icon} launching={false} comingSoon />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => handleLaunch(myWorkspace.href)}
            disabled={launching}
            className="group relative flex w-full flex-col overflow-hidden rounded-2xl border p-6 text-left transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2"
            style={{ borderColor: BORDER, background: "#FFFFFF" }}
          >
            <WorkspaceCardBody ws={myWorkspace} Icon={Icon} launching={launching} />
          </button>
        )}
      </div>
    </section>
  );
}

function WorkspaceCardBody({
  ws,
  Icon,
  launching,
  comingSoon,
}: {
  ws: WorkspaceCard;
  Icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  launching: boolean;
  comingSoon?: boolean;
}) {
  return (
    <>
      {/* Green active dot */}
      {!comingSoon && (
        <div
          className="absolute right-4 top-4 h-2.5 w-2.5 rounded-full"
          style={{ background: "#10B981" }}
          title="Your active workspace"
        />
      )}

      {/* Icon */}
      <div
        className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl text-white shadow-md"
        style={{ background: ws.gradient }}
      >
        <Icon size={26} strokeWidth={2.5} />
      </div>

      <h3 className="text-[17px] font-black leading-snug" style={{ color: TEXT }}>
        {ws.title}
      </h3>
      <p className="mt-2 text-[13px] font-medium leading-relaxed flex-1" style={{ color: MUTED }}>
        {ws.description}
      </p>

      {/* CTA */}
      <div className="mt-5">
        {comingSoon ? (
          <div
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-black"
            style={{ background: SOFT, color: MUTED }}
          >
            Coming Soon
          </div>
        ) : (
          <div
            className="inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-[13px] font-black text-white shadow-sm transition-all group-hover:gap-3"
            style={{ background: launching ? MUTED : PLUM }}
          >
            {launching ? "Launching…" : "Launch"}
            <ArrowRight size={14} strokeWidth={2.5} />
          </div>
        )}
      </div>
    </>
  );
}
