import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, UserPlus, AlertTriangle } from "lucide-react";

export default function Credentials() {
  const { toast } = useToast();
  const [members, setMembers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadMembers() {
      setIsLoading(true);
      try {
        const response = await fetch("/api/invitations/members");
        if (!response.ok) throw new Error("Failed to load members");
        const data = await response.json();
        if (!cancelled) setMembers(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error(error);
        toast({ title: "Could not load credential records.", description: "Please refresh or check your permissions.", variant: "destructive" });
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    loadMembers();
    return () => {
      cancelled = true;
    };
  }, [toast]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.25em] text-[#5533CC] font-bold">Credentials & compliance</p>
          <h1 className="mt-2 text-3xl font-black text-[#1E1640]">Worker credential monitoring</h1>
          <p className="mt-2 text-sm text-[#5B4D73] max-w-2xl">
            Track support worker credentials, expiry notice, and update alerts from a coordinator view.
          </p>
        </div>
        <Link href="/settings">
          <Button variant="secondary">Update member details</Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-3xl border border-[#E9E5F5] bg-white p-5 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#7A6A9E] font-bold mb-3">Monitored members</p>
          <p className="text-3xl font-black text-[#1E1640]">{isLoading ? "..." : members.length}</p>
          <p className="mt-2 text-sm text-[#5B4D73]">Active coordinators and support workers in the organisation.</p>
        </div>
        <div className="rounded-3xl border border-[#E9E5F5] bg-white p-5 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#7A6A9E] font-bold mb-3">Expiry alerts</p>
          <p className="text-3xl font-black text-[#1E1640]">{isLoading ? "..." : "N/A"}</p>
          <p className="mt-2 text-sm text-[#5B4D73]">Credential expiry tracking not yet configured in the backend.</p>
        </div>
        <div className="rounded-3xl border border-[#E9E5F5] bg-white p-5 shadow-sm">
          <p className="text-[11px] uppercase tracking-[0.22em] text-[#7A6A9E] font-bold mb-3">Coordinator actions</p>
          <p className="text-3xl font-black text-[#1E1640]">Review</p>
          <p className="mt-2 text-sm text-[#5B4D73]">Use settings to capture credential expiry and licence information centrally.</p>
        </div>
      </div>

      <div className="rounded-[2rem] border border-[#E9E5F5] bg-white shadow-sm overflow-hidden">
        <div className="flex flex-col gap-3 px-6 py-5 border-b border-[#E9E5F5] sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-[#1E1640]">Worker credential overview</h2>
            <p className="text-sm text-[#7A6A9E]">Members and roles. Credential expiry values are available through staff profile configuration.</p>
          </div>
          <Button className="inline-flex items-center gap-2">
            <ShieldCheck size={16} /> Refresh
          </Button>
        </div>

        <div className="divide-y divide-[#F5F3FC]">
          {isLoading ? (
            <div className="p-6 text-sm text-[#7A6A9E]">Loading credentials…</div>
          ) : members.length === 0 ? (
            <div className="p-6 text-sm text-[#7A6A9E]">No organisation members returned. Add your team from Settings.</div>
          ) : (
            members.map((member) => (
              <div key={member.id} className="grid gap-3 px-6 py-4 sm:grid-cols-[1fr_auto] items-center">
                <div>
                  <p className="text-sm font-bold text-[#1E1640]">{member.full_name || member.email}</p>
                  <p className="mt-1 text-sm text-[#7A6A9E]">{member.role?.replace(/_/g, " ") || "Staff"}</p>
                </div>
                <div className="text-right text-sm text-[#5B4D73]">
                  <p className="font-semibold text-[#1E1640]">Expiry status</p>
                  <p className="mt-1">Not configured</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      <div className="rounded-[2rem] border border-[#FFF1C8] bg-[#FFFBF0] p-6">
        <div className="flex items-start gap-3">
          <div className="mt-1 rounded-2xl bg-[#FFEAC0] p-3 text-[#B45309]"><AlertTriangle size={18} /></div>
          <div>
            <p className="text-sm font-bold text-[#1E1640]">Credential tracking is in progress</p>
            <p className="text-sm text-[#6B7280]">For full certificate and licence expiry alerts, add credential metadata to each worker's profile in Settings.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
