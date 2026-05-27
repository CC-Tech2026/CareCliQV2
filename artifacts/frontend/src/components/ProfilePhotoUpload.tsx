import { useRef, useState } from "react";
import { Camera, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { deleteProfilePhoto, uploadProfilePhoto } from "@/services/userService";

const ALLOWED = ["image/jpeg", "image/png", "image/webp"];

export function ProfilePhotoUpload({ currentUrl }: { currentUrl?: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user, updateUser } = useAuth();
  const [preview, setPreview] = useState(currentUrl || user?.profile_photo_url || "");
  const [busy, setBusy] = useState(false);

  async function handleFile(file?: File) {
    if (!file) return;
    if (!ALLOWED.includes(file.type)) {
      toast({ title: "Unsupported image", description: "Upload JPG, PNG, or WebP.", variant: "destructive" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Profile photos must be 5MB or smaller.", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      setPreview(URL.createObjectURL(file));
      const profile = await uploadProfilePhoto(file);
      setPreview(profile.profile_photo_url || "");
      updateUser({ profile_photo_url: profile.profile_photo_url || null });
      toast({ title: "Profile photo saved" });
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "Please try another image.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto() {
    setBusy(true);
    try {
      const profile = await deleteProfilePhoto();
      setPreview("");
      updateUser({ profile_photo_url: profile.profile_photo_url || null });
      toast({ title: "Profile photo removed" });
    } catch (error) {
      toast({
        title: "Remove failed",
        description: error instanceof Error ? error.message : "Please try again.",
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
      <div className="h-24 w-24 overflow-hidden rounded-full border border-[#E2DEF2] bg-[#F5F3FC]">
        {preview ? (
          <img src={preview} alt="Profile" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xl font-black text-[#5533CC]">
            {initials}
          </div>
        )}
      </div>
      <div className="space-y-3">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
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
            {preview ? "Replace photo" : "Upload photo"}
          </Button>
          {preview && (
            <Button type="button" variant="ghost" onClick={removePhoto} disabled={busy} className="gap-2 rounded-xl text-[#F03060]">
              <Trash2 className="h-4 w-4" />
              Remove
            </Button>
          )}
        </div>
        <p className="text-xs font-medium text-[#7A6A9E]">JPG, PNG, or WebP. Maximum 5MB.</p>
      </div>
    </div>
  );
}
