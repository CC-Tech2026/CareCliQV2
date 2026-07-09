import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { Camera, ChevronDown, ClipboardList, MessageCircle, Mic, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { listMergedSessionEvidence, SESSION_NOTES_UPDATED_EVENT } from "@/lib/merge-session-evidence";
import type { TaskEvidenceRecord } from "@/lib/task-evidence-storage";
import type { ShiftTask } from "@/services/shiftService";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import { useAccessibility } from "@/contexts/AccessibilityContext";

type TimelineEntry = {
  id: string;
  time: string;
  taskLabel: string;
  kind: "photo" | "voice" | "text" | "file";
  preview?: string;
};

type Props = {
  sessionId?: string | null;
  tasks: ShiftTask[];
  open?: boolean;
  onToggle?: () => void;
  /** Nested inside Goal-Linked Task Feed — flat divider style instead of a second card. */
  embedded?: boolean;
};

function buildEntries(
  records: TaskEvidenceRecord[],
  tasks: ShiftTask[],
  taskUpdateLabel: string,
): TimelineEntry[] {
  const labelById = new Map(tasks.map((task) => [task.task_id, task.label]));
  return records.map((record) => ({
    id: record.evidence_id,
    time: record.created_at,
    taskLabel: labelById.get(record.task_id) ?? taskUpdateLabel,
    kind: record.type,
    preview:
      record.type === "text"
        ? record.content
        : record.type === "file"
          ? record.file_name || record.content
          : undefined,
  }));
}

function EntryKindIcon({ kind }: { kind: TimelineEntry["kind"] }) {
  const className = "text-[#8B75D9]";
  if (kind === "photo") return <Camera size={15} className={className} />;
  if (kind === "voice") return <Mic size={15} className={className} />;
  if (kind === "file") return <Paperclip size={15} className={className} />;
  return <MessageCircle size={15} className={className} />;
}

function EntryActionIcon({ kind }: { kind: TimelineEntry["kind"] }) {
  const className = "shrink-0 text-slate-500";
  if (kind === "photo") return <Camera size={13} className={className} />;
  if (kind === "voice") return <Mic size={13} className={className} />;
  if (kind === "file") return <Paperclip size={13} className={className} />;
  return null;
}

function entryActionLabel(
  entry: TimelineEntry,
  translate: (key: string) => string,
  translateParams: (key: string, params: Record<string, string>) => string,
) {
  if (entry.kind === "photo") return translate("shift.evidence.photoAdded");
  if (entry.kind === "voice") return translate("shift.evidence.voiceRecorded");
  if (entry.kind === "file") {
    return entry.preview
      ? translateParams("shift.evidence.fileAttachedNamed", { name: entry.preview })
      : translate("shift.evidence.fileAttached");
  }
  return entry.preview || translate("shift.evidence.noteAdded");
}

function TimelineRow({
  entry,
  translate,
  translateParams,
}: {
  entry: TimelineEntry;
  translate: (key: string) => string;
  translateParams: (key: string, params: Record<string, string>) => string;
}) {
  const isMedia = entry.kind === "photo" || entry.kind === "voice" || entry.kind === "file";

  return (
    <li className="flex gap-3 border-b px-4 py-3 last:border-b-0" style={{ borderColor: BORDER }}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-cc-soft">
        <EntryKindIcon kind={entry.kind} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold" style={{ color: MUTED }}>
            {format(parseISO(entry.time), "hh:mm a")}
          </span>
          <span
            className="rounded-full bg-cc-soft px-2 py-0.5 text-[10px]"
            style={{ color: PLUM }}
          >
            {entry.taskLabel}
          </span>
        </div>

        {isMedia ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-sm font-black" style={{ color: TEXT }}>
            <EntryActionIcon kind={entry.kind} />
            {entryActionLabel(entry, translate, translateParams)}
          </p>
        ) : (
          <p className="mt-1.5 text-sm leading-snug" style={{ color: TEXT }}>
            {entryActionLabel(entry, translate, translateParams)}
          </p>
        )}
      </div>
    </li>
  );
}

export function SessionTimeline({
  sessionId,
  tasks,
  open = false,
  onToggle,
  embedded = false,
}: Props) {
  const { translate, translateParams } = useAccessibility();
  const [entries, setEntries] = useState<TimelineEntry[]>([]);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setEntries([]);
      return;
    }
    try {
      const records = await listMergedSessionEvidence(sessionId);
      setEntries(buildEntries(records, tasks, translate("shift.evidence.taskUpdate")));
    } catch {
      setEntries([]);
    }
  }, [sessionId, tasks, translate]);

  useEffect(() => {
    void refresh();
    const handler = () => void refresh();
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    window.addEventListener("task-evidence-updated", handler);
    window.addEventListener(SESSION_NOTES_UPDATED_EVENT, handler);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("task-evidence-updated", handler);
      window.removeEventListener(SESSION_NOTES_UPDATED_EVENT, handler);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refresh]);

  if (!sessionId) return null;

  return (
    <section
      className={cn(
        "overflow-hidden",
        embedded
          ? "mt-4 border-t border-cc-border pt-1"
          : "rounded-2xl border bg-card shadow-sm",
      )}
      style={embedded ? undefined : { borderColor: BORDER }}
    >
      <button
        type="button"
        className={cn(
          "flex w-full items-center justify-between text-left",
          embedded ? "px-0 py-3" : "px-4 py-3.5",
        )}
        onClick={onToggle}
      >
        <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
          <ClipboardList size={16} style={{ color: PLUM }} />
          {translateParams("shift.session.timeline", { count: String(entries.length) })}
        </span>
        <ChevronDown size={18} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} />
      </button>

      {open && (
        <div
          className={cn("border-t", embedded && "-mx-0")}
          style={{ borderColor: BORDER }}
        >
          {entries.length === 0 ? (
            <p
              className={cn(
                "py-6 text-center text-xs font-semibold",
                embedded ? "px-0" : "px-4",
              )}
              style={{ color: MUTED }}
            >
              {translate("shift.session.timelineEmpty")}
            </p>
          ) : (
            <ul>
              {entries.map((entry) => (
                <TimelineRow key={entry.id} entry={entry} translate={translate} translateParams={translateParams} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export function notifyTaskEvidenceUpdated() {
  window.dispatchEvent(new Event("task-evidence-updated"));
}
