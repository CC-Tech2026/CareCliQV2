import { useRef, useState, type DragEvent } from "react";
import { Loader2, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

type FileDropzoneProps = {
  accept?: string;
  maxSizeBytes?: number;
  disabled?: boolean;
  busy?: boolean;
  onFile: (file: File) => void;
  onRejected?: (reason: string) => void;
  label?: string;
  hint?: string;
  busyLabel?: string;
  className?: string;
};

/**
 * Shared drag-and-drop upload zone. Click-to-browse always works too, so it degrades
 * gracefully on touch devices that don't support HTML5 drag-and-drop.
 */
export function FileDropzone({
  accept,
  maxSizeBytes,
  disabled = false,
  busy = false,
  onFile,
  onRejected,
  label = "Drag a file here, or click to browse",
  hint,
  busyLabel = "Uploading…",
  className,
}: FileDropzoneProps) {
  const [isOver, setIsOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const isDisabled = disabled || busy;

  const acceptedTypes = accept?.split(",").map((t) => t.trim()).filter(Boolean);

  const handleFile = (file: File | undefined | null) => {
    if (!file) return;
    if (acceptedTypes && acceptedTypes.length > 0 && !acceptedTypes.includes(file.type)) {
      onRejected?.("That file type isn't supported.");
      return;
    }
    if (maxSizeBytes && file.size > maxSizeBytes) {
      onRejected?.(`File must be ${Math.round(maxSizeBytes / (1024 * 1024))}MB or smaller.`);
      return;
    }
    onFile(file);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsOver(false);
    if (isDisabled) return;
    handleFile(e.dataTransfer.files?.[0]);
  };

  return (
    <div
      role="button"
      tabIndex={isDisabled ? -1 : 0}
      aria-disabled={isDisabled}
      onClick={() => !isDisabled && inputRef.current?.click()}
      onKeyDown={(e) => {
        if (!isDisabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!isDisabled) setIsOver(true);
      }}
      onDragLeave={() => setIsOver(false)}
      onDrop={handleDrop}
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed px-4 py-6 text-center transition-colors",
        isDisabled ? "cursor-not-allowed opacity-60" : "cursor-pointer",
        isOver ? "border-cc-plum bg-cc-soft" : "border-cc-plum/40 bg-cc-soft/60 hover:border-cc-plum/70",
        className,
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        disabled={isDisabled}
        onChange={(e) => {
          handleFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {busy ? <Loader2 className="h-5 w-5 animate-spin text-cc-plum" /> : <Upload className="h-5 w-5 text-cc-plum" />}
      <p className="text-[12px] font-bold text-cc-text">{busy ? busyLabel : label}</p>
      {hint && !busy && <p className="text-[11px] text-cc-muted">{hint}</p>}
    </div>
  );
}
