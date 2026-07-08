import { Camera, Mic, Paperclip, Trash2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MUTED, PLUM, TEXT } from "@/lib/shift-utils";
import { isCheckinSessionNote } from "@workspace/worker-compliance";
import type { SessionNoteRecord, SessionNoteType } from "@/services/sessionNotesService";
import { useAccessibility } from "@/contexts/AccessibilityContext";

const ATTACHMENT_RE = /^\[Attachment(?:\s+selected)?:\s*([^\]]+)\]$/i;

export function inferNoteType(note: SessionNoteRecord): SessionNoteType {
  if (note.note_type) return note.note_type;
  if (isCheckinSessionNote(note)) return "check-in";
  if (ATTACHMENT_RE.test(note.content.trim())) {
    if (/selected/i.test(note.content)) return "file";
    const name = note.file_name || note.content;
    return isImageName(name) ? "photo" : "file";
  }
  return "text";
}

export function isImageName(name: string) {
  return /\.(jpe?g|png|gif|webp|heic|bmp)$/i.test(name.trim());
}

export function fileExtension(name: string) {
  const parts = name.split(".");
  return parts.length > 1 ? parts.pop()!.toLowerCase() : "";
}

export function noteTimestamp(note: SessionNoteRecord) {
  const raw = note.auto_saved_at || note.created_at;
  if (!raw) return "";
  return new Date(raw).toLocaleString();
}

export function noteSortTime(note: SessionNoteRecord) {
  return Date.parse(note.auto_saved_at || note.created_at || "0");
}

export function sortNotesLatestFirst(notes: SessionNoteRecord[]) {
  return [...notes].sort((a, b) => noteSortTime(b) - noteSortTime(a));
}

function typeIcon(type: SessionNoteType): LucideIcon {
  if (type === "voice") return Mic;
  if (type === "photo") return Camera;
  if (type === "file") return Paperclip;
  return Paperclip;
}

function imageUrl(note: SessionNoteRecord) {
  return (note.attachment_urls ?? []).find((u) => u.startsWith("data:") || u.startsWith("http"));
}

type Props = {
  note: SessionNoteRecord;
  onDelete: () => void;
  onViewImage?: (url: string, title: string) => void;
};

export function SessionNoteHistoryCard({ note, onDelete, onViewImage }: Props) {
  const { translate, translateParams } = useAccessibility();
  const type = inferNoteType(note);
  const Icon = typeIcon(type);
  const ts = noteTimestamp(note);
  const attachmentMatch = note.content.trim().match(ATTACHMENT_RE);
  const fileName = note.file_name || attachmentMatch?.[1]?.trim() || "";
  const ext = fileName ? fileExtension(fileName) : "";
  const preview = imageUrl(note);
  const isImage = isImageName(fileName) || type === "photo";

  return (
    <li className="flex gap-2 rounded-lg bg-cc-bg px-2.5 py-2">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold" style={{ color: TEXT }}>
            {ts}
          </span>
          {type !== "text" && (
            <Icon size={14} className="shrink-0" style={{ color: PLUM }} aria-hidden="true" />
          )}
        </div>

        {type === "text" && (
          <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-relaxed" style={{ color: TEXT }}>
            {note.content}
          </p>
        )}

        {type === "voice" && (
          <p className="mt-1 whitespace-pre-wrap text-sm font-medium leading-relaxed" style={{ color: TEXT }}>
            {note.content}
          </p>
        )}

        {(type === "file" || type === "photo") && (
          <div className="mt-1.5 space-y-1 text-sm" style={{ color: TEXT }}>
            {isImage && preview && onViewImage && (
              <button
                type="button"
                className="text-xs font-bold underline-offset-2 hover:underline"
                style={{ color: PLUM }}
                onClick={() => onViewImage(preview, fileName || translate("shift.session.image"))}
              >
                {translate("shift.session.viewImage")}
              </button>
            )}
            {fileName && (
              <p className="font-medium">
                {type === "photo" ? translate("shift.session.image") : translate("shift.session.attachedFile")}: {fileName}
              </p>
            )}
            {ext && (
              <p className="text-xs font-semibold" style={{ color: MUTED }}>
                {translateParams("shift.session.extension", { ext })}
              </p>
            )}
            {!fileName && !isImage && (
              <p className="whitespace-pre-wrap font-medium">{note.content}</p>
            )}
          </div>
        )}
      </div>
      <button
        type="button"
        className="shrink-0 self-start rounded p-1.5 text-red-600 transition hover:bg-red-50"
        aria-label={translate("shift.session.noteDelete")}
        onClick={onDelete}
      >
        <Trash2 size={15} />
      </button>
    </li>
  );
}
