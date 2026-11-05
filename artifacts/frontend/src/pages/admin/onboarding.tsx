import { useEffect, useState, type FormEvent } from "react";
import { Link } from "wouter";
import { AdminShell } from "@/components/admin/AdminShell";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { createProviderAccount, listProviderInvitations, resendProviderInvitation, type ProviderInvitation, type ProviderSetupResult } from "@/services/adminService";

export default function AdminOnboardingPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [invites, setInvites] = useState<ProviderInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ProviderSetupResult | null>(null);
  const [copied, setCopied] = useState(false);
  async function refresh() {
    try { setInvites(await listProviderInvitations()); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load invitations."); }
    finally { setLoading(false); }
  }
  useEffect(() => { void refresh(); }, []);
  async function run(action: () => Promise<ProviderSetupResult>) {
    setBusy(true); setError(""); setResult(null); setCopied(false);
    try { setResult(await action()); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not send invitation."); }
    finally { setBusy(false); }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void run(async () => {
      const response = await createProviderAccount(name.trim(), email.trim());
      setName(""); setEmail(""); return response;
    });
  }
  return <AdminShell>
    <div className="space-y-5" style={{ color: "var(--cc-text)" }}>
      <div><h1 className="text-xl font-black">Provider onboarding</h1>
        <p className="text-sm" style={{ color: "var(--cc-muted)" }}>Prepare a client's provider account and email them a secure link to finish setup.</p></div>
      <form onSubmit={submit} className="space-y-4 rounded-2xl border p-5" style={{ background: "var(--cc-surface)", borderColor: "var(--cc-border)" }}>
        <h2 className="font-bold">Create a provider account</h2>
        <p className="text-sm">The owner will verify their email, choose their password and complete their organisation details. This does not start a paid subscription.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-2 text-sm font-medium">Organisation name<Input required maxLength={200} value={name} onChange={e => setName(e.target.value)} /></label>
          <label className="space-y-2 text-sm font-medium">Owner's email<Input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></label>
        </div>
        <Button disabled={busy || !name.trim()} type="submit">{busy ? "Working…" : "Create account & email setup link"}</Button>
      </form>
      {error && <p role="alert" className="rounded-xl border border-red-300 p-4 text-sm text-red-700">{error}</p>}
      {result && <div role="status" className="space-y-3 rounded-2xl border p-5">
        <p className="font-bold">Setup invitation ready</p>
        <p className="text-sm">{result.email_delivery.status === "queued" ? "Email queued for delivery." : result.email_delivery.message}</p>
        <p className="text-sm">You can also copy the secure setup link and share it directly with the account owner.</p>
        <Input aria-label="Secure setup link" readOnly value={result.invite_url} />
        <Button variant="outline" onClick={async () => {
          try { await navigator.clipboard.writeText(result.invite_url); setCopied(true); }
          catch { setError("Could not copy. Select and copy the setup link above."); }
        }}>{copied ? "Copied" : "Copy setup link"}</Button>
      </div>}
      <section className="space-y-3"><h2 className="font-bold">Account setup invitations</h2>
        {loading ? <p>Loading invitations…</p> : invites.length === 0 ? <p className="text-sm">No provider invitations yet.</p> : invites.map(invite => {
          const expired = new Date(invite.expires_at).getTime() < Date.now();
          return <div key={invite.id} className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border p-4" style={{ background: "var(--cc-surface)", borderColor: "var(--cc-border)" }}>
            <div><Link className="font-bold underline" href={`/admin/organizations/${invite.organization_id}`}>{invite.organization_name}</Link>
              <p className="text-sm">{invite.email}</p>
              <p className="mt-1 text-xs" style={{ color: "var(--cc-muted)" }}>{invite.accepted_at ? "Account created" : expired ? "Invitation expired" : "Awaiting account setup"} · {invite.accepted_at ? `Accepted ${new Date(invite.accepted_at).toLocaleDateString()}` : `Expires ${new Date(invite.expires_at).toLocaleDateString()}`}</p></div>
            {!invite.accepted_at && <Button variant="outline" disabled={busy} onClick={() => void run(() => resendProviderInvitation(invite.id))}>{expired ? "Renew & email link" : "Resend setup email"}</Button>}
          </div>;
        })}
      </section>
    </div>
  </AdminShell>;
}
