import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  Heart,
  Landmark,
  Loader2,
  LockKeyhole,
  Save,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ProfilePhotoUpload } from "@/components/ProfilePhotoUpload";
import { WorkerOnboardingChecklist } from "@/components/onboarding/WorkerOnboardingChecklist";
import { MyCredentialsCard } from "@/components/onboarding/MyCredentialsCard";
import { MyInterestsCard } from "@/components/onboarding/MyInterestsCard";
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

function SectionHeader({
  icon: Icon,
  title,
  description,
}: {
  icon: typeof UserRound;
  title: string;
  description: string;
}) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#F8F6FE]">
        <Icon className="h-5 w-5 text-[#E8457A]" />
      </div>
      <div>
        <h2 className="text-base font-black text-[#1A1A2E]">{title}</h2>
        <p className="mt-0.5 text-xs leading-5 text-[#6A6A77]">
          {description}
        </p>
      </div>
    </div>
  );
}

function FinancialDetailsCard() {
  const { toast } = useToast();
  const [details, setDetails] = useState<FinancialDetails>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;

    getMyFinancialDetails()
      .then((data) => {
        if (active) setDetails(data);
      })
      .catch(() => {})
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  function field(key: keyof FinancialDetails, value: string) {
    setDetails((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setSaving(true);

    try {
      const saved = await updateMyFinancialDetails(details);
      setDetails(saved);

      toast({
        title: "Financial details saved",
      });
    } catch (error) {
      toast({
        title: "Could not save financial details",
        description:
          error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="rounded-2xl border border-[#E8E8EA] bg-white p-6">
        <div className="flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin text-[#E8457A]" />
          <p className="text-sm text-[#6A6A77]">
            Loading financial details...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#E8E8EA] bg-white p-6 shadow-sm">
      <div className="mb-5 flex items-start justify-between gap-4">
        <SectionHeader
          icon={Landmark}
          title="Bank, super & tax details"
          description="Keep your payment and employment details up to date."
        />

        <div className="hidden items-center gap-1.5 rounded-full bg-[#F8F6FE] px-3 py-1.5 text-[11px] font-bold text-[#6A6A77] sm:flex">
          <LockKeyhole className="h-3.5 w-3.5" />
          Secure
        </div>
      </div>

      <div className="rounded-xl border border-[#F0EFF2] bg-[#FCFCFD] p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>Bank account name</Label>
            <Input
              value={details.bank_account_name ?? ""}
              onChange={(e) =>
                field("bank_account_name", e.target.value)
              }
              className="mt-1.5 rounded-xl border-[#E4E3E8] bg-white"
            />
          </div>

          <div>
            <Label>BSB</Label>
            <Input
              value={details.bank_bsb ?? ""}
              onChange={(e) => field("bank_bsb", e.target.value)}
              className="mt-1.5 rounded-xl border-[#E4E3E8] bg-white"
            />
          </div>

          <div>
            <Label>Bank account number</Label>
            <Input
              value={details.bank_account_number ?? ""}
              onChange={(e) =>
                field("bank_account_number", e.target.value)
              }
              className="mt-1.5 rounded-xl border-[#E4E3E8] bg-white"
            />
          </div>

          <div>
            <Label>Superannuation fund</Label>
            <Input
              value={details.super_fund_name ?? ""}
              onChange={(e) => field("super_fund_name", e.target.value)}
              className="mt-1.5 rounded-xl border-[#E4E3E8] bg-white"
            />
          </div>

          <div>
            <Label>Super member number</Label>
            <Input
              value={details.super_member_number ?? ""}
              onChange={(e) =>
                field("super_member_number", e.target.value)
              }
              className="mt-1.5 rounded-xl border-[#E4E3E8] bg-white"
            />
          </div>

          <div>
            <Label>Tax File Number</Label>
            <Input
              value={details.tax_file_number ?? ""}
              onChange={(e) =>
                field("tax_file_number", e.target.value)
              }
              className="mt-1.5 rounded-xl border-[#E4E3E8] bg-white"
            />
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-xs text-[#777783]">
          <ShieldCheck className="h-4 w-4 text-[#E8457A]" />
          <span>Your details are securely stored.</span>
        </div>

        <Button
          onClick={save}
          disabled={saving}
          className="gap-2 rounded-xl px-5"
          style={{ background: "var(--cc-cta)" }}
        >
          {saving ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save details
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
          description:
            error instanceof Error
              ? error.message
              : translate("onboarding.checklistRefresh"),
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

  const completeCount = useMemo(
    () => items.filter((item) => item.completed).length,
    [items],
  );

  const allComplete =
    items.length > 0 && completeCount === items.length;

  const progress =
    items.length > 0
      ? Math.round((completeCount / items.length) * 100)
      : 0;

  async function toggleItem(key: string, completed: boolean) {
    const next = items.map((item) =>
      item.key === key ? { ...item, completed } : item,
    );

    setItems(next);

    try {
      const saved = await updateMyOnboarding(next);
      setItems(saved.items);
    } catch (error) {
      toast({
        title: translate("onboarding.saveChecklistFailed"),
        description:
          error instanceof Error
            ? error.message
            : translate("toast.tryAgain"),
        variant: "destructive",
      });
    }
  }

  async function complete() {
    setSaving(true);

    try {
      const saved = await completeMyOnboarding();

      setItems(saved.items);

      updateUser({
        onboarding_completed: true,
        onboarding_complete: true,
      });

      toast({
        title: translate("onboarding.complete"),
        description: translate("onboarding.completeDesc"),
      });

      navigate("/dashboard");
    } catch (error) {
      toast({
        title: translate("onboarding.incomplete"),
        description:
          error instanceof Error
            ? error.message
            : translate("onboarding.incompleteHint"),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-3">
        <Loader2 className="h-7 w-7 animate-spin text-[#E8457A]" />
        <span className="text-sm text-[#6A6A77]">
          {translate("common.loading")}
        </span>
      </div>
    );
  }

  return (
    <div className="w-full pb-10">
      <div className="mb-7 overflow-hidden rounded-[1.5rem] border border-[#E8E8EA] bg-white shadow-sm">
        <div className="relative overflow-hidden p-6 sm:p-8">
          <div className="absolute -right-16 -top-20 h-48 w-48 rounded-full bg-[#F8F6FE]" />
          <div className="absolute -bottom-20 right-20 h-32 w-32 rounded-full bg-[#FFF3F7]" />

          <div className="relative">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-[#F8F6FE] px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-[#6A6A77]">
              <ClipboardList className="h-3.5 w-3.5 text-[#E8457A]" />
              {translate("onboarding.supportWorker")}
            </div>

            <div className="max-w-2xl">
              <h1
                className="text-2xl font-black tracking-tight sm:text-3xl"
                style={{ color: "var(--cc-text)" }}
              >
                {translate("onboarding.title")}
              </h1>

              <p className="mt-2 max-w-xl text-sm leading-6 text-[#6A6A77] sm:text-[15px]">
                {translate("onboarding.subtitleLater")}
              </p>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2 rounded-full border border-[#E8E8EA] bg-white px-3.5 py-2 text-xs font-bold text-[#1A1A2E] shadow-sm">
                <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[#F8F6FE]">
                  <CheckCircle2
                    className="h-3.5 w-3.5"
                    style={{ color: PLUM }}
                  />
                </div>
                {completeCount} of {items.length} complete
              </div>

              <div className="flex items-center gap-2 text-xs font-medium text-[#6A6A77]">
                {allComplete
                  ? "You're ready to get started."
                  : `${items.length - completeCount} ${
                      items.length - completeCount === 1
                        ? "item"
                        : "items"
                    } remaining`}
              </div>
            </div>
          </div>
        </div>

        <div className="h-1.5 w-full bg-[#F0EFF2]">
          <div
            className="h-full rounded-r-full transition-all duration-500"
            style={{
              width: `${progress}%`,
              background: "var(--cc-cta)",
            }}
          />
        </div>
      </div>

      <div className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <div className="rounded-2xl border border-[#E8E8EA] bg-white p-5 shadow-sm sm:p-6">
            <SectionHeader
              icon={ClipboardList}
              title="Getting you ready"
              description="Complete each item before confirming your onboarding."
            />

            <WorkerOnboardingChecklist
              items={items}
              onToggle={toggleItem}
            />

            {allComplete && (
              <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#E6F3EC] bg-[#F5FBF7] p-4">
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#2D8A55]" />
                <div>
                  <p className="text-sm font-black text-[#1A1A2E]">
                    Everything is complete
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-[#607064]">
                    Your onboarding checklist is ready to be confirmed.
                  </p>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[#E8E8EA] bg-white p-5 shadow-sm sm:p-6">
            <SectionHeader
              icon={UserRound}
              title={translate("onboarding.profilePhoto")}
              description="Add a profile photo so your team can recognise you."
            />

            <div className="rounded-xl border border-dashed border-[#DDDCE2] bg-[#FCFCFD] p-5">
              <ProfilePhotoUpload
                currentUrl={user?.profile_photo_url}
              />
            </div>
          </div>

          <FinancialDetailsCard />

          <div className="rounded-2xl border border-[#E8E8EA] bg-white p-5 shadow-sm sm:p-6">
            <SectionHeader
              icon={ShieldCheck}
              title="Credentials"
              description="Review and keep your worker credentials up to date."
            />

            <MyCredentialsCard />
          </div>

          <div className="rounded-2xl border border-[#E8E8EA] bg-white p-5 shadow-sm sm:p-6">
            <SectionHeader
              icon={Heart}
              title="Interests & experience"
              description="Help your coordinator suggest you for shifts you're likely to enjoy."
            />

            <MyInterestsCard />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Link
              href="/worker-induction"
              className="group rounded-2xl border border-[#E8E8EA] bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#DCD9E7] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#E8457A]/20"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F8F6FE]">
                  <ClipboardList className="h-5 w-5 text-[#E8457A]" />
                </div>

                <ArrowRight className="h-4 w-4 text-[#A1A0AA] transition-transform group-hover:translate-x-1" />
              </div>

              <p className="mt-4 text-sm font-black text-[#1A1A2E]">
                Induction
              </p>

              <p className="mt-1 text-xs leading-5 text-[#6A6A77]">
                Complete your first-day checklist and get familiar with
                CareCliQ.
              </p>

              <div className="mt-4 flex items-center gap-1 text-xs font-bold text-[#E8457A]">
                Start induction
                <ChevronRight className="h-3.5 w-3.5" />
              </div>
            </Link>

            <Link
              href="/my-clients"
              className="group rounded-2xl border border-[#E8E8EA] bg-white p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-[#DCD9E7] hover:shadow-md focus:outline-none focus:ring-2 focus:ring-[#E8457A]/20"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#F8F6FE]">
                  <BookOpen className="h-5 w-5 text-[#E8457A]" />
                </div>

                <ArrowRight className="h-4 w-4 text-[#A1A0AA] transition-transform group-hover:translate-x-1" />
              </div>

              <p className="mt-4 text-sm font-black text-[#1A1A2E]">
                {translate("onboarding.reviewClients")}
              </p>

              <p className="mt-1 text-xs leading-5 text-[#6A6A77]">
                {translate("onboarding.reviewClientsHint")}
              </p>

              <div className="mt-4 flex items-center gap-1 text-xs font-bold text-[#E8457A]">
                View clients
                <ChevronRight className="h-3.5 w-3.5" />
              </div>
            </Link>
          </div>
        </div>

        <aside className="h-fit lg:sticky lg:top-6">
          <div className="overflow-hidden rounded-[1.5rem] border border-[#E8E8EA] bg-white shadow-sm">
            <div className="p-6">
              <div className="flex items-center justify-between">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-[#6A6A77]">
                  {translate("onboarding.progress")}
                </p>

                <div
                  className="flex h-9 w-9 items-center justify-center rounded-xl"
                  style={{ background: "var(--cc-plum)" }}
                >
                  <CheckCircle2 className="h-4.5 w-4.5 text-white" />
                </div>
              </div>

              <div className="mt-5 flex items-end gap-2">
                <p
                  className="text-4xl font-black tracking-tight"
                  style={{ color: PLUM }}
                >
                  {progress}%
                </p>

                <p className="mb-1 text-xs font-medium text-[#6A6A77]">
                  complete
                </p>
              </div>

              <div className="mt-4 h-2 overflow-hidden rounded-full bg-[#F0EFF2]">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${progress}%`,
                    background: "var(--cc-cta)",
                  }}
                />
              </div>

              <div className="mt-4 flex items-center justify-between text-xs">
                <span className="font-medium text-[#6A6A77]">
                  {completeCount} completed
                </span>
                <span className="font-bold text-[#1A1A2E]">
                  {items.length} total
                </span>
              </div>

              <div className="my-6 h-px bg-[#ECEBF0]" />

              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      completeCount > 0
                        ? "bg-[#EAF6EF]"
                        : "bg-[#F3F2F5]"
                    }`}
                  >
                    <CheckCircle2
                      className={`h-3.5 w-3.5 ${
                        completeCount > 0
                          ? "text-[#2D8A55]"
                          : "text-[#AAA8B2]"
                      }`}
                    />
                  </div>

                  <div>
                    <p className="text-xs font-bold text-[#1A1A2E]">
                      Complete your checklist
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-[#777783]">
                      Review each required onboarding item.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div
                    className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
                      allComplete
                        ? "bg-[#EAF6EF]"
                        : "bg-[#F3F2F5]"
                    }`}
                  >
                    <ShieldCheck
                      className={`h-3.5 w-3.5 ${
                        allComplete
                          ? "text-[#2D8A55]"
                          : "text-[#AAA8B2]"
                      }`}
                    />
                  </div>

                  <div>
                    <p className="text-xs font-bold text-[#1A1A2E]">
                      Confirm readiness
                    </p>
                    <p className="mt-0.5 text-[11px] leading-4 text-[#777783]">
                      Confirm once everything is complete.
                    </p>
                  </div>
                </div>
              </div>

              <Button
                onClick={complete}
                disabled={!allComplete || saving}
                className="mt-6 w-full gap-2 rounded-xl py-5 font-bold shadow-sm transition-all"
                style={{
                  background: allComplete
                    ? "var(--cc-cta)"
                    : "#E8E7EB",
                  color: allComplete ? "white" : "#9997A1",
                }}
              >
                {saving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}

                {translate("onboarding.confirmReadiness")}
              </Button>

              {!allComplete && (
                <p className="mt-3 text-center text-[11px] leading-4 text-[#888691]">
                  Complete all onboarding items to continue.
                </p>
              )}
            </div>

            <div className="border-t border-[#ECEBF0] bg-[#FCFCFD] px-6 py-4">
              <div className="flex items-center gap-2 text-[11px] text-[#777783]">
                <LockKeyhole className="h-3.5 w-3.5" />
                <span>Your onboarding information is securely handled.</span>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}