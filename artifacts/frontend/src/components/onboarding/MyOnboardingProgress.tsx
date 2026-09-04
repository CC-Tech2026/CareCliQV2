import { AlertTriangle, Check, Mail, Phone, UserRound } from "lucide-react";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { getMyBuddy, getMyPipeline } from "@/services/inductionService";

const PLUM = "var(--cc-plum)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const GREEN = "#0F7B57";
const WARNING = "var(--cc-status-warning)";
const WARNING_BG = "var(--cc-status-warning-bg)";

export function MyOnboardingProgress() {
  const { data, isLoading } = useOrgQuery(["worker-my-pipeline"], { queryFn: getMyPipeline });
  const { data: buddy } = useOrgQuery(["worker-my-buddy"], { queryFn: getMyBuddy });

  if (isLoading || !data) {
    return <div className="h-24 animate-pulse rounded-xl" style={{ background: "var(--cc-soft)" }} />;
  }

  return (
    <div className="space-y-4">
      {data.deactivated && (
        <div className="flex items-start gap-3 rounded-xl border p-4" style={{ borderColor: WARNING, background: WARNING_BG }}>
          <AlertTriangle size={18} className="mt-0.5 shrink-0" style={{ color: WARNING }} />
          <div>
            <p className="text-sm font-black" style={{ color: "#1A1A2E" }}>Your onboarding has been paused</p>
            <p className="mt-0.5 text-xs leading-5" style={{ color: MUTED }}>
              This happens after too long without action on a step. Contact your coordinator to pick back up.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-start justify-between gap-1 overflow-x-auto pb-1">
        {data.stages.map((stage, i) => (
          <div key={stage.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex min-w-[64px] flex-col items-center gap-1.5 text-center">
              <div
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-black"
                style={{
                  background: stage.status === "complete" ? GREEN : stage.status === "current" ? PLUM : "var(--cc-soft)",
                  color: stage.status === "upcoming" ? MUTED : "#fff",
                }}
              >
                {stage.status === "complete" ? <Check size={15} /> : i + 1}
              </div>
              <span
                className="text-[10px] font-bold leading-tight"
                style={{ color: stage.status === "upcoming" ? MUTED : "#1A1A2E" }}
              >
                {stage.label}
              </span>
            </div>
            {i < data.stages.length - 1 && (
              <div
                className="mx-1 mt-[-18px] h-0.5 flex-1"
                style={{ background: stage.status === "complete" ? GREEN : BORDER }}
              />
            )}
          </div>
        ))}
      </div>

      {buddy?.full_name && (
        <div className="flex items-center gap-3 rounded-xl border p-4" style={{ borderColor: BORDER }}>
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full" style={{ background: "var(--cc-soft)" }}>
            <UserRound size={18} style={{ color: PLUM }} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: MUTED }}>Your buddy</p>
            <p className="text-sm font-black" style={{ color: "#1A1A2E" }}>{buddy.full_name}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {buddy.email && (
              <a href={`mailto:${buddy.email}`} className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "var(--cc-soft)", color: PLUM }}>
                <Mail size={14} />
              </a>
            )}
            {buddy.phone && (
              <a href={`tel:${buddy.phone.replace(/\s/g, "")}`} className="flex h-8 w-8 items-center justify-center rounded-full" style={{ background: "var(--cc-soft)", color: PLUM }}>
                <Phone size={14} />
              </a>
            )}
          </div>
        </div>
      )}

      {data.outstanding_items.length > 0 && (
        <div className="rounded-xl border p-4" style={{ borderColor: BORDER }}>
          <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: MUTED }}>
            What&apos;s next
          </p>
          <ul className="mt-2 space-y-1.5">
            {data.outstanding_items.map((item) => (
              <li key={item} className="text-sm font-medium" style={{ color: "#1A1A2E" }}>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
