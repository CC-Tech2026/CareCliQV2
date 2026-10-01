import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { getShiftVerificationQueue } from "@/services/coordinatorService";
import { ShiftVerificationCard } from "@/components/coordinator/ShiftVerificationPanel";
import { ScheduleStatusPill } from "@/components/coordinator/ScheduleLiveCard";
import { formatAppDate, formatAppTimeWithZone } from "@/lib/datetime";

export default function CoordinatorVerificationPage() {
  const { translate, translateParams } = useAccessibility();
  const initial = new URLSearchParams(useSearch()).get("shiftId");
  const [selectedId, setSelectedId] = useState(initial);
  const [search, setSearch] = useState("");
  const [verifiedId, setVerifiedId] = useState<string | null>(null);
  const query = useOrgQuery(["shift-verification-queue"], {
    queryFn: getShiftVerificationQueue,
  });
  const items = query.data ?? [];
  const filtered = items.filter((item) =>
    [item.worker_name, item.participant_name, item.shift_id]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const selected =
    items.find((item) => item.shift_id === selectedId) ??
    (!selectedId ? filtered[0] : undefined);
  return (
    <div className="space-y-5 pb-8">
      <nav className="text-sm text-cc-muted">
        <Link href="/coordinator/rostering">{translate("nav.schedule")}</Link>
        <span aria-hidden> / </span>
        {translate("schedule.verification")}
      </nav>
      <header>
        <h1 className="text-2xl font-bold text-cc-text">
          {translate("schedule.verification")}
        </h1>
        <p className="mt-2 text-sm text-cc-muted">
          {translate("schedule.verifyDescription")}
        </p>
      </header>
      {query.isLoading ? (
        <p role="status">{translate("common.loading")}</p>
      ) : query.isError ? (
        <div role="alert">
          <p>{translate("schedule.loadFailed")}</p>
          <button
            className="min-h-11 text-cc-plum"
            onClick={() => query.refetch()}
          >
            {translate("coordinator.live.refresh")}
          </button>
        </div>
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(240px,320px)_minmax(0,1fr)]">
          <aside className="self-start rounded-xl border border-cc-border bg-cc-surface p-3 lg:sticky lg:top-4">
            <label className="text-xs font-semibold">
              {translate("schedule.searchQueue")}
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="mt-2 mb-3 min-h-11 w-full rounded-lg border border-cc-border bg-cc-surface px-3 text-sm"
              />
            </label>
            <div className="max-h-[35vh] space-y-2 overflow-y-auto lg:max-h-[65vh]">
              {filtered.map((item) => (
                <button
                  key={item.shift_id}
                  type="button"
                  aria-pressed={selected?.shift_id === item.shift_id}
                  onClick={() => {
                    setSelectedId(item.shift_id);
                    setVerifiedId(null);
                  }}
                  className={
                    "block w-full rounded-lg border p-3 text-left " +
                    (selected?.shift_id === item.shift_id
                      ? "border-cc-plum bg-cc-soft"
                      : "border-transparent")
                  }
                >
                  <p className="text-sm font-semibold">{item.worker_name}</p>
                  <p className="mt-1 text-sm text-cc-plum">
                    {item.participant_name}
                  </p>
                  <p className="my-2 text-xs text-cc-muted">
                    {item.clocked_out_at
                      ? formatAppDate(item.clocked_out_at, item.timezone)
                      : item.shift_id}
                  </p>
                  <ScheduleStatusPill stage="review" />
                </button>
              ))}
              {!filtered.length && (
                <p className="p-3 text-sm text-cc-muted">
                  {translate("schedule.nothingToReview")}
                </p>
              )}
            </div>
          </aside>
          <section aria-live="polite" className="min-w-0">
            {verifiedId ? (
              <div className="rounded-xl border border-emerald-200 bg-cc-surface p-6">
                <ScheduleStatusPill stage="verified" />
                <p className="mt-3 text-sm">
                  {translate("schedule.readyToInvoice")}
                </p>
                <button
                  className="mt-4 min-h-11 text-sm font-semibold text-cc-plum"
                  onClick={() => {
                    setSelectedId(null);
                    setVerifiedId(null);
                  }}
                >
                  {translate("schedule.nextReview")}
                </button>
              </div>
            ) : selected ? (
              <div className="space-y-4">
                <div className="rounded-xl border border-cc-border bg-cc-surface p-5 space-y-4">
                  <header className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <h2 className="text-base font-bold">
                        {selected.worker_name}
                      </h2>
                      <p className="mt-1 text-sm text-cc-plum">
                        {selected.participant_name}
                      </p>
                    </div>
                    <ScheduleStatusPill stage="review" />
                  </header>
                  <dl className="grid grid-cols-2 gap-3 rounded-lg bg-cc-panel p-3 text-xs lg:grid-cols-4">
                    {[
                      ["start", selected.scheduled_start],
                      ["end", selected.scheduled_end],
                      ["clockIn", selected.clocked_in_at],
                      ["clockOut", selected.clocked_out_at],
                    ].map(([key, value]) => (
                      <div key={key}>
                        <dt className="text-cc-muted">
                          {translate("schedule." + key)}
                        </dt>
                        <dd className="mt-1 font-semibold">
                          {value
                            ? formatAppTimeWithZone(value, selected.timezone)
                            : translate("schedule.notRecorded")}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {!!selected.tasks?.length && (
                    <div>
                      <h3 className="mb-2 text-sm font-bold">
                        {translate("schedule.tasks")}
                      </h3>
                      <ul className="grid gap-2 sm:grid-cols-2">
                        {selected.tasks.map((task, index) => (
                          <li
                            key={task.id ?? index}
                            className="flex items-start gap-2 rounded-lg border border-cc-border p-3 text-sm"
                          >
                            <input
                              aria-label={
                                task.label ||
                                task.name ||
                                task.title ||
                                translate("schedule.tasks")
                              }
                              type="checkbox"
                              checked={!!task.completed}
                              readOnly
                              tabIndex={-1}
                              className="mt-1 accent-emerald-600"
                            />
                            <span>
                              {task.label ||
                                task.name ||
                                task.title ||
                                translate("schedule.notRecorded")}
                              {task.completed_at && (
                                <span className="mt-1 block text-xs text-cc-muted">
                                  {formatAppTimeWithZone(
                                    task.completed_at,
                                    selected.timezone,
                                  )}
                                </span>
                              )}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {selected.clock_in_location_verified && (
                    <p className="text-sm font-semibold text-emerald-700">
                      {translate("schedule.gpsVerified")}
                    </p>
                  )}
                  <h2 className="text-sm font-bold">
                    {translate("schedule.note")}
                  </h2>
                  {selected.original_language_input &&
                    selected.detected_language &&
                    !["en", "english"].includes(
                      selected.detected_language.toLowerCase(),
                    ) && (
                      <p className="text-xs text-purple-700">
                        {translateParams("schedule.translated", {
                          language: selected.detected_language,
                        })}
                      </p>
                    )}
                  <p className="whitespace-pre-wrap break-words rounded-lg border border-cc-border p-3 text-sm leading-6">
                    {selected.session_note || translate("schedule.notRecorded")}
                  </p>
                  {selected.original_language_input && (
                    <details className="text-sm text-cc-muted">
                      <summary className="min-h-11 cursor-pointer">
                        {translate("schedule.original")}
                      </summary>
                      <p className="whitespace-pre-wrap break-words">
                        {selected.original_language_input}
                      </p>
                    </details>
                  )}
                  <label className="block text-sm font-semibold">
                    {translate("schedule.quality")}{" "}
                    {selected.compliance_score == null
                      ? translate("schedule.notRecorded")
                      : `${Math.round(selected.compliance_score)}%`}
                    {selected.compliance_score != null && (
                      <progress
                        max={100}
                        value={Math.max(
                          0,
                          Math.min(100, selected.compliance_score),
                        )}
                        className="mt-2 h-2 w-full"
                        style={{
                          accentColor:
                            selected.compliance_score >= 80
                              ? "#15803d"
                              : selected.compliance_score >= 50
                                ? "#b45309"
                                : "#b91c1c",
                        }}
                      />
                    )}
                  </label>
                </div>
                <ShiftVerificationCard
                  key={selected.shift_id}
                  item={selected}
                  initiallyExpanded
                  onVerified={() => {
                    setVerifiedId(selected.shift_id);
                    void query.refetch();
                  }}
                />
              </div>
            ) : (
              <p className="rounded-xl border border-cc-border bg-cc-surface p-6 text-sm text-cc-muted">
                {translate(
                  selectedId
                    ? "schedule.notInQueue"
                    : "schedule.nothingToReview",
                )}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
