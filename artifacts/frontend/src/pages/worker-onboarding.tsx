import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { BookOpen, Landmark, Loader2, Save, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ProfilePhotoUpload } from "@/components/ProfilePhotoUpload";
import { WorkerOnboardingChecklist } from "@/components/onboarding/WorkerOnboardingChecklist";
import { MyCredentialsCard } from "@/components/onboarding/MyCredentialsCard";
import { useAuth } from "@/contexts/AuthContext";
import { useAccessibility } from "@/contexts/AccessibilityContext";
import {
  completeMyOnboarding,
  getMyOnboarding,
  getMyFinancialDetails,
  updateMyFinancialDetails,
  updateMyOnboarding,
  type ChecklistItem,
  type FinancialDetails,
} from "@/services/onboardingService";

const PLUM = "var(--cc-plum)";
const CORAL = "var(--cc-coral)";

function FinancialDetailsCard() {
  const { toast } = useToast();
  const [details, setDetails] = useState<FinancialDetails>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    getMyFinancialDetails()
      .then((data) => { if (active) setDetails(data); })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  function field(key: keyof FinancialDetails, value: string) {
    setDetails((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await updateMyFinancialDetails(details);
      setDetails(saved);
      toast({ title: "Financial details saved" });
    } catch (error) {
      toast({
        title: "Could not save financial details",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#E8E8EA] bg-white p-5">
        <Loader2 className="h-5 w-5 animate-spin text-[#E8457A]" />
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#E8E8EA] bg-white p-5">
      <div className="mb-4 flex items-center gap-2 text-[#1A1A2E]">
        <Landmark className="h-5 w-5 text-[#E8457A]" />
        <h2 className="font-black">Bank, super &amp; tax details</h2>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Bank account name</Label>
          <Input value={details.bank_account_name ?? ""} onChange={(e) => field("bank_account_name", e.target.value)} className="mt-1 rounded-xl" />
        </div>
        <div>
          <Label>BSB</Label>
          <Input value={details.bank_bsb ?? ""} onChange={(e) => field("bank_bsb", e.target.value)} className="mt-1 rounded-xl" />
        </div>
        <div>
          <Label>Bank account number</Label>
          <Input value={details.bank_account_number ?? ""} onChange={(e) => field("bank_account_number", e.target.value)} className="mt-1 rounded-xl" />
        </div>
        <div>
          <Label>Superannuation fund</Label>
          <Input value={details.super_fund_name ?? ""} onChange={(e) => field("super_fund_name", e.target.value)} className="mt-1 rounded-xl" />
        </div>
        <div>
          <Label>Super member number</Label>
          <Input value={details.super_member_number ?? ""} onChange={(e) => field("super_member_number", e.target.value)} className="mt-1 rounded-xl" />
        </div>
        <div>
          <Label>Tax File Number</Label>
          <Input value={details.tax_file_number ?? ""} onChange={(e) => field("tax_file_number", e.target.value)} className="mt-1 rounded-xl" />
        </div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button onClick={save} disabled={saving} className="gap-2 rounded-xl" style={{ background: "var(--cc-cta)" }}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </Button>
      </div>
    </div>
  );
}

export default function WorkerOnboarding() {
  const [, navigate] = useLocation();
  const { user, updateUser } = useAuth();
  const { toast } = useToast();
  const { translate } = useAccessibility();
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
          title: translate("onboarding.checklistUnavailable"),
          description: error instanceof Error ? error.message : translate("onboarding.checklistRefresh"),
          variant: "destructive",
        });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [toast, translate]);

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
        title: translate("onboarding.saveChecklistFailed"),
        description: error instanceof Error ? error.message : translate("toast.tryAgain"),
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
      toast({
        title: translate("onboarding.complete"),
        description: translate("onboarding.completeDesc"),
      });
      navigate("/dashboard");
    } catch (error) {
      toast({
        title: translate("onboarding.incomplete"),
        description: error instanceof Error ? error.message : translate("onboarding.incompleteHint"),
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
    <div className="grid w-full gap-6 pb-10 lg:grid-cols-[1fr_360px]">
      <div className="space-y-6">
        <div>
          <p className="hidden" style={{ color: CORAL }}>{translate("onboarding.supportWorker")}</p>
          <h1 className="text-xl font-black tracking-tight" style={{ color: "var(--cc-text)" }}>
            {translate("onboarding.title")}
          </h1>
          <p className="mt-2 text-sm text-[#6A6A77]">{translate("onboarding.subtitleLater")}</p>
        </div>
        <WorkerOnboardingChecklist items={items} onToggle={toggleItem} />
        <div className="rounded-2xl border border-[#E8E8EA] bg-white p-5">
          <div className="mb-4 flex items-center gap-2 text-[#1A1A2E]">
            <UserRound className="h-5 w-5 text-[#E8457A]" />
            <h2 className="font-black">{translate("onboarding.profilePhoto")}</h2>
          </div>
          <ProfilePhotoUpload currentUrl={user?.profile_photo_url} />
        </div>
        <FinancialDetailsCard />
        <MyCredentialsCard />
        <Link href="/my-clients" className="block rounded-2xl border border-[#E8E8EA] bg-white p-5 transition hover:bg-[#F8F6FE]">
          <BookOpen className="h-5 w-5 text-[#E8457A]" />
          <p className="mt-3 text-sm font-black text-[#1A1A2E]">{translate("onboarding.reviewClients")}</p>
          <p className="mt-1 text-xs text-[#6A6A77]">{translate("onboarding.reviewClientsHint")}</p>
        </Link>
      </div>
      <aside className="h-fit rounded-[1.5rem] border border-[#E8E8EA] bg-white p-6 shadow-sm">
        <p className="text-xs font-black uppercase tracking-[0.2em] text-[#6A6A77]">{translate("onboarding.progress")}</p>
        <p className="mt-2 text-4xl font-black" style={{ color: PLUM }}>{completeCount}/{items.length}</p>
        <p className="mt-2 text-sm text-[#6A6A77]">{translate("onboarding.progressHint")}</p>
        <Button
          onClick={complete}
          disabled={!allComplete || saving}
          className="mt-5 w-full gap-2 rounded-xl"
          style={{ background: "var(--cc-cta)" }}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {translate("onboarding.confirmReadiness")}
        </Button>
      </aside>
    </div>
  );
}
