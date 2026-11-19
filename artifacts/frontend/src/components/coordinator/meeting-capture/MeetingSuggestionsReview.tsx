import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Download, Loader2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { downloadBlob } from "@/lib/download-file";
import {
  applyPlanMeetingSuggestions,
  type ExtractedGoal,
  type ExtractedGoalPayload,
  type ExtractedTask,
  type ExtractedTaskPayload,
} from "@/services/coordinatorService";
import { PRIMARY_BUTTON, SECONDARY_BUTTON, TEXTAREA } from "@/components/participants/recordUi";
import { MeetingTranscript } from "./MeetingTranscript";
import { firstName, goalAreaLabel, matchLabel } from "./meetingMeta";

type CleanSegment = { segment_id?: string; speaker_name?: string; text: string; start?: string };
type RawSegment = { segment_id?: string; speaker_label?: string; text: string; start?: string };

type Item = {
  id: string;
  kind: "goal" | "task";
  text: string;
  /** Goals: the goal area. Tasks: mandatory or optional. */
  detail: string;
  sourceIds: string[];
  confidence: number;
  /** Tasks only: the goal suggestion it belongs to. */
  goalId: string | null;
  selected: boolean;
  removed: boolean;
};

function toItems(goals: ExtractedGoal[], tasks: ExtractedTask[]): Item[] {
  return [
    ...goals.map((g, i) => ({
      id: `g-${i}`, kind: "goal" as const, text: g.goal_text, detail: g.support_category ?? "",
      sourceIds: g.source_segment_ids ?? [], confidence: g.confidence ?? 0, goalId: null, selected: false, removed: false,
    })),
    ...tasks.map((t, i) => ({
      id: `t-${i}`, kind: "task" as const, text: t.task_text, detail: t.requirement_level ?? "optional",
      sourceIds: t.source_segment_ids ?? [], confidence: t.confidence ?? 0,
      goalId: t.linked_goal_index != null ? `g-${t.linked_goal_index}` : null, selected: false, removed: false,
    })),
  ];
}

