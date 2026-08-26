import { useLocation } from "wouter";
import { GraduationCap, ChevronRight } from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { SectionInfo } from "@/components/ui/section-info";

const TEXT   = "var(--cc-text)";
const MUTED  = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SOFT   = "var(--cc-soft)";
const PLUM   = "var(--cc-plum)";
const SURFACE = "var(--cc-surface)";

// Staff onboarding itself now lives at /md/staff-onboarding (Applicants,
// Hires, and Credentials/Training/Active oversight in one page). This hub
// is left with just Training Programs — participant onboarding is owned
// elsewhere and isn't linked from here.
const AREAS = [
  {
    href: "/md/onboarding/training",
    icon: GraduationCap,
    title: "Training Programs",
    description: "Build onboarding training programs, manage resources, and approve stage completions.",
  },
] as const;

export default function MDOnboardingPage() {
  const { translate } = useAccessibility();
  const [, navigate] = useLocation();

  return (
    <HubLayout>
      <div className="space-y-6 pb-10">
        <div className="flex items-center gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-black" style={{ color: TEXT }}>
              {translate("md.onboarding.title")}
              <SectionInfo text="Training programs for new starters, and the resources and approvals that go with them." />
            </h1>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {AREAS.map((area) => {
            const Icon = area.icon;
            return (
              <button
                key={area.href}
                onClick={() => navigate(area.href)}
                className="text-left rounded-2xl border p-5 shadow-sm transition-colors hover:bg-black/[0.02]"
                style={{ background: SURFACE, borderColor: BORDER }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex h-11 w-11 items-center justify-center rounded-xl shrink-0" style={{ background: SOFT, color: PLUM }}>
                    <Icon size={20} strokeWidth={2} />
                  </div>
                  <ChevronRight size={16} className="mt-2 shrink-0" style={{ color: MUTED }} />
                </div>
                <h2 className="mt-4 text-[15px] font-black" style={{ color: TEXT }}>{area.title}</h2>
                <p className="mt-1 text-[12px] font-medium leading-relaxed" style={{ color: MUTED }}>{area.description}</p>
              </button>
            );
          })}
        </div>
      </div>
    </HubLayout>
  );
}
