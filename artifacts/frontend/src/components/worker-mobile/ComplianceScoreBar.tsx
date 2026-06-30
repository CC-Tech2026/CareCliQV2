import { scoreColor } from "@/lib/worker-compliance-engine";
import { WM } from "@/lib/worker-mobile-tokens";

type Props = {
  score: number;
  label?: string;
  onViewReport?: () => void;
};

export function ComplianceScoreBar({ score, label, onViewReport }: Props) {
  const color = scoreColor(score);

  return (
    <div className="px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[12px] font-semibold" style={{ color: WM.text }}>
          {label ?? "Note quality"}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-bold" style={{ color }}>
            {score}
          </span>
          {onViewReport && (
            <button
              type="button"
              onClick={onViewReport}
              className="text-[11px] font-semibold underline-offset-2 hover:underline"
              style={{ color: WM.purple }}
            >
              Report
            </button>
          )}
        </div>
      </div>
      <div
        className="mt-1.5 h-2 overflow-hidden rounded-full"
        style={{ background: WM.border }}
      >
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${Math.min(100, Math.max(0, score))}%`, background: WM.pink }}
        />
      </div>
    </div>
  );
}
