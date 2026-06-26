import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { BookOpen, CheckCircle2, Loader2, Save, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ProfilePhotoUpload } from "@/components/ProfilePhotoUpload";
import { WorkerOnboardingChecklist } from "@/components/onboarding/WorkerOnboardingChecklist";
import { useAuth } from "@/contexts/AuthContext";
import { BORDER, CORAL, MUTED, PLUM, SOFT, TEXT } from "@/lib/shift-utils";
import {
  completeMyOnboarding,
  getMyOnboarding,
  updateMyOnboarding,
  type ChecklistItem,
} from "@/services/onboardingService";


export default function WorkerOnboarding() {
  const [, navigate] = useLocation();
  const { user, updateUser } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<ChecklistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getMyOnboarding()
      .then((data) => {
        if (active) setItems(data.items);
      })
      .catch((error) => {
        toast({
          title: "Checklist unavailable",
          description: error instanceof Error ? error.message : "Please refresh.",
          variant: "destructive",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast]);

  const completeCount = useMemo(() => items.filter((item) => item.completed).length, [items]);
  const allComplete = items.length > 0 && completeCount === items.length;

  async function toggleItem(key: string, completed: boolean) {
    const next = items.map((item) => item.key === key ? { ...item, completed } : item);
    setItems(next);
    try {
      const saved = await updateMyOnboarding(next);
      setItems(saved.items);
    } catch (error) {
      toast({
        title: "Could not save checklist",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function complete() {
    setSaving(true);
    try {
      const saved = await completeMyOnboarding();
      setItems(saved.items);
      updateUser({ onboarding_completed: true, onboarding_complete: true });
      toast({ title: "Onboarding complete", description: "You are ready to use your assigned client workspace." });
      navigate("/dashboard");
    } catch (error) {
      toast({
        title: "Checklist still incomplete",
        description: error instanceof Error ? error.message : "Complete every item first.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-7 w-7 animate-spin text-cc-plum" /></div>;
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-6 pb-10 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: CORAL }}>Support Worker</p>
          <h1 className="mt-1 text-3xl font-black tracking-tight" style={{ color: PLUM }}>First-login checklist</h1>
          <p className="mt-2 text-sm text-cc-muted">Finish these steps now or continue from your dashboard later.</p>
        </div>
        <WorkerOnboardingChecklist items={items} onToggle={toggleItem} />
        <div className="rounded-2xl border border-cc-border bg-cc-surface p-5">
          <div className="mb-4 flex items-center gap-2 text-cc-text">
            <UserRound className="h-5 w-5 text-cc-plum" />
            <h2 className="font-black">Profile photo</h2>
          </div>
          <ProfilePhotoUpload currentUrl={user?.profile_photo_url} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Link href="/credentials" className="rounded-2xl border border-cc-border bg-cc-surface p-5 transition hover:bg-cc-bg">
            <CheckCircle2 className="h-5 w-5 text-cc-plum" />
            <p className="mt-3 text-sm font-black text-cc-text">Add credential wallet items</p>
            <p className="mt-1 text-xs text-cc-muted">Upload NDIS screening, first aid, CPR, police check, and other required documents.</p>
          </Link>
          <Link href="/my-clients" className="rounded-2xl border border-cc-border bg-cc-surface p-5 transition hover:bg-cc-bg">
            <BookOpen className="h-5 w-5 text-cc-plum" />
            <p className="mt-3 text-sm font-black text-cc-text">Review assigned clients</p>
            <p className="mt-1 text-xs text-cc-muted">Client records are scoped to your assignments only.</p>
          </Link>
        </div>
      </div>
      <aside className="h-fit rounded-[1.5rem] border border-cc-border bg-cc-surface p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-cc-muted">Progress</p>
        <p className="mt-2 text-4xl font-black" style={{ color: PLUM }}>{completeCount}/{items.length}</p>
        <p className="mt-2 text-sm text-cc-muted">Coordinator can see this onboarding status on the Team page.</p>
        <Button
          onClick={complete}
          disabled={!allComplete || saving}
          className="mt-5 w-full gap-2 rounded-xl"
          style={{ background: `linear-gradient(135deg, ${CORAL}, ${PLUM})` }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Confirm readiness
        </Button>
      </aside>
    </div>
  );
}