function quoteFor(ids: string[], transcript: CleanSegment[]): { speaker: string; text: string } | null {
  if (ids.length === 0) return null;
  const parts = transcript.filter((s) => s.segment_id && ids.includes(s.segment_id));
  if (parts.length === 0) return null;
  return { speaker: parts[0].speaker_name || "Unknown speaker", text: parts.map((p) => p.text).join(" ") };
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export interface MeetingSuggestionsReviewProps {
  sessionId: string;
  participantId: string;
  participantName: string;
  meetingLabel: string;
  goals: ExtractedGoal[];
  tasks: ExtractedTask[];
  cleanTranscript: CleanSegment[];
  rawTranscript: RawSegment[];
  /** Things the assistant wants a person to check, in plain sentences. */
  notes: string[];
  /** A line under the heading, e.g. how long the recording was. */
  intro?: string;
  onApplied: () => void;
  /** Extra actions for a fresh recording: Record again, Discard. */
  secondaryActions?: React.ReactNode;
}

/**
 * What a recorded meeting found, ready to add to the participant's plan.
 * Nothing is added until the coordinator ticks items and presses Add. Each
 * suggestion shows the words it came from and can be edited or removed.
 */
export function MeetingSuggestionsReview({
  sessionId, participantId, participantName, meetingLabel, goals, tasks,
  cleanTranscript, rawTranscript, notes, intro, onApplied, secondaryActions,
}: MeetingSuggestionsReviewProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const first = firstName(participantName);

  const [items, setItems] = useState<Item[]>(() => toItems(goals, tasks));
  const [view, setView] = useState<"suggestions" | "transcript">("suggestions");
  const [highlight, setHighlight] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const live = items.filter((i) => !i.removed);
  const liveGoals = live.filter((i) => i.kind === "goal");
  const liveTasks = live.filter((i) => i.kind === "task");
  const selected = live.filter((i) => i.selected);
  const selectedGoals = selected.filter((i) => i.kind === "goal");
  const selectedTasks = selected.filter((i) => i.kind === "task");
  const goalById = useMemo(() => new Map(items.filter((i) => i.kind === "goal").map((g) => [g.id, g])), [items]);

  const update = (id: string, patch: Partial<Item>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const setAll = (kind: Item["kind"], value: boolean) =>
    setItems((prev) => prev.map((i) => (i.kind === kind && !i.removed ? { ...i, selected: value } : i)));

  const showSource = (ids: string[]) => {
    setHighlight(ids);
    setView("transcript");
  };

  const apply = useMutation({
    mutationFn: () => {
      const goalPayload: ExtractedGoalPayload[] = selectedGoals.map((g) => ({ goal_text: g.text, support_category: g.detail || null }));
      const taskPayload: ExtractedTaskPayload[] = selectedTasks.map((t) => {
        const goal = t.goalId ? goalById.get(t.goalId) : undefined;
        return {
          task_text: t.text,
          requirement_level: t.detail === "mandatory" ? "mandatory" : "optional",
          linked_goal_text: goal && goal.selected && !goal.removed ? goal.text : null,
        };
      });
      return applyPlanMeetingSuggestions(sessionId, goalPayload, taskPayload);
    },
    onSuccess: (result) => {
      const short = result.goals_created < selectedGoals.length || result.tasks_created < selectedTasks.length;
      const parts = [
        result.goals_created ? `${result.goals_created} goal${result.goals_created === 1 ? "" : "s"}` : "",
        result.tasks_created ? `${result.tasks_created} task${result.tasks_created === 1 ? "" : "s"}` : "",
      ].filter(Boolean);
      toast({
        title: parts.length ? `Added ${parts.join(" and ")} to ${first}'s plan` : "Nothing was added",
        description: short ? "Some items didn't save. Open NDIS plan & goals to check, then try the rest again." : undefined,
        variant: short ? "destructive" : undefined,
      });
      qc.invalidateQueries({ queryKey: ["plan-meetings", participantId] });
      qc.invalidateQueries({ queryKey: ["plan-meeting-detail", sessionId] });
      // Goal and task queries are org-scoped, so the org id comes first in their keys.
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("ndis-goals") });
      qc.invalidateQueries({ predicate: (q) => q.queryKey.includes("participant-tasks") });
      onApplied();
    },
    onError: (err: Error) => toast({ variant: "destructive", title: "Couldn't add to the plan", description: err?.message ?? "" }),
  });

  // ── Download ──────────────────────────────────────────────────────────────
  const rows = () => live.map((i) => {
    const q = quoteFor(i.sourceIds, cleanTranscript);
    return {
      type: i.kind === "goal" ? "Goal" : "Task",
      text: i.text,
      detail: i.kind === "goal" ? goalAreaLabel(i.detail) : i.detail === "mandatory" ? "On every shift" : "When it fits",
      match: matchLabel(i.confidence).label,
      quote: q ? `${q.speaker}: ${q.text}` : "",
    };
  });
  const fileBase = `${slug(participantName)}-${slug(meetingLabel)}-suggestions`;
  const downloadCsv = () => {
    const csv = [["Type", "Suggestion", "Goal area or when", "Match", "What was said"], ...rows().map((r) => [r.type, r.text, r.detail, r.match, r.quote])]
      .map((r) => r.map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","))
      .join("\n");
    downloadBlob(new Blob([csv], { type: "text/csv" }), `${fileBase}.csv`);
  };
  const downloadPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF();
    doc.setFontSize(15);
    doc.text(`${meetingLabel} with ${participantName}`, 14, 18);
    doc.setFontSize(10);
    doc.setTextColor(110);
    doc.text(`Suggested goals and tasks, downloaded ${new Date().toLocaleString("en-AU")}`, 14, 25);
    autoTable(doc, {
      startY: 32,
      head: [["Type", "Suggestion", "Goal area or when", "Match", "What was said"]],
      body: rows().map((r) => [r.type, r.text, r.detail, r.match, r.quote]),
      styles: { fontSize: 8 },
      columnStyles: { 1: { cellWidth: 50 }, 4: { cellWidth: 60 } },
    });
    doc.save(`${fileBase}.pdf`);
  };

  // ── Rows ──────────────────────────────────────────────────────────────────
  const renderItem = (item: Item) => {
    const quote = quoteFor(item.sourceIds, cleanTranscript);
    const match = matchLabel(item.confidence);
    const goal = item.goalId ? goalById.get(item.goalId) : undefined;
    const goalLeftOut = item.kind === "task" && item.selected && goal && (!goal.selected || goal.removed);
    const checkboxId = `suggestion-${sessionId}-${item.id}`;

    if (item.removed) {
      return (
        <li key={item.id} className="flex items-center justify-between gap-3 py-2.5 text-sm text-cc-muted">
          <span className="min-w-0 truncate line-through">{item.text}</span>
          <button type="button" className="shrink-0 font-medium text-cc-plum hover:underline" onClick={() => update(item.id, { removed: false })}>
            Undo
          </button>
        </li>
      );
    }

    return (
      <li key={item.id} className="flex gap-3 py-4">
        <Checkbox
          id={checkboxId}
          checked={item.selected}
          onCheckedChange={(v) => update(item.id, { selected: v === true })}
          disabled={editingId === item.id}
          className="mt-0.5 h-5 w-5 rounded border-cc-muted data-[state=checked]:border-[var(--cc-cta)] data-[state=checked]:bg-[var(--cc-cta)] data-[state=checked]:text-white"
          aria-label={`Add "${item.text}"`}
        />
        <div className="min-w-0 flex-1">
          {editingId === item.id ? (
            <div className="space-y-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={2}
                autoFocus
                aria-label={item.kind === "goal" ? "Goal wording" : "Task wording"}
                className={TEXTAREA}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className={PRIMARY_BUTTON}
                  disabled={!draft.trim()}
                  onClick={() => { update(item.id, { text: draft.trim(), selected: true }); setEditingId(null); }}
                >
                  Save wording
                </button>
                <button type="button" className={SECONDARY_BUTTON} onClick={() => setEditingId(null)}>Cancel</button>
              </div>
            </div>
          ) : (
            <label htmlFor={checkboxId} className="block cursor-pointer text-sm font-medium leading-snug text-cc-text">
              {item.text}
            </label>
          )}

          <p className="mt-1 text-sm text-cc-muted">
            {item.kind === "goal"
              ? goalAreaLabel(item.detail) || "No goal area"
              : item.detail === "mandatory" ? "On every shift" : "When it fits"}
            {item.kind === "task" && goal && !goal.removed && <> · For: {goal.text}</>}
            {" · "}
            <span className={match.check ? "text-[color:var(--cc-amber)]" : undefined}>{match.label}</span>
          </p>

          {quote && (
            <blockquote className="mt-2 border-l-2 border-cc-border pl-3 text-sm leading-relaxed text-cc-muted">
              <span className="text-cc-text">{quote.speaker}:</span> <span className="italic">"{quote.text}"</span>
            </blockquote>
          )}
          {goalLeftOut && (
            <p className="mt-2 text-sm text-[color:var(--cc-amber)]">Its goal isn't ticked, so this task will be added on its own.</p>
          )}

          {editingId !== item.id && (
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <button type="button" className="font-medium text-cc-plum hover:underline" onClick={() => { setEditingId(item.id); setDraft(item.text); }}>
                Edit wording
              </button>
              {quote && (
                <button type="button" className="font-medium text-cc-plum hover:underline" onClick={() => showSource(item.sourceIds)}>
                  See where this was said
                </button>
              )}
              <button type="button" className="font-medium text-cc-muted hover:underline" onClick={() => update(item.id, { removed: true, selected: false })}>
                Remove
              </button>
            </div>
          )}
        </div>
      </li>
    );
  };

  const group = (kind: Item["kind"], title: string, help: string) => {
    const all = items.filter((i) => i.kind === kind);
    if (all.length === 0) return null;
    const liveOfKind = kind === "goal" ? liveGoals : liveTasks;
    const allTicked = liveOfKind.length > 0 && liveOfKind.every((i) => i.selected);
    return (
      <section aria-label={title} className="border-t border-cc-border pt-4 first:border-t-0 first:pt-0">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-semibold text-cc-text">
            {title} <span className="ml-1 font-normal tabular-nums text-cc-muted">{liveOfKind.length}</span>
          </h3>
          {liveOfKind.length > 1 && (
            <button type="button" className="text-sm font-medium text-cc-plum hover:underline" onClick={() => setAll(kind, !allTicked)}>
              {allTicked ? "Untick all" : "Tick all"}
            </button>
          )}
        </div>
        <p className="mt-0.5 text-sm text-cc-muted">{help}</p>
        <ul className="divide-y divide-cc-border">{all.map(renderItem)}</ul>
      </section>
    );
  };

  const total = live.length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4 sm:px-6">
        {intro && <p className="text-sm text-cc-muted">{intro}</p>}

        {notes.length > 0 && (
          <div className="border-l-4 border-[color:var(--cc-amber)] pl-3">
            <p className="text-sm font-medium text-cc-text">Check before adding</p>
            <ul className="mt-1 space-y-1 text-sm text-cc-muted">
              {notes.map((n, i) => <li key={i}>{n}</li>)}
            </ul>
          </div>
        )}

        <div role="tablist" aria-label="Meeting" className="flex gap-6 border-b border-cc-border">
          {([
            ["suggestions", `Suggestions${total ? ` (${total})` : ""}`],
            ["transcript", "Transcript"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={view === key}
              onClick={() => setView(key)}
              className={`-mb-px border-b-2 pb-2 text-sm font-medium transition-colors ${
                view === key ? "border-cc-plum text-cc-text" : "border-transparent text-cc-muted hover:text-cc-text"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {view === "suggestions" ? (
          items.length === 0 ? (
            <div className="py-6">
              <p className="text-sm font-medium text-cc-text">No goals or tasks were found in this conversation</p>
              <p className="mt-1 text-sm text-cc-muted">The transcript is kept with the meeting, so you can still read it.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {group("goal", "Goals", `In ${first}'s words where possible. Ticked goals are added to the NDIS plan & goals section.`)}
              {group("task", "Tasks for support workers", "Ticked tasks appear on shifts, so workers know what to do.")}
            </div>
          )
        ) : (
          <MeetingTranscript cleanTranscript={cleanTranscript} rawTranscript={rawTranscript} highlightIds={highlight} />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-cc-border bg-cc-surface px-5 py-3 sm:px-6">
        <div className="flex flex-wrap items-center gap-2">
          {total > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className={SECONDARY_BUTTON}>
                  <Download size={15} aria-hidden /> Download <ChevronDown size={14} aria-hidden />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                <DropdownMenuItem onSelect={() => void downloadPdf()}>PDF</DropdownMenuItem>
                <DropdownMenuItem onSelect={downloadCsv}>Spreadsheet (CSV)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {secondaryActions}
        </div>
        <button
          type="button"
          className={PRIMARY_BUTTON}
          disabled={selected.length === 0 || apply.isPending || editingId !== null}
          onClick={() => apply.mutate()}
        >
          {apply.isPending && <Loader2 size={15} className="animate-spin" aria-hidden />}
          {selected.length === 0 ? "Tick items to add" : `Add ${selected.length} to ${first}'s plan`}
        </button>
      </div>
    </div>
  );
}
