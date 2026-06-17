import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { Camera, ChevronDown, ClipboardList, MessageCircle, Mic, Paperclip } from "lucide-react";
import { cn } from "@/lib/utils";
import { listSessionEvidence, type TaskEvidenceRecord } from "@/lib/task-evidence-storage";
import type { ShiftTask } from "@/services/shiftService";
import { BORDER, MUTED, PLUM, TEXT } from "@/lib/shift-utils";

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
};

function buildEntries(records: TaskEvidenceRecord[], tasks: ShiftTask[]): TimelineEntry[] {
  const labelById = new Map(tasks.map((task) => [task.task_id, task.label]));
  return records.map((record) => ({
    id: record.evidence_id,
    time: record.created_at,
    taskLabel: labelById.get(record.task_id) ?? "Task update",
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

function entryActionLabel(entry: TimelineEntry) {
  if (entry.kind === "photo") return "Photo added";
  if (entry.kind === "voice") return "Voice note recorded";
  if (entry.kind === "file") return entry.preview ? `File attached — ${entry.preview}` : "File attached";
  return entry.preview || "Note added";
}

function TimelineRow({ entry }: { entry: TimelineEntry }) {
  const isMedia = entry.kind === "photo" || entry.kind === "voice" || entry.kind === "file";

  return (
    <li className="flex gap-3 border-b px-4 py-3 last:border-b-0" style={{ borderColor: BORDER }}>
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#F1EAFF]">
        <EntryKindIcon kind={entry.kind} />
      </span>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold" style={{ color: MUTED }}>
            {format(parseISO(entry.time), "hh:mm a")}
          </span>
          <span
            className="rounded-full bg-[#F1EAFF] px-2 py-0.5 text-[10px] font-black"
            style={{ color: PLUM }}
          >
            {entry.taskLabel}
          </span>
        </div>

        {isMedia ? (
          <p className="mt-1.5 flex items-center gap-1.5 text-sm font-black" style={{ color: TEXT }}>
            <EntryActionIcon kind={entry.kind} />
            {entryActionLabel(entry)}
          </p>
        ) : (
          <p className="mt-1.5 text-sm font-black leading-snug" style={{ color: TEXT }}>
            {entryActionLabel(entry)}
          </p>
        )}
      </div>
    </li>
  );
}

export function SessionTimeline({ sessionId, tasks, open = false, onToggle }: Props) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);

  const refresh = useCallback(async () => {
    if (!sessionId) {
      setEntries([]);
      return;
    }
    try {
      const records = await listSessionEvidence(sessionId);
      setEntries(buildEntries(records, tasks));
    } catch {
      setEntries([]);
    }
  }, [sessionId, tasks]);

  useEffect(() => {
    void refresh();
    const handler = () => void refresh();
    window.addEventListener("task-evidence-updated", handler);
    return () => window.removeEventListener("task-evidence-updated", handler);
  }, [refresh]);

  if (!sessionId) return null;

  return (
    <section className="overflow-hidden rounded-2xl border bg-white shadow-sm" style={{ borderColor: BORDER }}>
      <button
        type="button"
        className="flex w-full items-center justify-between px-4 py-3.5 text-left"
        onClick={onToggle}
      >
        <span className="flex items-center gap-2 text-sm font-black" style={{ color: TEXT }}>
          <ClipboardList size={16} style={{ color: PLUM }} />
          Session Timeline ({entries.length})
        </span>
        <ChevronDown size={18} className={cn("transition", open && "rotate-180")} style={{ color: MUTED }} />
      </button>

      {open && (
        <div className="border-t" style={{ borderColor: BORDER }}>
          {entries.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs font-semibold" style={{ color: MUTED }}>
              Updates from your task threads will appear here.
            </p>
          ) : (
            <ul>
              {entries.map((entry) => (
                <TimelineRow key={entry.id} entry={entry} />
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
