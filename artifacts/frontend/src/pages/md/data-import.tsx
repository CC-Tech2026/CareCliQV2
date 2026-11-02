import { useMemo, useRef, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { AlertTriangle, ArrowLeft, ArrowRight, Check, Download, FileUp, Loader2, Users, UserPlus } from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { apiFetch } from "@/lib/api-fetch";
import { useToast } from "@/hooks/use-toast";
import { useReAuth } from "@/hooks/useReAuth";

type Kind = "participants" | "staff";
type Step = "upload" | "map" | "review" | "done";
type RowStatus = "ready" | "error" | "duplicate";

type Parsed = { headers: string[]; rows: string[][]; suggested_mapping: Record<string, string | null> };
type RowResult = {
  row: number;
  status: RowStatus;
  errors: string[];
  warnings: string[];
  record: Record<string, string | number | null>;
};

const RED = "#B3261E";

const SOURCES = [
  { value: "spreadsheet", label: "A spreadsheet (Excel, Google Sheets, Numbers)" },
  { value: "shiftcare", label: "ShiftCare" },
  { value: "brevity", label: "Brevity" },
  { value: "supportability", label: "SupportAbility" },
  { value: "lumary", label: "Lumary" },
  { value: "caremaster", label: "CareMaster" },
  { value: "other", label: "Another system" },
];

type FieldDef = { key: string; label: string; required?: boolean; hint?: string };

const FIELDS: Record<Kind, FieldDef[]> = {
  participants: [
    { key: "full_name", label: "Full name", hint: "Or first and last name below" },
    { key: "first_name", label: "First name" },
    { key: "last_name", label: "Last name" },
    { key: "ndis_number", label: "NDIS number", required: true },
    { key: "date_of_birth", label: "Date of birth", required: true, hint: "Day first, e.g. 12/03/1985" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "address", label: "Address" },
    { key: "plan_start_date", label: "Plan start" },
    { key: "plan_end_date", label: "Plan end" },
    { key: "total_budget", label: "Plan budget" },
    { key: "plan_management_type", label: "Plan management", hint: "NDIA, plan or self managed" },
    { key: "primary_disability", label: "Primary disability" },
  ],
  staff: [
    { key: "full_name", label: "Full name", hint: "Or first and last name below" },
    { key: "first_name", label: "First name" },
    { key: "last_name", label: "Last name" },
    { key: "email", label: "Email", required: true },
    { key: "role", label: "Role", hint: "Coordinators and team leaders become coordinators; everyone else a support worker" },
    { key: "phone", label: "Phone" },
  ],
};

const TEMPLATES: Record<Kind, string> = {
  participants:
    "First name,Last name,NDIS number,Date of birth,Email,Phone,Address,Plan start,Plan end,Plan budget,Plan management,Primary disability\n" +
    "Mia,Thompson,430123456,12/03/1985,mia@example.com,0412 345 678,1 Example Street Adelaide SA 5000,01/07/2026,30/06/2027,85000,Plan managed,Autism\n",
  staff: "First name,Last name,Email,Role,Phone\nAva,Lee,ava@example.com,Support worker,0412 000 000\n",
};

const COPY: Record<Kind, { noun: string; plural: string; lands: string; action: (n: number) => string; done: (n: number) => string; next: { label: string; href: string } }> = {
  participants: {
    noun: "participant",
    plural: "participants",
    lands:
      "Participants arrive on your onboarding board with their plan and contact details filled in. Send each one their CareCliQ service agreement to sign, then make them active: nobody is rostered without a signed agreement.",
    action: (n) => `Add ${n} ${n === 1 ? "participant" : "participants"} to onboarding`,
    done: (n) => `${n} ${n === 1 ? "participant is" : "participants are"} on your onboarding board`,
    next: { label: "Open the onboarding board", href: "/onboard-participant" },
  },
  staff: {
    noun: "staff member",
    plural: "staff",
    lands:
      "Each person gets an email invitation to set their password and join your team. Their CareCliQ onboarding (credentials and training) starts when they accept.",
    action: (n) => `Send ${n} ${n === 1 ? "invitation" : "invitations"}`,
    done: (n) => `${n} ${n === 1 ? "invitation was" : "invitations were"} sent`,
    next: { label: "See your team and pending invitations", href: "/settings?section=team" },
  },
};

function downloadCsv(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

async function readError(res: Response, fallback: string) {
  const body = await res.json().catch(() => ({}));
  return typeof body.detail === "string" ? body.detail : fallback;
}

function StatusChip({ status }: { status: RowStatus }) {
  const meta = {
    ready: { label: "Ready", bg: "var(--cc-status-success-bg)", fg: "var(--cc-status-success)" },
    error: { label: "Needs fixing", bg: "color-mix(in srgb, #B3261E 10%, transparent)", fg: RED },
    duplicate: { label: "Duplicate", bg: "var(--cc-soft)", fg: "var(--cc-muted)" },
  }[status];
  return (
    <span className="inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: meta.bg, color: meta.fg }}>
      {meta.label}
    </span>
  );
}

export default function DataImportPage() {
  const [, navigate] = useLocation();
  const search = useSearch();
  const { toast } = useToast();
  const { requireReAuth, modal: reauthModal } = useReAuth();
  const fileRef = useRef<HTMLInputElement>(null);

  const [kind, setKind] = useState<Kind>(() => (new URLSearchParams(search).get("kind") === "staff" ? "staff" : "participants"));
  const [source, setSource] = useState("spreadsheet");
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [results, setResults] = useState<RowResult[]>([]);
  const [filter, setFilter] = useState<RowStatus | "all">("all");
  const [imported, setImported] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);

  const fields = FIELDS[kind];
  const copy = COPY[kind];

  function reset(nextKind: Kind = kind) {
    setKind(nextKind);
    setStep("upload");
    setParsed(null);
    setMapping({});
    setResults([]);
    setFilter("all");
    setFileName("");
    if (fileRef.current) fileRef.current.value = "";
  }

  async function upload(file?: File | null) {
    if (!file || busy) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("kind", kind);
      form.append("file", file);
      const res = await apiFetch("/api/data-import/parse", { method: "POST", body: form });
      if (!res.ok) throw new Error(await readError(res, "Couldn't read that file."));
      const data: Parsed = await res.json();
      setParsed(data);
      setFileName(file.name);
      setMapping(Object.fromEntries(Object.entries(data.suggested_mapping).map(([k, v]) => [k, v ?? ""])));
      setStep("map");
    } catch (err) {
      toast({ title: "Couldn't read the file", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const records = useMemo(() => {
    if (!parsed) return [];
    const index = Object.fromEntries(parsed.headers.map((h, i) => [h, i]));
    return parsed.rows.map((row) =>
      Object.fromEntries(
        Object.entries(mapping)
          .filter(([, header]) => header && header in index)
          .map(([field, header]) => [field, row[index[header]] ?? ""]),
      ),
    );
  }, [parsed, mapping]);

  const hasName = Boolean(mapping.full_name || (mapping.first_name && mapping.last_name));
  const missingRequired = fields.filter((f) => f.required && !mapping[f.key]).map((f) => f.label);
  if (!hasName && kind === "participants") missingRequired.unshift("Name");

  async function runPreview() {
    if (missingRequired.length || busy) return;
    setBusy(true);
    try {
      const res = await apiFetch(`/api/data-import/${kind}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records, source_system: source }),
      });
      if (!res.ok) throw new Error(await readError(res, "Couldn't check the file."));
      setResults((await res.json()).results);
      setFilter("all");
      setStep("review");
    } catch (err) {
      toast({ title: "Couldn't check the file", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function runImport() {
    if (busy) return;
    setBusy(true);
    const send = async () => {
      const res = await apiFetch(`/api/data-import/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ records, source_system: source }),
      });
      if (!res.ok) throw new Error(await readError(res, "The import didn't finish."));
      return res.json() as Promise<{ imported: number; results: RowResult[] }>;
    };
    try {
      const data = kind === "staff" ? await requireReAuth(send) : await send();
      if (!data) return;
      setImported(data.imported);
      setResults(data.results);
      setStep("done");
    } catch (err) {
      toast({ title: "Import didn't finish", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  function downloadProblems() {
    if (!parsed) return;
    const problems = results.filter((r) => r.status === "error");
    const lines = [
      [...parsed.headers, "What to fix"].map(csvCell).join(","),
      ...problems.map((r) => [...parsed.rows[r.row - 1], r.errors.join(" ")].map(csvCell).join(",")),
    ];
    downloadCsv(`fix-these-${kind}.csv`, lines.join("\n") + "\n");
  }

  const counts = {
    ready: results.filter((r) => r.status === "ready").length,
    error: results.filter((r) => r.status === "error").length,
    duplicate: results.filter((r) => r.status === "duplicate").length,
  };
  const shown = filter === "all" ? results : results.filter((r) => r.status === filter);
  const firstRow = parsed?.rows[0];
  const headerIndex = parsed ? Object.fromEntries(parsed.headers.map((h, i) => [h, i])) : {};

  return (
    <HubLayout>
      <div className="mx-auto w-full max-w-4xl space-y-6 pb-12">
        <div>
          <p className="text-[11px] font-black uppercase tracking-[0.2em] text-cc-muted">Move to CareCliQ</p>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-cc-text" style={{ fontFamily: "var(--app-font-display)" }}>
            Bring your records across
          </h1>
          <p className="mt-1 max-w-2xl text-[14px] leading-relaxed text-cc-muted">
            Upload a CSV export of your participants or staff from your previous system. Nothing is saved until you've
            reviewed every row.
          </p>
        </div>

        <div role="tablist" aria-label="What are you importing?" className="inline-flex rounded-xl border border-cc-border bg-cc-surface p-1">
          {([
            ["participants", "Participants", Users],
            ["staff", "Staff", UserPlus],
          ] as const).map(([value, label, Icon]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={kind === value}
              disabled={busy}
              onClick={() => reset(value)}
              className="inline-flex min-h-10 items-center gap-2 rounded-lg px-4 text-[13px] font-bold"
              style={kind === value ? { background: "var(--cc-plum)", color: "#fff" } : { color: "var(--cc-muted)" }}
            >
              <Icon size={15} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>

        {step === "upload" && (
          <section className="rounded-xl border border-cc-border bg-cc-surface">
            <div className="space-y-5 p-5">
              <p className="text-[13px] leading-relaxed text-cc-muted">{copy.lands}</p>

              <label className="block max-w-md">
                <span className="text-[12px] font-bold text-cc-text">Where are your {copy.plural} now?</span>
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className="mt-1.5 h-11 w-full rounded-lg border border-cc-border bg-cc-surface px-3 text-[14px] text-cc-text"
                >
                  {SOURCES.map((s) => (
                    <option key={s.value} value={s.value}>{s.label}</option>
                  ))}
                </select>
                <span className="mt-1.5 block text-[12px] leading-snug text-cc-muted">
                  {source === "spreadsheet"
                    ? "Save it as CSV first: in Excel choose File, Save As, CSV."
                    : `Export your ${kind === "participants" ? "client" : "staff"} list from ${SOURCES.find((s) => s.value === source)?.label ?? "it"} as a CSV file. Any column names work; you'll match them up next.`}
                </span>
              </label>

              <div
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); void upload(e.dataTransfer.files?.[0]); }}
                className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed px-6 py-10 text-center"
                style={{ borderColor: dragging ? "var(--cc-plum)" : "var(--cc-border)", background: dragging ? "var(--cc-plum-subtle)" : "var(--cc-soft)" }}
              >
                <FileUp size={26} className="text-cc-muted" aria-hidden="true" />
                <p className="text-[14px] font-semibold text-cc-text">Drop your CSV here</p>
                <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void upload(e.target.files?.[0])} />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-cc-plum px-5 text-[13px] font-bold text-white disabled:opacity-50"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
                  Choose a file
                </button>
                <p className="text-[12px] text-cc-muted">CSV, up to 5 MB and 2,000 rows</p>
              </div>

              <button
                type="button"
                onClick={() => downloadCsv(`carecliq-${kind}-template.csv`, TEMPLATES[kind])}
                className="inline-flex min-h-11 items-center gap-2 text-[13px] font-bold text-cc-plum"
              >
                <Download size={15} aria-hidden="true" />
                No export? Download a template to fill in
              </button>
            </div>
          </section>
        )}

        {step === "map" && parsed && (
          <section className="rounded-xl border border-cc-border bg-cc-surface">
            <div className="border-b border-cc-border px-5 py-4">
              <h2 className="text-[15px] font-black text-cc-text">Match your columns</h2>
              <p className="mt-0.5 text-[13px] text-cc-muted">
                {fileName} · {parsed.rows.length} {parsed.rows.length === 1 ? "row" : "rows"}. We matched what we could; check each one.
              </p>
            </div>
            <ul className="divide-y divide-cc-border">
              {fields.map((field) => {
                const header = mapping[field.key] ?? "";
                const sample = header && firstRow ? firstRow[headerIndex[header]] : "";
                return (
                  <li key={field.key} className="grid gap-2 px-5 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_minmax(0,1fr)] sm:items-center">
                    <div>
                      <p className="text-[14px] font-bold text-cc-text">
                        {field.label}
                        {field.required ? <span style={{ color: RED }}> *</span> : null}
                      </p>
                      {field.hint ? <p className="text-[12px] leading-snug text-cc-muted">{field.hint}</p> : null}
                    </div>
                    <select
                      aria-label={`Column for ${field.label}`}
                      value={header}
                      onChange={(e) => setMapping((m) => ({ ...m, [field.key]: e.target.value }))}
                      className="h-10 w-full rounded-lg border border-cc-border bg-cc-surface px-3 text-[13px] text-cc-text"
                    >
                      <option value="">Not in my file</option>
                      {parsed.headers.map((h) => (
                        <option key={h} value={h}>{h || "(blank header)"}</option>
                      ))}
                    </select>
                    <p className="truncate text-[12px] text-cc-muted" title={sample}>
                      {sample ? <>e.g. <span className="text-cc-text">{sample}</span></> : null}
                    </p>
                  </li>
                );
              })}
            </ul>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-cc-border px-5 py-4">
              <button type="button" onClick={() => reset()} className="inline-flex min-h-11 items-center gap-2 text-[13px] font-bold text-cc-muted">
                <ArrowLeft size={15} aria-hidden="true" /> Choose another file
              </button>
              <div className="flex flex-wrap items-center gap-3">
                {missingRequired.length ? (
                  <p className="text-[12px] font-semibold" style={{ color: RED }}>Choose a column for {missingRequired.join(", ")}</p>
                ) : null}
                <button
                  type="button"
                  onClick={() => void runPreview()}
                  disabled={busy || missingRequired.length > 0}
                  className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-cc-plum px-5 text-[13px] font-bold text-white disabled:opacity-40"
                >
                  {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
                  Check {parsed.rows.length} {parsed.rows.length === 1 ? "row" : "rows"}
                  <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>
        )}

        {step === "review" && (
          <section className="rounded-xl border border-cc-border bg-cc-surface">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-cc-border px-5 py-4">
              {([
                ["all", `${results.length} rows`],
                ["ready", `${counts.ready} ready`],
                ["error", `${counts.error} need fixing`],
                ["duplicate", `${counts.duplicate} ${counts.duplicate === 1 ? "duplicate" : "duplicates"}`],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  onClick={() => setFilter(value)}
                  className="min-h-9 text-[13px] font-bold"
                  style={{ color: filter === value ? "var(--cc-plum)" : "var(--cc-muted)", textDecoration: filter === value ? "underline" : "none", textUnderlineOffset: 6 }}
                >
                  {label}
                </button>
              ))}
            </div>

            {counts.error > 0 ? (
              <div className="flex flex-wrap items-center gap-3 border-b border-cc-border px-5 py-3 text-[13px] text-cc-text" style={{ background: "var(--cc-soft)" }}>
                <AlertTriangle size={15} className="shrink-0" style={{ color: RED }} aria-hidden="true" />
                <span className="min-w-0 flex-1 basis-56">Rows that need fixing are skipped. Fix them in your file and import it again; rows already brought across won't be duplicated.</span>
                <button type="button" onClick={downloadProblems} className="inline-flex min-h-9 items-center gap-1.5 font-bold text-cc-plum">
                  <Download size={14} aria-hidden="true" /> Download rows to fix
                </button>
              </div>
            ) : null}

            <ul className="max-h-[60vh] divide-y divide-cc-border overflow-y-auto">
              {shown.map((r) => (
                <li key={r.row} className="flex flex-wrap items-start gap-3 px-5 py-3 sm:flex-nowrap">
                  <span className="w-10 shrink-0 pt-0.5 text-[12px] tabular-nums text-cc-muted">#{r.row}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-bold text-cc-text">
                      {String(r.record.full_name || r.record.email || "No name")}
                      {kind === "staff" && r.record.email && r.record.full_name ? (
                        <span className="font-normal text-cc-muted"> · {String(r.record.email)}</span>
                      ) : null}
                      {kind === "staff" && r.status === "ready" ? (
                        <span className="font-normal text-cc-muted"> · {r.record.role === "support_coordinator" ? "Coordinator" : "Support worker"}</span>
                      ) : null}
                    </p>
                    {r.errors.map((e) => (
                      <p key={e} className="text-[12px] leading-snug" style={{ color: r.status === "error" ? RED : "var(--cc-muted)" }}>{e}</p>
                    ))}
                    {r.warnings.map((w) => (
                      <p key={w} className="text-[12px] leading-snug text-cc-muted">{w}</p>
                    ))}
                  </div>
                  <StatusChip status={r.status} />
                </li>
              ))}
              {shown.length === 0 ? <li className="px-5 py-8 text-center text-[13px] text-cc-muted">No rows here.</li> : null}
            </ul>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-cc-border px-5 py-4">
              <button type="button" onClick={() => setStep("map")} className="inline-flex min-h-11 items-center gap-2 text-[13px] font-bold text-cc-muted">
                <ArrowLeft size={15} aria-hidden="true" /> Back to columns
              </button>
              <button
                type="button"
                onClick={() => void runImport()}
                disabled={busy || counts.ready === 0}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-cc-plum px-5 text-[13px] font-bold text-white disabled:opacity-40"
              >
                {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
                {counts.ready === 0 ? "Nothing ready to import" : copy.action(counts.ready)}
              </button>
            </div>
          </section>
        )}

        {step === "done" && (
          <section className="rounded-xl border border-cc-border bg-cc-surface p-6">
            <span className="flex h-11 w-11 items-center justify-center rounded-full" style={{ background: "var(--cc-status-success-bg)", color: "var(--cc-status-success)" }}>
              <Check size={20} strokeWidth={3} aria-hidden="true" />
            </span>
            <h2 className="mt-4 text-lg font-black text-cc-text">{copy.done(imported)}</h2>
            <p className="mt-1 max-w-xl text-[13px] leading-relaxed text-cc-muted">
              {results.length - imported > 0
                ? `${results.length - imported} ${results.length - imported === 1 ? "row was" : "rows were"} skipped. `
                : ""}
              {copy.lands}
            </p>
            <div className="mt-5 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => navigate(copy.next.href)}
                className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-cc-plum px-5 text-[13px] font-bold text-white"
              >
                {copy.next.label} <ArrowRight size={15} aria-hidden="true" />
              </button>
              <button type="button" onClick={() => reset()} className="inline-flex min-h-11 items-center rounded-lg border border-cc-border px-5 text-[13px] font-bold text-cc-text hover:bg-cc-soft">
                Import another file
              </button>
            </div>
          </section>
        )}
      </div>
      {reauthModal}
    </HubLayout>
  );
}
