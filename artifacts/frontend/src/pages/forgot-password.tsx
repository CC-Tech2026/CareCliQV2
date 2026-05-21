import { useState } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ForgotPassword() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setResetUrl(null);
    try {
      const res = await fetch("/api/auth/password-reset/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          redirect_base: window.location.origin,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Could not request password reset");
      setResetUrl(data.reset_url || null);
      toast({ title: "Password reset requested", description: data.message });
    } catch (error) {
      toast({
        title: "Password reset failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-[#F8F5FC] px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-md rounded-2xl bg-white p-8 shadow-sm border border-[#E5DDF4] space-y-5">
        <div>
          <h1 className="text-2xl font-black text-[#5533CC]">Reset password</h1>
          <p className="mt-1 text-sm text-[#706083]">Enter your account email and we will generate a secure reset link.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email address</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
            autoComplete="email"
            placeholder="you@example.com"
          />
        </div>

        {resetUrl && (
          <div className="rounded-xl border border-[#D8D0F0] bg-[#F5F3FC] p-3 text-sm">
            <p className="font-semibold text-[#1E1640]">Development reset link</p>
            <button type="button" className="mt-1 break-all text-left text-[#5533CC] underline" onClick={() => navigate(resetUrl.replace(window.location.origin, ""))}>
              {resetUrl}
            </button>
          </div>
        )}

        <div className="flex gap-3">
          <Button type="button" variant="outline" className="flex-1" onClick={() => navigate("/login")}>
            Back
          </Button>
          <Button type="submit" className="flex-1" disabled={busy || !email.trim()}>
            {busy ? "Sending..." : "Send link"}
          </Button>
        </div>
      </form>
    </main>
  );
}
