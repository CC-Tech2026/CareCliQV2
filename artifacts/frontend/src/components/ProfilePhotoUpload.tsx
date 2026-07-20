import { useRef, useState } from "react";
import { Camera, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { cropImageToCircle } from "@/lib/image-crop";
import { deleteProfilePhoto, uploadProfilePhoto } from "@/services/userService";

type Props = {
  currentUrl?: string | null;
  cropCircle?: boolean;
};

export function ProfilePhotoUpload({ currentUrl, cropCircle = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { translate } = useAccessibility();
  const { user, updateUser } = useAuth();
  const [preview, setPreview] = useState(currentUrl || user?.profile_photo_url || "");
  const [busy, setBusy] = useState(false);
  const allowedTypes = cropCircle
    ? ["image/jpeg", "image/png"]
    : ["image/jpeg", "image/png", "image/webp"];

  async function handleFile(file?: File) {
    if (!file) return;
    if (!allowedTypes.includes(file.type)) {
      toast({
        title: translate("profile.photo.unsupported"),
        description: cropCircle ? translate("profile.photo.uploadJpegPng") : translate("profile.photo.uploadJpgPngWebp"),
        variant: "destructive",
      });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({
        title: translate("profile.photo.tooLarge"),
        description: translate("profile.photo.maxSize"),
        variant: "destructive",
      });
      return;
    }
    setBusy(true);
    try {
      const uploadFile = cropCircle ? await cropImageToCircle(file) : file;
      setPreview(URL.createObjectURL(uploadFile));
      const profile = await uploadProfilePhoto(uploadFile);
      setPreview(profile.profile_photo_url || "");
      updateUser({ profile_photo_url: profile.profile_photo_url || null });
      toast({ title: translate("profile.photo.saved") });
    } catch (error) {
      toast({
        title: translate("profile.photo.uploadFailed"),
        description: error instanceof Error ? error.message : translate("profile.photo.tryAnother"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    setBusy(true);
    try {
      await deleteProfilePhoto();
      setPreview("");
      updateUser({ profile_photo_url: null });
      toast({ title: translate("profile.photo.removed") });
    } catch (error) {
      toast({
        title: translate("profile.photo.removeFailed"),
        description: error instanceof Error ? error.message : translate("common.retry"),
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  const initials = (user?.full_name || user?.email || "CS")
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="h-24 w-24 overflow-hidden rounded-full border bg-cc-soft" style={{ borderColor: "var(--cc-border)" }}>
        {preview ? (
          <img src={preview} alt={translate("profile.photo.alt")} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xl font-black text-cc-plum">
            {initials}
          </div>
        )}
      </div>
      <div className="space-y-3">
        <input
          ref={inputRef}
          type="file"
          accept={cropCircle ? "image/jpeg,image/png" : "image/jpeg,image/png,image/webp"}
          className="hidden"
          onChange={(event) => void handleFile(event.target.files?.[0])}
        />
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="gap-2 rounded-xl"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : preview ? <Camera className="h-4 w-4" /> : <Upload className="h-4 w-4" />}
            {preview ? translate("profile.photo.replace") : translate("profile.photo.upload")}
          </Button>
          {preview && (
            <Button type="button" variant="ghost" onClick={removePhoto} disabled={busy} className="gap-2 rounded-xl text-[#7C3AED]">
              <Trash2 className="h-4 w-4" />
              {translate("profile.photo.remove")}
            </Button>
          )}
        </div>
        <p className="text-xs font-medium text-cc-muted">
          {translate("profile.photo.hint")}
          {cropCircle ? translate("profile.photo.hintCrop") : ""}
        </p>
      </div>
    </div>
  );
}
