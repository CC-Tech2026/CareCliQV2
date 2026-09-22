import { useEffect, useRef, useState } from "react";
import { LockKeyhole, Unlock, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useMyAccessGrants } from "@/hooks/useMyAccessGrants";
import { TemporaryAccessBanner } from "@/components/TemporaryAccessBanner";
import {
  uploadTrainingCover,
  createTrainingModule,
  updateTrainingModule,
  setTrainingModuleLock,
  type TrainingModule,
  type TrainingResource,
} from "@/services/coordinatorService";
import { ModuleCoverPicker } from "./ModuleCoverPicker";
import { TrainingWorkspace } from "./TrainingWorkspace";
import { TrainingMaterialsEditor } from "./TrainingMaterialsEditor";

export function TrainingModuleEditor({
  module,
  credentials,
  onClose,
  onSaved,
  onChanged,
}: {
  module?: TrainingModule;
  credentials: { value: string; label: string }[];
  onClose: () => void;
  onSaved: (module: TrainingModule) => void;
  onChanged: (module: TrainingModule) => void;
}) {
  const { toast } = useToast();
  const { user } = useAuth();
  const { hasCapability, grantFor } = useMyAccessGrants();
  const isMD = user?.role === "managing_director";
  const lockGrant = !isMD ? grantFor("lock_training_module") : undefined;
  const canLock = isMD || hasCapability("lock_training_module");
  const client = useQueryClient();
  const uploadedCover = useRef<{ file: File; path: string } | null>(null);
  const [saveError, setSaveError] = useState("");
  const [coverColor, setCoverColor] = useState(
    module?.cover_color ?? "#DDD6FE",
  );
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPath, setCoverPath] = useState(module?.cover_path ?? null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [title, setTitle] = useState(module?.title ?? "");
  const [description, setDescription] = useState(module?.description ?? "");
  const [credential, setCredential] = useState(
    module?.linked_credential_type ?? "",
  );
  const [certification, setCertification] = useState(
    module?.requires_certification ?? false,
  );
  const [autoAssign, setAutoAssign] = useState(
    module?.auto_assign_on_hire ?? false,
  );
  const [reason, setReason] = useState(module?.lock_reason ?? "");
  const [busy, setBusy] = useState(false);
  const [materialsBusy, setMaterialsBusy] = useState(false);
  const [materialsDirty, setMaterialsDirty] = useState(false);
  const dirty =
    !!coverFile ||
    removePhoto ||
    coverColor !== (module?.cover_color ?? "#DDD6FE") ||
    title !== (module?.title ?? "") ||
    description !== (module?.description ?? "") ||
    credential !== (module?.linked_credential_type ?? "") ||
    certification !== (module?.requires_certification ?? false) ||
    autoAssign !== (module?.auto_assign_on_hire ?? false);
  const disabled = busy || materialsBusy;
  useEffect(() => {
    const protect = (event: BeforeUnloadEvent) => {
      if (dirty || materialsDirty || disabled) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [dirty, materialsDirty, disabled]);
  function close() {
    if (disabled) return;
    if (
      (dirty || materialsDirty) &&
      !window.confirm(
        "Discard unsaved details or material edits? Saved materials and lock changes will be kept.",
      )
    )
      return;
    onClose();
  }
  async function save() {
    if (disabled || !title.trim()) return;
    setBusy(true);
    setSaveError("");
    try {
      let savedCoverPath = coverPath;
      if (coverFile) {
        if (uploadedCover.current?.file !== coverFile) {
          const uploaded = await uploadTrainingCover(coverFile);
          uploadedCover.current = { file: coverFile, path: uploaded.cover_path };
        }
        savedCoverPath = uploadedCover.current!.path;
        setCoverPath(savedCoverPath);
      }
      const payload = {
        cover_color: coverColor,
        cover_path: removePhoto ? null : savedCoverPath,
        title: title.trim(),
        description: description.trim(),
        linked_credential_type: credential || undefined,
        requires_certification: certification,
        auto_assign_on_hire: autoAssign,
      };
      const saved = module
        ? await updateTrainingModule(module.id, {
            ...payload,
            linked_credential_type: credential || null,
          })
        : await createTrainingModule(payload);
      uploadedCover.current = null;
      setCoverPath(saved.cover_path ?? null);
      void client.invalidateQueries({ queryKey: [user?.organizationId, "worker", "training-modules"] });
      toast({
        title: module
          ? "Module saved"
          : "Module created. Add your learning materials next.",
      });
      if (module) {
        onChanged({ ...module, ...saved });
        setCoverFile(null);
        setRemovePhoto(false);
        setTitle(title.trim());
        setDescription(description.trim());
      } else {
        onSaved(saved);
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Your changes were not saved. Please try again.");
      toast({
        title: "Could not save module",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }
  async function toggleLock() {
    if (!module || disabled) return;
    setBusy(true);
    try {
      const updated = await setTrainingModuleLock(
        module.id,
        !module.is_locked,
        reason.trim(),
      );
      onChanged({ ...module, ...updated });
      toast({
        title: updated.is_locked
          ? "Module locked for maintenance"
          : "Module available to workers",
      });
    } catch (error) {
      toast({
        title: "Could not change module access",
        description: error instanceof Error ? error.message : "Try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }
  return (
    <TrainingWorkspace
      title={module ? "Manage training module" : "Create training module"}
      description={
        module?.title ?? "Build a clear learning experience for your team."
      }
      onClose={close}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {dirty ? "Unsaved details" : "Details up to date"}
          </p>
          <div className="flex gap-2">
            <button
              disabled={disabled}
              onClick={close}
              className="inline-flex h-11 items-center justify-center rounded-xl border px-4 text-sm font-semibold"
            >
              Close
            </button>
            <button
              disabled={disabled || !title.trim()}
              onClick={() => void save()}
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {busy && <Loader2 size={15} className="animate-spin" />}
              {module ? "Save module" : "Create module"}
            </button>
          </div>
        </div>
      }
    >
      {saveError && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">{saveError} Your changes are kept here so you can retry.</div>}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        {module && (
          <section
            className={`rounded-2xl border p-5 xl:col-start-2 xl:row-start-2 ${module.is_locked ? "border-amber-200 bg-amber-50 text-amber-950" : "bg-card"}`}
          >
            <div className="flex items-start gap-3">
              {module.is_locked ? (
                <LockKeyhole size={20} />
              ) : (
                <Unlock size={20} />
              )}
              <div>
                <h3 className="text-sm font-bold">
                  {module.is_locked
                    ? "Locked for maintenance"
                    : "Available to workers"}
                </h3>
                <p className="mt-1 text-xs leading-relaxed">
                  {module.is_locked
                    ? "Workers see an update notice. Materials and completion are paused until you unlock this module."
                    : "Lock this module before updating its content. Unlock it when the changes are ready."}
                </p>
              </div>
            </div>
            {canLock && (
              <div className="mt-4 space-y-3">
                {lockGrant && <TemporaryAccessBanner grant={lockGrant} label="Lock/unlock a training module" />}
                {!module.is_locked && (
                  <label className="block text-xs font-semibold">
                    Update notice (optional)
                    <input
                      maxLength={500}
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="e.g. We’re updating the manual handling guide."
                      className="mt-1.5 w-full rounded-lg border bg-background p-2.5 text-sm"
                    />
                  </label>
                )}
                {module.is_locked && module.lock_reason && (
                  <p className="text-sm">{module.lock_reason}</p>
                )}
                <button
                  disabled={disabled}
                  onClick={() => void toggleLock()}
                  className="rounded-lg border bg-background px-3 py-2 text-xs font-bold disabled:opacity-50"
                >
                  {module.is_locked
                    ? "Unlock & make available"
                    : "Lock for updates"}
                </button>
              </div>
            )}
          </section>
        )}
        <div className="xl:col-start-2 xl:row-start-1">
          <ModuleCoverPicker
            title={title || "New module"}
            count={module?.resources?.length ?? 0}
            color={coverColor}
            imageUrl={removePhoto ? null : module?.cover_url}
            file={coverFile}
            disabled={disabled}
            onColor={setCoverColor}
            onFile={(file) => {
              setCoverFile(file);
              setRemovePhoto(false);
            }}
            onRemove={() => {
              setCoverFile(null);
              setCoverPath(null);
              setRemovePhoto(!!module?.cover_path);
            }}
          />
        </div>
        <div className="xl:col-start-1 xl:row-start-1">
          <fieldset
            disabled={disabled}
            className="space-y-5 rounded-2xl border bg-card p-5"
          >
            <div>
              <h2 className="text-base font-bold">Module settings</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Set the learning objectives and completion requirements.
              </p>
            </div>
            <label className="block text-xs font-bold">
              Module title
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Safe manual handling"
                className="mt-2 w-full rounded-xl border bg-background px-3 py-2.5 text-sm"
              />
            </label>
            <label className="block text-xs font-bold">
              Overview
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                placeholder="What will workers learn?"
                className="mt-2 w-full rounded-xl border bg-background px-3 py-2.5 text-sm"
              />
            </label>
            <label className="block text-xs font-bold">
              Linked credential
              <select
                value={credential}
                onChange={(e) => setCredential(e.target.value)}
                className="mt-2 w-full rounded-xl border bg-background px-3 py-2.5 text-sm"
              >
                {credentials.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex items-start gap-3 rounded-xl bg-muted/40 p-3">
              <input
                type="checkbox"
                checked={certification}
                onChange={(e) => setCertification(e.target.checked)}
                className="mt-1"
              />
              <span className="text-sm font-semibold">
                Certification required
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  Workers must provide evidence of completion.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-3 rounded-xl bg-muted/40 p-3">
              <input
                type="checkbox"
                checked={autoAssign}
                onChange={(e) => setAutoAssign(e.target.checked)}
                className="mt-1"
              />
              <span className="text-sm font-semibold">
                Assign to new hires
                <span className="mt-1 block text-xs font-normal text-muted-foreground">
                  Automatically include this module in new workers’ training.
                </span>
              </span>
            </label>
          </fieldset>
        </div>
        <div className="xl:col-start-1 xl:row-start-2 xl:row-span-2">
          {module ? (
            <TrainingMaterialsEditor
              moduleId={module.id}
              initialResources={module.resources ?? []}
              onBusyChange={setMaterialsBusy}
              onDirtyChange={setMaterialsDirty}
              onChange={(resources: TrainingResource[]) =>
                onChanged({ ...module, resources })
              }
            />
          ) : (
            <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
              Create the module first, then add videos, readings and guidelines
              here.
            </p>
          )}
        </div>
      </div>
    </TrainingWorkspace>
  );
}
