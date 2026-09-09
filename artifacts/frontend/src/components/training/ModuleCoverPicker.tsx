import { useEffect, useRef, useState } from "react";
import { ImagePlus, Check } from "lucide-react";
import { CourseCover, COURSE_COLORS } from "./CourseCover";

export function ModuleCoverPicker({
  title,
  count,
  color,
  imageUrl,
  file,
  disabled,
  onColor,
  onFile,
  onRemove,
}: {
  title: string;
  count: number;
  color: string;
  imageUrl?: string | null;
  file: File | null;
  disabled: boolean;
  onColor: (color: string) => void;
  onFile: (file: File) => void;
  onRemove: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <section className="space-y-4 rounded-2xl border bg-card p-5">
      <div>
        <h3 className="text-sm font-bold">Module cover</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Choose a colour or upload a photo. This cover is shown to your
          workers.
        </p>
      </div>
      <CourseCover
        title={title}
        count={count}
        color={color}
        imageUrl={preview ?? imageUrl}
        className="h-40"
      />
      <fieldset disabled={disabled} className="space-y-4">
        <legend className="sr-only">Cover appearance</legend>
        <div className="flex flex-wrap items-center gap-2">
          {COURSE_COLORS.map((value) => (
            <button
              type="button"
              key={value}
              aria-label={`Use ${value} cover colour`}
              aria-pressed={color.toUpperCase() === value}
              onClick={() => {
                onColor(value);
                onRemove();
              }}
              className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white text-slate-800 ring-1 ring-border focus-visible:ring-2 focus-visible:ring-primary"
              style={{ backgroundColor: value }}
            >
              {color.toUpperCase() === value && !imageUrl && !file && (
                <Check size={17} />
              )}
            </button>
          ))}
          <label className="ml-1 flex items-center gap-2 text-xs font-medium">
            Custom
            <input
              aria-label="Custom cover colour"
              type="color"
              value={color}
              onChange={(e) => {
                onColor(e.target.value);
                onRemove();
              }}
              className="h-8 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => input.current?.click()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border px-4 text-xs font-bold"
          >
            <ImagePlus size={16} />
            Upload photo
          </button>
          {(file || imageUrl) && (
            <button
              type="button"
              onClick={onRemove}
              className="h-10 rounded-xl px-3 text-xs font-semibold text-muted-foreground"
            >
              Remove photo
            </button>
          )}
          <span className="text-xs text-muted-foreground">
            PNG, JPEG or WebP · Up to 5 MB
          </span>
        </div>
        <input
          ref={input}
          aria-label="Upload module cover photo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          onChange={(e) => {
            const selected = e.target.files?.[0];
            e.target.value = "";
            if (!selected) return;
            if (
              !["image/png", "image/jpeg", "image/webp"].includes(
                selected.type,
              ) ||
              selected.size > 5 * 1024 * 1024
            ) {
              setError("Choose a PNG, JPEG or WebP image smaller than 5 MB.");
              return;
            }
            setError("");
            onFile(selected);
          }}
        />
        {error && (
          <p role="alert" className="text-xs text-red-600">
            {error}
          </p>
        )}
      </fieldset>
    </section>
  );
}
