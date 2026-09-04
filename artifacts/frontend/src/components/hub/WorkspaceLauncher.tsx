import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  ArrowRight,
  BarChart2,
  UserCheck,
  ShieldCheck,
  DollarSign,
  GraduationCap,
  Briefcase,
  Loader2,
} from "lucide-react";

const PLUM = "var(--cc-plum)";
const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

const AMBER = "#F59E0B";
const GREEN = "#10B981";
const SKY = "#0EA5E9";
const CORAL = "var(--cc-coral)";

interface WorkspaceDef {
  titleKey: string;
  shortKey: string;
  subtitleKey: string;
  href: string;
  icon: React.ComponentType<{
    size?: number;
    strokeWidth?: number;
  }>;
  allowedRoles: string[];
  accentColor: string;
}

const WORKSPACES: WorkspaceDef[] = [
  {
    titleKey: "hub.workspace.worker.title",
    shortKey: "hub.workspace.worker.short",
    subtitleKey: "hub.workspace.worker.subtitle",
    href: "/dashboard",
    icon: BarChart2,
    allowedRoles: ["support_worker"],
    accentColor: PLUM,
  },
  {
    titleKey: "hub.workspace.coordinator.title",
    shortKey: "hub.workspace.coordinator.short",
    subtitleKey: "hub.workspace.coordinator.subtitle",
    href: "/dashboard",
    icon: BarChart2,
    allowedRoles: ["support_coordinator"],
    accentColor: CORAL,
  },
];

const MD_WORKSPACES: WorkspaceDef[] = [
  {
    titleKey: "hub.workspace.executive.title",
    shortKey: "hub.workspace.executive.short",
    subtitleKey: "hub.workspace.executive.subtitle",
    href: "/md/executive",
    icon: BarChart2,
    allowedRoles: ["managing_director"],
    accentColor: AMBER,
  },
  {
    titleKey: "hub.workspace.staff.title",
    shortKey: "hub.workspace.staff.short",
    subtitleKey: "hub.workspace.staff.subtitle",
    href: "/md/staff",
    icon: UserCheck,
    allowedRoles: ["managing_director"],
    accentColor: GREEN,
  },
  {
    titleKey: "hub.workspace.compliance.title",
    shortKey: "hub.workspace.compliance.short",
    subtitleKey: "hub.workspace.compliance.subtitle",
    href: "/md/compliance",
    icon: ShieldCheck,
    allowedRoles: ["managing_director"],
    accentColor: PLUM,
  },
  {
    titleKey: "hub.workspace.financial.title",
    shortKey: "hub.workspace.financial.short",
    subtitleKey: "hub.workspace.financial.subtitle",
    href: "/md/financial",
    icon: DollarSign,
    allowedRoles: ["managing_director"],
    accentColor: SKY,
  },
  {
    titleKey: "hub.workspace.onboarding.title",
    shortKey: "hub.workspace.onboarding.short",
    subtitleKey: "hub.workspace.onboarding.subtitle",
    href: "/md/onboarding",
    icon: GraduationCap,
    allowedRoles: ["managing_director"],
    accentColor: CORAL,
  },
  {
    titleKey: "hub.workspace.workerPipeline.title",
    shortKey: "hub.workspace.workerPipeline.short",
    subtitleKey: "hub.workspace.workerPipeline.subtitle",
    href: "/md/staff-onboarding",
    icon: Briefcase,
    allowedRoles: ["managing_director"],
    accentColor: GREEN,
  },
];

