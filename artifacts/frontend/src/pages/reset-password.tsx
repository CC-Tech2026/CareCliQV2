import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function ResetPassword() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const token = useMemo(() => new URLSearchParams(window.location.search).get("token") || "", []);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    if (password !== confirm) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }

    setBusy(true);
    try {
      const res = await fetch("/api/auth/password-reset/confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Could not reset password");
      toast({ title: "Password updated", description: "You can now sign in with your new password." });
      navigate("/login");
    } catch (error) {
      toast({
        title: "Password reset failed",
        description: error instanceof Error ? error.message : "Please request a new reset link.",
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
          <h1 className="text-2xl font-black text-[#5533CC]">Choose a new password</h1>
          <p className="mt-1 text-sm text-[#706083]">Your reset link expires after one hour.</p>
        </div>

        {!token && (
          <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            This reset link is missing a token. Please request a new link.
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} required autoComplete="new-password" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input id="confirm" type="password" value={confirm} onChange={(event) => setConfirm(event.target.value)} required autoComplete="new-password" />
        </div>

        <div className="flex gap-3">
          <Button type="button" variant="outline" className="flex-1" onClick={() => navigate("/login")}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" disabled={busy || !token}>
            {busy ? "Updating..." : "Update password"}
          </Button>
        </div>
      </form>
    </main>
  );
}
