import { CORAL, MUTED, PLUM, TEXT, greetingForHour } from "@/lib/shift-utils";

type Props = {
  firstName: string;
  dateLabel: string;
};

export function DashboardGreeting({ firstName, dateLabel }: Props) {
  return (
    <header className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-[10px] font-black uppercase tracking-[0.22em]" style={{ color: CORAL }}>
          Support Worker
        </p>
        <h1 className="mt-1 text-2xl font-black tracking-tight sm:text-3xl" style={{ color: TEXT }}>
          {greetingForHour()}, {firstName} 👋
        </h1>
        <p className="mt-0.5 text-sm font-semibold" style={{ color: MUTED }}>
          {dateLabel}
        </p>
      </div>
    </header>
  );
}
