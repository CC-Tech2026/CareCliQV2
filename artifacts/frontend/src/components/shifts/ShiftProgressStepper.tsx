import { Check, Pause } from "lucide-react";
import { cn } from "@/lib/utils";
import { MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import type { ShiftVisualState } from "@/services/shiftService";

const STEPS = ["Review", "Arrive", "Active", "End", "Submit"] as const;

function stepIndex(state: ShiftVisualState): number {
  if (state === "scheduled") return 0;
  if (state === "clocked_in") return 1;
  if (state === "session_active") return 2;
  if (state === "completed") return 4;
  return 0;
}

export function ShiftProgressStepper({ visualState }: { visualState: ShiftVisualState }) {
  const current = stepIndex(visualState);

  return (
    <section
      className="rounded-2xl border bg-white px-4 py-4 shadow-sm"
      style={{ borderColor: "#E2DEF2" }}
      data-tutorial="shift-progress"
    >
      <p className="mb-4 text-[10px] font-black uppercase tracking-[0.2em]" style={{ color: MUTED }}>
        Shift Progress
      </p>
      <div className="grid grid-cols-5">
        {STEPS.map((label, i) => {
          const done = i < current;
          const active = i === current;
          const connectorDone = i < current;

          return (
            <div key={label} className="flex flex-col items-center">
              <div className="relative flex h-8 w-full items-center justify-center">
                {i > 0 && (
                  <div
                    className="absolute left-0 right-1/2 top-1/2 h-0.5 -translate-y-1/2"
                    style={{ background: connectorDone ? PLUM : "#E2DEF2" }}
                  />
                )}
                <div
                  className={cn(
                    "relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-black",
                    done && "bg-emerald-500 text-white",
                    active && !done && "text-white",
                    !done && !active && "border-2 bg-white",
                  )}
                  style={{
                    background: active && !done ? PLUM : undefined,
                    borderColor: !done && !active ? "#E2DEF2" : undefined,
                    color: !done && !active ? MUTED : undefined,
                  }}
                >
                  {done ? <Check size={14} strokeWidth={3} /> : active ? <Pause size={12} /> : i + 1}
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className="absolute left-1/2 right-0 top-1/2 h-0.5 -translate-y-1/2"
                    style={{ background: done ? PLUM : "#E2DEF2" }}
                  />
                )}
              </div>
              <span
                className="mt-1.5 w-full px-0.5 text-center text-[10px] font-bold leading-tight"
                style={{ color: active ? PLUM : done ? TEXT : MUTED }}
              >
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
