import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Loader2, Save, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProfilePhotoUpload } from "@/components/ProfilePhotoUpload";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { getMe, updateMe, type UserProfile } from "@/services/userService";

const PLUM = "#5533CC";
const CORAL = "#F03060";

export default function ProfileCompletion() {
  const [, navigate] = useLocation();
  const { user, updateUser } = useAuth();
  const { toast } = useToast();
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
      toast({ title: "Profile details required", description: "Full name and phone are required.", variant: "destructive" });
      return;
    }
    if (isAllied && !profile.discipline?.trim()) {
      toast({ title: "Discipline required", description: "Choose your allied health discipline.", variant: "destructive" });
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
      toast({ title: "Profile completed" });
      navigate(user?.role === "support_worker" ? "/worker-onboarding" : "/dashboard");
    } catch (error) {
      toast({
        title: "Could not save profile",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-[#5533CC]" /></div>;
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-10">
      <div>
        <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>
          {isAllied ? "Allied Health" : "Support Worker"}
        </p>
        <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>Complete your profile</h1>
        <p className="mt-2 text-sm text-[#7A6A9E]">These details are stored on your secure CareCliQ profile and used in compliance records.</p>
      </div>
      <form onSubmit={submit} className="rounded-[1.5rem] border border-[#E2DEF2] bg-white p-6 shadow-sm">
        <div className="mb-6 rounded-2xl bg-[#F5F3FC] p-4">
          <ProfilePhotoUpload currentUrl={profile.profile_photo_url} />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <Label>Full name</Label>
            <Input value={profile.full_name || ""} onChange={(e) => setProfile({ ...profile, full_name: e.target.value })} className="mt-1 rounded-xl" />
          </div>
          <div>
            <Label>Phone</Label>
            <Input value={profile.phone || ""} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} className="mt-1 rounded-xl" />
          </div>
          <div>
            <Label>Suburb</Label>
            <Input value={profile.suburb || ""} onChange={(e) => setProfile({ ...profile, suburb: e.target.value })} className="mt-1 rounded-xl" />
          </div>
          <div>
            <Label>Address</Label>
            <Input value={profile.address || ""} onChange={(e) => setProfile({ ...profile, address: e.target.value })} className="mt-1 rounded-xl" />
          </div>
          {isAllied && (
            <>
              <div>
                <Label>Discipline</Label>
                <select
                  value={profile.discipline || ""}
                  onChange={(e) => setProfile({ ...profile, discipline: e.target.value })}
                  className="mt-1 h-10 w-full rounded-xl border border-[#E2DEF2] bg-white px-3 text-sm"
                >
                  <option value="">Select discipline</option>
                  <option value="OT">OT</option>
                  <option value="Physio">Physio</option>
                  <option value="Speech">Speech</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <Label>AHPRA registration number</Label>
                <Input value={profile.ahpra_registration_number || ""} onChange={(e) => setProfile({ ...profile, ahpra_registration_number: e.target.value })} className="mt-1 rounded-xl" />
              </div>
              <div>
                <Label>Business / trading name</Label>
                <Input value={profile.business_name || ""} onChange={(e) => setProfile({ ...profile, business_name: e.target.value })} className="mt-1 rounded-xl" />
              </div>
              <label className="flex items-center gap-2 pt-7 text-sm font-semibold text-[#1E1640]">
                <input
                  type="checkbox"
                  checked={!!profile.professional_indemnity_confirmed}
                  onChange={(e) => setProfile({ ...profile, professional_indemnity_confirmed: e.target.checked })}
                />
                Professional indemnity insurance confirmed
              </label>
            </>
          )}
        </div>
        <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl bg-[#F5F3FC] p-4 text-sm text-[#7A6A9E]">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#5533CC]" />
            <span>Role confirmed as {isAllied ? "Allied Health Professional" : "Support Worker"}.</span>
          </div>
          <Button disabled={saving} className="gap-2 rounded-xl" style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Save profile
          </Button>
        </div>
      </form>
    </div>
  );
}
