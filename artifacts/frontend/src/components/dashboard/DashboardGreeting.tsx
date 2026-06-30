import { useAccessibility } from "@/contexts/AccessibilityContext";
import { CORAL, MUTED, TEXT, greetingForHour } from "@/lib/shift-utils";

type Props = {
  firstName: string;
  dateLabel: string;
};

export function DashboardGreeting({ firstName, dateLabel }: Props) {
  const { translate } = useAccessibility();

  return (
    <header className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="hidden" style={{ color: CORAL }}>
          {translate("common.supportWorker")}
        </p>
        <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl" style={{ color: TEXT }}>
          {greetingForHour(translate)}, {firstName} 👋
        </h1>
        <p className="mt-0.5 text-sm font-semibold" style={{ color: MUTED }}>
          {dateLabel}
        </p>
      </div>
    </header>
  );
}
