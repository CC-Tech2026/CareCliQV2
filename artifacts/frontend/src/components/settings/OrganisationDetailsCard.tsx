import { useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, Loader2 } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useOrgQuery } from "@/hooks/useOrgQuery";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api-fetch";

export type OrganisationDetails = {
  name: string | null;
  legal_name: string | null;
  abn: string | null;
  ndis_registration_number: string | null;
  address: string | null;
  phone: string | null;
  email: string | null;
};

type Form = Record<"legal_name" | "abn" | "ndis_registration_number" | "address" | "phone" | "email", string>;

const EMPTY: Form = { legal_name: "", abn: "", ndis_registration_number: "", address: "", phone: "", email: "" };
export const ORGANISATION_DETAILS_KEY = ["settings", "organisation"] as const;

/** The ATO checksum — same rule the server applies. */
export function abnIsValid(value: string): boolean {
  const digits = value.replace(/\s/g, "");
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const total = digits.split("").reduce((sum, d, i) => sum + (Number(d) - (i === 0 ? 1 : 0)) * weights[i], 0);
  return total % 89 === 0;
}

export function formatAbn(value: string): string {
  const d = value.replace(/\D/g, "").slice(0, 11);
  return [d.slice(0, 2), d.slice(2, 5), d.slice(5, 8), d.slice(8, 11)].filter(Boolean).join(" ");
}

const registrationValid = (value: string) => /^\d{9,10}$/.test(value.replace(/\s/g, ""));

function toForm(d?: OrganisationDetails | null): Form {
  if (!d) return EMPTY;
  return {
    legal_name: d.legal_name ?? "",
    abn: d.abn ? formatAbn(d.abn) : "",
    ndis_registration_number: d.ndis_registration_number ?? "",
    address: d.address ?? "",
    phone: d.phone ?? "",
    email: d.email ?? "",
  };
}

function Ready({ ok, label, missing }: { ok: boolean; label: string; missing: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold"
      style={{
        background: ok ? "var(--cc-status-success-bg)" : "var(--cc-status-warning-bg)",
        color: ok ? "var(--cc-status-success)" : "var(--cc-status-warning)",
      }}
      title={ok ? undefined : missing}
    >
      {ok ? <Check size={12} strokeWidth={3} /> : <CircleAlert size={12} />}
      {label}
      {!ok && <span className="font-normal">· {missing}</span>}
    </span>
  );
}

/** The organisation's business details — the ones printed on invoices and
 * service agreements and sent in NDIA claim files. Only the managing
 * director can change them; everyone else sees them read-only.
 *
 * `profileAbn`: an ABN saved on the user's own profile under the old
 * Settings form (which never reached documents) — offered as a one-click
 * fill when the organisation has none. */
