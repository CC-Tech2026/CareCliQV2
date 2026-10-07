import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { ChevronRight, Copy } from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { useToast } from "@/hooks/use-toast";
import {
  fetchTreePeople,
  fetchTreeSubfolderDocuments,
  fetchVaultTree,
  type VaultDocument,
  type VaultTreeFolder,
  type VaultTreePerson,
} from "@/services/vaultService";
import { TreeSubfolderGrid, StatePill, type TreeGridItem } from "./components/TreeSubfolderGrid";
import { TreePeopleList, personHref } from "./components/TreePeopleList";
import { TreeDocumentsPane } from "./components/TreeDocumentsPane";

const TEXT = "var(--cc-text)";
const MUTED = "var(--cc-muted)";
const BORDER = "var(--cc-border)";
const SURFACE = "var(--cc-surface)";

const PERSON_NOUN: Record<string, string> = { participant: "participant", staff: "worker" };

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export default function VaultTreeFolderPage({
  top,
  sub,
  personId: rawPersonId,
}: {
  top: string;
  sub?: string;
  personId?: string;
}) {
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const params = new URLSearchParams(useSearch());
  const byType = params.get("view") === "type";
  const personId = rawPersonId ? safeDecode(rawPersonId) : undefined;
  const personNoun = PERSON_NOUN[top];

  const [tree, setTree] = useState<VaultTreeFolder[] | null>(null);
  const [people, setPeople] = useState<VaultTreePerson[] | null>(null);
  const [documents, setDocuments] = useState<VaultDocument[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchVaultTree()
      .then((folders) => { if (!cancelled) setTree(folders); })
      .catch((e) => { if (!cancelled) setLoadError(e instanceof Error ? e.message : "Could not load the vault."); });
    return () => { cancelled = true; };
  }, []);

  const needsPeople = Boolean(personNoun) && (Boolean(personId) || (!sub && !byType));
  useEffect(() => {
    if (!needsPeople) return;
    let cancelled = false;
    fetchTreePeople(top)
      .then((rows) => { if (!cancelled) setPeople(rows); })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Could not load this folder.");
        setPeople([]);
      });
    return () => { cancelled = true; };
  }, [top, needsPeople]);

  useEffect(() => {
    if (!sub) return;
    let cancelled = false;
    setDocuments(null);
    fetchTreeSubfolderDocuments(top, sub, personId)
      .then((docs) => { if (!cancelled) setDocuments(docs); })
      .catch((e) => {
        if (cancelled) return;
        setLoadError(e instanceof Error ? e.message : "Could not load these documents.");
        setDocuments([]);
      });
    return () => { cancelled = true; };
  }, [top, sub, personId]);

  const topFolder = tree?.find((f) => f.key === top);
  const person = personId ? people?.find((p) => p.id === personId) : undefined;
  const subLabel = topFolder?.subfolders.find((s) => s.key === sub)?.label ?? "";
  const personSub = person?.subfolders.find((s) => s.key === sub);
  const base = `/md/vault/tree/${top}`;

  const crumbs: { label: string; href?: string }[] = [{ label: "Vault", href: "/md/vault" }];
  if (topFolder) crumbs.push({ label: topFolder.label, href: sub && !personId && personNoun ? `${base}?view=type` : base });
  if (personId) crumbs.push({ label: person?.name ?? "", href: personHref(top, personId) });
  if (sub && subLabel) crumbs.push({ label: subLabel });
  const path = crumbs.map((c) => c.label).filter(Boolean).join(" › ");
  const title = sub ? subLabel : personId ? person?.name ?? "" : topFolder?.label ?? "";

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(path);
      toast({ title: "Path copied", description: path });
    } catch {
      toast({ title: "Couldn't copy the path", variant: "destructive" });
    }
  }

  const loading = <p className="text-[13px]" style={{ color: MUTED }}>Loading…</p>;
  const emptyBox = (text: string) => (
    <p className="rounded-2xl border p-6 text-center text-[13px]" style={{ borderColor: BORDER, background: SURFACE, color: MUTED }}>
      {text}
    </p>
  );

  function body() {
    if (sub) {
      if (documents === null) return loading;
      if (documents.length > 0) {
        return <TreeDocumentsPane documents={documents} targetDescription={path} />;
      }
      if (personSub && (personSub.state === "missing" || personSub.state === "expired")) {
        return emptyBox(
          personSub.missing.length
            ? `Nothing current on file for ${person?.name}: ${personSub.missing.join(", ")}.`
            : `Nothing current on file. This folder is required for ${person?.name}.`
        );
      }
      return emptyBox("No documents in this folder yet.");
    }

    if (personId) {
      if (people === null) return loading;
      if (!person) return emptyBox(`This ${personNoun} has no folder in the vault.`);
      const items: TreeGridItem[] = person.subfolders.map((s) => ({
        ...s,
        href: personHref(top, person.id, s.key),
      }));
      return <TreeSubfolderGrid items={items} />;
    }

    if (!topFolder) return tree === null && !loadError ? loading : null;

    if (!personNoun) {
      const items: TreeGridItem[] = topFolder.subfolders.map((s) => ({
        ...s,
        href: s.category ? `/md/vault/${s.category}` : `${base}/${s.key}`,
      }));
      return <TreeSubfolderGrid items={items} />;
    }

    return (
      <div className="space-y-4">
        <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="View" style={{ borderColor: BORDER, background: SURFACE }}>
          {[
            { label: `By ${personNoun}`, active: !byType, href: base },
            { label: "By type", active: byType, href: `${base}?view=type` },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              aria-pressed={opt.active}
              onClick={() => navigate(opt.href)}
              className="rounded-md px-3 py-1.5 text-[13px] font-semibold"
              style={opt.active ? { background: "var(--cc-plum-soft)", color: "var(--cc-plum)" } : { color: MUTED }}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {byType ? (
          <TreeSubfolderGrid
            items={topFolder.subfolders.map((s) => ({
              ...s,
              href: `${base}/${s.key}`,
              gapLabel: s.gap_count ? `${s.gap_count} missing` : undefined,
            }))}
          />
        ) : people === null ? (
          loading
        ) : (
          <TreePeopleList top={top} people={people} personNoun={personNoun} initialGapsOnly={params.get("gaps") === "1"} />
        )}
      </div>
    );
  }

  return (
    <HubLayout>
      <div className="space-y-6 pb-12">
        <div className="flex flex-wrap items-center gap-2">
          <nav aria-label="Folder path" className="flex flex-wrap items-center gap-1.5 text-[13px] font-semibold" style={{ color: MUTED }}>
            {crumbs.map((c, i) => (
              <span key={i} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight size={14} />}
                {c.href && i < crumbs.length - 1 ? (
                  <Link href={c.href} className="hover:underline">{c.label}</Link>
                ) : (
                  <span style={{ color: TEXT }}>{c.label}</span>
                )}
              </span>
            ))}
          </nav>
          {crumbs.length > 1 && (
            <button
              type="button"
              onClick={copyPath}
              aria-label="Copy folder path"
              title="Copy folder path"
              className="rounded-md p-1 hover:bg-black/5"
              style={{ color: MUTED }}
            >
              <Copy size={14} />
            </button>
          )}
        </div>

        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold tracking-[-0.025em]" style={{ color: TEXT }}>{title}</h1>
            {personSub && <StatePill state={personSub.state} />}
          </div>
          {personId && person && !sub && (
            <p className="text-[13px]" style={{ color: MUTED }}>
              {[person.ref, person.status === "active" ? null : person.status === "exited" ? "Exited" : "Not yet active",
                `${person.document_count} ${person.document_count === 1 ? "document" : "documents"}`]
                .filter(Boolean).join(" · ")}
            </p>
          )}
          {sub && !personId && personNoun && (
            <p className="text-[13px]" style={{ color: MUTED }}>Every {personNoun}'s documents in this folder.</p>
          )}
        </div>

        {loadError && (
          <p className="text-[13px] font-semibold" style={{ color: "#9A5B0A" }}>{loadError}</p>
        )}

        {body()}
      </div>
    </HubLayout>
  );
}
