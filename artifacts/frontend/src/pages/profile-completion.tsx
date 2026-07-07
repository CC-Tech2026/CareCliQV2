import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProfilePhotoUpload } from "@/components/ProfilePhotoUpload";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import { getMe, updateMe, type UserProfile } from "@/services/userService";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";

const DISCIPLINE_OPTIONS = [
  { value: "OT", key: "profileCompletion.discipline.ot" },
  { value: "Physio", key: "profileCompletion.discipline.physio" },
  { value: "Speech", key: "profileCompletion.discipline.speech" },
  { value: "Other", key: "profileCompletion.discipline.other" },
] as const;

export default function ProfileCompletion() {
  const [, navigate] = useLocation();
  const { user, updateUser } = useAuth();
  const { toast } = useToast();
  const { translate } = useAccessibility();
  const [profile, setProfile] = useState<Partial<UserProfile>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const isAllied = user?.role === "allied_health";

  useEffect(() => {
    let active = true;
    getMe()
      .then((data) => {
        if (active) setProfile(data);
      })
      .catch(() => {
        if (active) setProfile({ full_name: user?.full_name || "", email: user?.email || "" });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.email, user?.full_name]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!profile.full_name?.trim() || !profile.phone?.trim()) {
      toast({
        title: translate("profileCompletion.detailsRequired"),
        description: translate("profileCompletion.detailsRequiredDesc"),
        variant: "destructive",
      });
      return;
    }
    if (isAllied && !profile.discipline?.trim()) {
      toast({
        title: translate("profileCompletion.disciplineRequired"),
        description: translate("profileCompletion.disciplineRequiredDesc"),
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const saved = await updateMe({
        ...profile,
        profile_completed: true,
        role_specific_profile_completed: true,
        onboarding_completed: user?.role === "support_worker" ? false : true,
      });
      updateUser({
        full_name: saved.full_name || user?.full_name,
        profile_completed: true,
        role_specific_profile_completed: true,
        onboarding_completed: saved.onboarding_completed ?? (user?.role !== "support_worker"),
        profile_photo_url: saved.profile_photo_url || null,
      });
      toast({ title: translate("profileCompletion.completed") });
      navigate(user?.role === "support_worker" ? "/worker-onboarding" : "/dashboard");
    } catch (error) {
      toast({
        title: translate("profileCompletion.saveFailed"),
        description: error instanceof Error ? error.message : translate("toast.tryAgain"),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-7 w-7 animate-spin text-[#E8457A]" />
        <span className="sr-only">{translate("common.loading")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-10">
      <div>
        <p className="hidden" style={{ color: CORAL }}>
          {isAllied ? translate("profileCompletion.alliedHealth") : translate("profileCompletion.supportWorker")}
        </p>
        <h1 className="text-xl font-black tracking-tight" style={{ color: "var(--cc-text)" }}>
          {translate("profileCompletion.title")}
        </h1>
        <p className="mt-2 text-sm text-[#6A6A77]">{translate("profileCompletion.subtitle")}</p>
      </div>
      <form onSubmit={submit} className="rounded-[1.5rem] border border-[#E8E8EA] bg-white p-6 shadow-sm">
        <div className="mb-6 rounded-2xl bg-[#F4EDE6] p-4">
          <ProfilePhotoUpload currentUrl={profile.profile_photo_url} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>{translate("profileCompletion.fullName")}</Label>
            <Input value={profile.full_name || ""} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} className="mt-1 rounded-xl" />
          </div>
          <div>
            <Label>{translate("profileCompletion.phone")}</Label>
            <Input value={profile.phone || ""} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} className="mt-1 rounded-xl" />
          </div>
          <div>
            <Label>{translate("profileCompletion.suburb")}</Label>
            <Input value={profile.suburb || ""} onChange={(e) => setProfile({ ...profile, suburb: e.target.value })} className="mt-1 rounded-xl" />
          </div>
          <div>
            <Label>{translate("profileCompletion.address")}</Label>
            <Input value={profile.address || ""} onChange={(e) => setProfile({ ...profile, address: e.target.value })} className="mt-1 rounded-xl" />
          </div>
          {isAllied && (
            <>
              <div>
                <Label>{translate("profileCompletion.discipline")}</Label>
                <select
                  title={translate("profileCompletion.discipline")}
                  value={profile.discipline || ""}
                  onChange={(e) => setProfile({ ...profile, discipline: e.target.value })}
                  className="mt-1 h-10 w-full rounded-xl border border-[#E8E8EA] bg-white px-3 text-sm"
                >
                  <option value="">{translate("profileCompletion.selectDiscipline")}</option>
                  {DISCIPLINE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{translate(opt.key)}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>{translate("profileCompletion.ahpra")}</Label>
                <Input value={profile.ahpra_registration_number || ""} onChange={(e) => setProfile({ ...profile, ahpra_registration_number: e.target.value })} className="mt-1 rounded-xl" />
              </div>
              <div>
                <Label>{translate("profileCompletion.businessName")}</Label>
                <Input value={profile.business_name || ""} onChange={(e) => setProfile({ ...profile, business_name: e.target.value })} className="mt-1 rounded-xl" />
              </div>
              <label className="flex items-center gap-2 pt-7 text-sm font-semibold text-[#1A1A2E]">
                <input
                  type="checkbox"
                  checked={!!profile.professional_indemnity_confirmed}
                  onChange={(e) => setProfile({ ...profile, professional_indemnity_confirmed: e.target.checked })}
                />
                {translate("profileCompletion.indemnity")}
              </label>
            </>
          )}
        </div>
        <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl bg-[#F4EDE6] p-4 text-sm text-[#6A6A77]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#E8457A]" />
            <span>
              {isAllied
                ? translate("profileCompletion.roleConfirmedAllied")
                : translate("profileCompletion.roleConfirmedWorker")}
            </span>
          </div>
          <Button disabled={saving} className="gap-2 rounded-xl" style={{ background: "var(--cc-cta)" }}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {translate("profileCompletion.save")}
          </Button>
        </div>
      </form>
    </div>
  );
}
