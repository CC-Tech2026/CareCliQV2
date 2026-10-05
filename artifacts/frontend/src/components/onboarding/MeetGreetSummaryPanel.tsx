import { AlertTriangle, CheckCircle2, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import {
  getParticipantMeetGreetSummary,
  type MeetGreetSummary,
  type MeetGreetTopic,
} from "@/services/participantIntakeService";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";

const TOPIC_LABELS: Record<MeetGreetTopic, string> = {
  goals: "Goals",
  supports: "Support wanted",
  schedule: "Days and times",
  preferences: "Preferences",
  access_and_risk: "Health, access and risk",
  people: "People involved",
  other: "Also said",
};
const FREQUENCY_LABELS: Record<string, string> = {
  weekly: "weekly",
  fortnightly: "fortnightly",
  monthly: "monthly",
  as_scheduled: "as needed",
};
const LOCATION_LABELS: Record<string, string> = {
  home: "at home",
  school: "at school",
  preschool: "at preschool",
  clinic: "at a clinic",
  other: "in the community",
};

/** The lines a point came from, opened on request. */
function Said({ ids, summary }: { ids: string[]; summary: MeetGreetSummary }) {
  const lines = ids.map((id) => summary.sources.find((s) => s.id === id)).filter(Boolean) as MeetGreetSummary["sources"];
  if (!lines.length) return null;
  return (
    <details className="mt-0.5">
      <summary className="cursor-pointer text-[11px]" style={{ color: MUTED }}>
        What was said
      </summary>
      <ul className="mt-1 space-y-1 border-l-2 pl-2.5" style={{ borderColor: BORDER }}>
        {lines.map((line) => (
          <li key={line.id} className="text-[12px]" style={{ color: TEXT }}>
            <span className="font-semibold">{line.speaker}:</span> "{line.text}"
          </li>
        ))}
      </ul>
    </details>
  );
}

/** The Meet & Greet by topic, every point linked to what was said, the
 * supports asked for (which draft the service agreement), and anything said
 * that the summary doesn't cover, to include or dismiss. Read-only on the
 * participant's record. */
export function MeetGreetSummaryPanel({
  summary,
  editable = false,
  summarising = false,
  reviewingId = null,
  onSummarise,
  onReview,
}: {
  summary: MeetGreetSummary | null | undefined;
  editable?: boolean;
  summarising?: boolean;
  reviewingId?: string | null;
  onSummarise?: () => void;
  onReview?: (lineId: string, action: "include" | "dismiss") => void;
}) {
  const open = (summary?.uncovered ?? []).filter((u) => u.status === "open");
  const topics = (Object.keys(TOPIC_LABELS) as MeetGreetTopic[]).filter((t) => (summary?.topics[t] ?? []).length > 0);

  return (
    <section aria-label="Meet & Greet summary" className="space-y-3 rounded-2xl border bg-white p-5" style={{ borderColor: BORDER }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[14px] font-bold" style={{ color: TEXT }}>Meet &amp; Greet summary</h3>
          <p className="text-[12px]" style={{ color: MUTED }}>
            Only what was said. Every point shows where it came from.
          </p>
        </div>
        {editable && onSummarise && (
          <Button variant={summary ? "outline" : "navy"} className="gap-2 rounded-lg" onClick={onSummarise} disabled={summarising}>
            {summarising ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            {summary ? "Summarise again" : "Summarise conversation"}
          </Button>
        )}
      </div>

      {!summary ? (
        <p className="text-[13px]" style={{ color: MUTED }}>
          {editable
            ? "Once the conversation is recorded (or notes are written), summarise it here. The supports asked for will draft the service agreement."
            : "No summary was made for this Meet & Greet."}
        </p>
      ) : (
        <>
          {open.length > 0 ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-900 dark:text-amber-100">
                <AlertTriangle size={14} aria-hidden /> Said but not in the summary ({open.length})
              </p>
              <p className="mt-0.5 text-[12px] text-amber-900 dark:text-amber-100">
                Include each one, or dismiss it if it isn't about {editable ? "them" : "the participant"}, before moving on.
              </p>
              <ul className="mt-2 space-y-2">
                {open.map((line) => (
                  <li key={line.id} className="flex flex-wrap items-start justify-between gap-2 rounded-md bg-white p-2 dark:bg-transparent">
                    <span className="min-w-0 flex-1 text-[13px]" style={{ color: TEXT }}>
                      <span className="font-semibold">{line.speaker}:</span> "{line.text}"
                    </span>
                    {editable && onReview && (
                      <span className="flex shrink-0 gap-1.5">
                        <Button size="sm" variant="outline" disabled={reviewingId === line.id} onClick={() => onReview(line.id, "include")}>
                          Include
                        </Button>
                        <Button size="sm" variant="ghost" disabled={reviewingId === line.id} onClick={() => onReview(line.id, "dismiss")}>
                          Dismiss
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "var(--cc-status-success)" }}>
              <CheckCircle2 size={14} aria-hidden /> Everything said is covered.
            </p>
          )}

          {topics.map((topic) => (
            <div key={topic}>
              <h4 className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: MUTED }}>{TOPIC_LABELS[topic]}</h4>
              <ul className="mt-1 space-y-1.5">
                {(summary.topics[topic] ?? []).map((point, i) => (
                  <li key={i} className="text-[13px]" style={{ color: TEXT }}>
                    {point.text}
                    <Said ids={point.source_ids} summary={summary} />
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {summary.supports.length > 0 && (
            <div>
              <h4 className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: MUTED }}>
                Supports asked for, for the agreement
              </h4>
              <ul className="mt-1 space-y-2">
                {summary.supports.map((s, i) => {
                  const said = [
                    s.hours_per_week != null ? `${s.hours_per_week} hours a week` : null,
                    s.frequency ? FREQUENCY_LABELS[s.frequency] : null,
                    s.location ? LOCATION_LABELS[s.location] : null,
                  ].filter(Boolean);
                  const notSaid = [
                    s.hours_per_week == null ? "hours" : null,
                    s.frequency == null ? "how often" : null,
                    s.location == null ? "where" : null,
                  ].filter(Boolean);
                  return (
                    <li key={i} className="rounded-lg border p-2.5 text-[13px]" style={{ borderColor: BORDER, color: TEXT }}>
                      <p className="font-semibold">{s.description}</p>
                      <p className="text-[12px]" style={{ color: MUTED }}>
                        {[s.item_code ?? "NDIS item to choose", ...said].join(" · ")}
                        {notSaid.length > 0 ? ` · Not said: ${notSaid.join(", ")}` : ""}
                      </p>
                      <Said ids={s.source_ids} summary={summary} />
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {summary.dropped_points > 0 && (
            <p className="text-[11px]" style={{ color: MUTED }}>
              {summary.dropped_points} suggested point{summary.dropped_points === 1 ? " was" : "s were"} left out because{" "}
              {summary.dropped_points === 1 ? "it didn't" : "they didn't"} match anything said.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** On the participant's record: the summary from their onboarding, if they
 * came through it. Shows nothing otherwise. */
export function ParticipantMeetGreetSummary({ participantId }: { participantId: string }) {
  const { data } = useOrgQuery<MeetGreetSummary | null>(["participant", participantId, "meet-greet-summary"], {
    queryFn: () => getParticipantMeetGreetSummary(participantId),
    staleTime: 5 * 60_000,
  });
  if (!data) return null;
  return (
    <details className="rounded-xl border border-cc-border p-4">
      <summary className="cursor-pointer py-2 text-sm font-semibold text-cc-text">Meet &amp; Greet summary</summary>
      <div className="pt-2">
        <MeetGreetSummaryPanel summary={data} />
      </div>
    </details>
  );
}