export function OrganisationDetailsCard({ profileAbn }: { profileAbn?: string | null }) {
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = user?.role === "managing_director";
  const query = useOrgQuery<OrganisationDetails>([...ORGANISATION_DETAILS_KEY], {
    queryFn: async () => {
      const res = await apiFetch("/api/settings/organisation");
      if (!res.ok) throw new Error("Couldn't load organisation details.");
      return res.json();
    },
  });
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const saved = useMemo(() => toForm(query.data), [query.data]);
  useEffect(() => setForm(saved), [saved]);

  const set = (key: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: key === "abn" ? formatAbn(e.target.value) : e.target.value }));
  const dirty = (Object.keys(form) as Array<keyof Form>).some((k) => form[k].trim() !== saved[k].trim());

  const abnDigits = form.abn.replace(/\s/g, "");
  const abnError = abnDigits.length === 11 && !abnIsValid(form.abn) ? "This ABN doesn't pass the ATO check — check the digits." : null;
  const regDigits = form.ndis_registration_number.replace(/\s/g, "");
  const regError = regDigits && !registrationValid(regDigits) ? "9 or 10 digits, usually starting with 405." : null;
  const emailError = form.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.email.trim()) ? "Enter a valid email." : null;
  const nameError = !form.legal_name.trim() ? "Required." : null;
  const incompleteAbn = abnDigits.length > 0 && abnDigits.length < 11;
  const blocked = Boolean(abnError || regError || emailError || nameError || incompleteAbn);

  const save = async () => {
    if (blocked) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/settings/organisation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          legal_name: form.legal_name.trim(),
          abn: abnDigits || null,
          ndis_registration_number: regDigits || null,
          address: form.address.trim() || null,
          phone: form.phone.trim() || null,
          email: form.email.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(typeof body.detail === "string" ? body.detail : "Couldn't save.");
      }
      queryClient.setQueryData([user?.organizationId ?? "__no_org__", ...ORGANISATION_DETAILS_KEY], await res.json());
      toast({ title: "Organisation details saved", description: "New invoices, agreements and NDIA claims will use them." });
    } catch (err) {
      toast({ title: "Not saved", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (query.isLoading) {
    return <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-cc-muted" /></div>;
  }
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-cc-text">
        Organisation details couldn't be loaded.{" "}
        <button type="button" className="font-semibold underline" onClick={() => void query.refetch()}>Try again</button>
      </p>
    );
  }

  const field = (key: keyof Form, label: string, opts: { hint?: string; error?: string | null; placeholder?: string; type?: string; wide?: boolean; inputMode?: "numeric" | "email" | "tel" } = {}) => (
    <div className={opts.wide ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <Label htmlFor={`org-${key}`} className="text-[12px] font-medium" style={{ color: "var(--cc-text)" }}>{label}</Label>
      <Input
        id={`org-${key}`}
        value={form[key]}
        onChange={set(key)}
        readOnly={!canEdit}
        type={opts.type}
        inputMode={opts.inputMode}
        placeholder={canEdit ? opts.placeholder : "Not set"}
        aria-invalid={Boolean(opts.error)}
        aria-describedby={opts.error || opts.hint ? `org-${key}-help` : undefined}
        className="rounded-lg"
        style={opts.error ? { borderColor: "var(--cc-status-danger)" } : undefined}
      />
      {(opts.error || opts.hint) && (
        <p id={`org-${key}-help`} className="text-[11px]" style={{ color: opts.error ? "var(--cc-status-danger)" : "var(--cc-muted)" }}>
          {opts.error ?? opts.hint}
        </p>
      )}
    </div>
  );

  const hasAbn = abnIsValid(saved.abn);
  const hasRegistration = registrationValid(saved.ndis_registration_number);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <Ready ok={hasAbn} label="Invoices" missing="add your ABN" />
        <Ready ok={hasAbn} label="Service agreements" missing="add your ABN" />
        <Ready ok={hasRegistration} label="NDIA claims" missing="add your NDIS registration number" />
      </div>

      {canEdit && !saved.abn && profileAbn && abnIsValid(profileAbn) && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg p-3 text-[13px]" style={{ background: "var(--cc-soft)" }}>
          <span style={{ color: "var(--cc-text)" }}>
            Your profile has ABN {formatAbn(profileAbn)}, but it was never saved to the organisation.
          </span>
          <Button size="sm" variant="outline" className="rounded-lg" onClick={() => setForm((f) => ({ ...f, abn: formatAbn(profileAbn) }))}>
            Use it
          </Button>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {field("legal_name", "Legal business name", { error: canEdit ? nameError : null, placeholder: "e.g. Sunrise Support Services Pty Ltd", wide: true })}
        {field("abn", "ABN", {
          error: abnError,
          hint: abnDigits.length === 11 && !abnError ? "Valid ABN" : incompleteAbn ? `${11 - abnDigits.length} more digit${11 - abnDigits.length === 1 ? "" : "s"}` : "Printed on invoices and agreements.",
          placeholder: "51 824 753 556",
          inputMode: "numeric",
        })}
        {field("ndis_registration_number", "NDIS registration number", {
          error: regError,
          hint: "From your NDIS Commission certificate. Required for NDIA bulk claims.",
          placeholder: "4050012345",
          inputMode: "numeric",
        })}
        {field("email", "Accounts email", { error: emailError, placeholder: "accounts@example.com.au", type: "email", inputMode: "email" })}
        {field("phone", "Phone", { placeholder: "08 8123 4567", inputMode: "tel" })}
        {field("address", "Business address", { placeholder: "Street, suburb, state, postcode", wide: true })}
      </div>

      {!canEdit && (
        <p className="text-[12px]" style={{ color: "var(--cc-muted)" }}>Only the managing director can change these.</p>
      )}
      {canEdit && dirty && (
        <div className="flex justify-end gap-2">
          <Button variant="outline" className="rounded-lg" onClick={() => setForm(saved)} disabled={saving}>Cancel</Button>
          <Button className="rounded-lg" onClick={save} disabled={saving || blocked}>{saving ? "Saving…" : "Save details"}</Button>
        </div>
      )}
    </div>
  );
}