export function WorkspaceLauncher() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [launching, setLaunching] = useState<WorkspaceDef | null>(null);

  const role = user?.role ?? "";

  if (role === "managing_director") {
    return (
      <MDWorkspaceLauncher
        navigate={navigate}
        launching={launching}
        setLaunching={setLaunching}
      />
    );
  }

  const workspace = WORKSPACES.find((item) =>
    item.allowedRoles.includes(role),
  );

  if (!workspace) return null;

  return (
    <WorkspaceRail
      workspaces={[workspace]}
      launching={launching}
      setLaunching={setLaunching}
      navigate={navigate}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* MD workspace rail                                                         */
/* -------------------------------------------------------------------------- */

function MDWorkspaceLauncher({
  navigate,
  launching,
  setLaunching,
}: {
  navigate: (path: string) => void;
  launching: WorkspaceDef | null;
  setLaunching: (ws: WorkspaceDef | null) => void;
}) {
  return (
    <WorkspaceRail
      workspaces={MD_WORKSPACES}
      launching={launching}
      setLaunching={setLaunching}
      navigate={navigate}
      managingDirector
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Workspace rail                                                             */
/* -------------------------------------------------------------------------- */

function WorkspaceRail({
  workspaces,
  launching,
  setLaunching,
  navigate,
  managingDirector = false,
}: {
  workspaces: WorkspaceDef[];
  launching: WorkspaceDef | null;
  setLaunching: (ws: WorkspaceDef | null) => void;
  navigate: (path: string) => void;
  managingDirector?: boolean;
}) {
  const { translate } = useAccessibility();

  function handleLaunch(workspace: WorkspaceDef) {
    if (launching) return;

    setLaunching(workspace);

    window.setTimeout(() => {
      navigate(workspace.href);
    }, 450);
  }

  return (
    <>
      {launching && <LaunchOverlay ws={launching} />}

      <aside
        className="h-full min-h-[620px] border-r bg-white"
        style={{ borderColor: BORDER }}
      >
        <div className="px-7 pb-5 pt-8">
          <p
            className="text-[11px] font-black uppercase tracking-[0.2em]"
            style={{ color: PLUM }}
          >
            {managingDirector
              ? translate("hub.workspace.mdTitle")
              : translate("hub.workspace.title")}
          </p>

          <p
            className="mt-2 text-[12px] leading-relaxed"
            style={{ color: MUTED }}
          >
            {managingDirector
              ? "Organisation workspaces"
              : "Your workspace"}
          </p>
        </div>

        <nav className="px-5 pb-6">
          {workspaces.map((workspace) => {
            const Icon = workspace.icon;
            const isLaunching = launching?.href === workspace.href;

            return (
              <button
                key={workspace.href}
                type="button"
                onClick={() => handleLaunch(workspace)}
                disabled={!!launching}
                className="group flex w-full items-center gap-4 rounded-xl px-2.5 py-3.5 text-left transition-colors hover:bg-cc-soft disabled:pointer-events-none"
              >
                {/* Icon */}
                <div
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
                  style={{
                    background: `${workspace.accentColor}14`,
                    color: workspace.accentColor,
                  }}
                >
                  {isLaunching ? (
                    <Loader2
                      size={18}
                      strokeWidth={2}
                      className="animate-spin"
                    />
                  ) : (
                    <Icon size={18} strokeWidth={1.9} />
                  )}
                </div>

                {/* Text */}
                <div className="min-w-0 flex-1">
                  <p
                    className="text-[14px] font-black leading-snug"
                    style={{ color: TEXT }}
                  >
                    {translate(workspace.shortKey)}
                  </p>

                  <p
                    className="mt-1 text-[11px] leading-[1.4]"
                    style={{ color: MUTED }}
                  >
                    {translate(workspace.subtitleKey)}
                  </p>
                </div>

                {/* Arrow */}
                <ArrowRight
                  size={15}
                  strokeWidth={1.7}
                  className="shrink-0 transition-transform group-hover:translate-x-0.5"
                  style={{ color: "#B8B4B0" }}
                />
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Launch overlay                                                             */
/* -------------------------------------------------------------------------- */

function LaunchOverlay({ ws }: { ws: WorkspaceDef }) {
  const { translate } = useAccessibility();
  const Icon = ws.icon;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center"
      style={{
        background: "rgba(250,248,244,0.96)",
        backdropFilter: "blur(5px)",
      }}
    >
      <div className="flex flex-col items-center">
        <div
          className="flex h-14 w-14 items-center justify-center rounded-full"
          style={{
            background: `${ws.accentColor}14`,
            color: ws.accentColor,
          }}
        >
          <Icon size={23} strokeWidth={1.8} />
        </div>

        <p
          className="mt-4 text-[15px] font-black"
          style={{ color: TEXT }}
        >
          {translate(ws.titleKey)}
        </p>

        <div
          className="mt-2 flex items-center gap-2 text-[11px]"
          style={{ color: MUTED }}
        >
          <Loader2
            size={12}
            strokeWidth={2}
            className="animate-spin"
          />

          {translate("hub.workspace.opening")}
        </div>
      </div>
    </div>
  );
}