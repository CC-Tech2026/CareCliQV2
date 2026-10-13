import { useEffect, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { ChevronRight, Copy } from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { useToast } from "@/hooks/use-toast";
import {
  fetchTreePeople,
  fetchTreeSubfolderDocuments,
  fetchFolderDocuments,
  fetchVaultTree,
  type VaultDocument,
  type VaultTreeFolder,
  type VaultTreePerson,
} from "@/services/vaultService";
import { TreeSubfolderGrid, StatePill, type TreeGridItem } from "./components/TreeSubfolderGrid";
import { TreePeopleList, personHref } from "./components/TreePeopleList";
import { TreeDocumentsPane } from "./components/TreeDocumentsPane";
import { sizeDetails, sizeLabel, useVaultSizes } from "./components/useVaultSizes";
import { useFolderActions } from "./components/useFolderActions";
import { uniqueDocs } from "@/lib/vault-share";
import type { FolderMenuItem } from "./components/FileManager";
import { UserRound } from "lucide-react";

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
  const sizes = useVaultSizes();
  const actions = useFolderActions();
  const topSizes = sizes?.tree[top];
  const personSizes = personId ? sizes?.people[top]?.[personId] : undefined;

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


  /** ⋮ menu for a subfolder card, across everyone or inside one person's folder. */
  function subfolderMenu(
    sub: { key: string; label: string; count: number; category?: string | null },
    href: string,
    owner?: VaultTreePerson,
  ): FolderMenuItem[] {
    const where = [topFolder?.label, owner?.name].filter(Boolean).join(" › ");
    const tally = owner ? sizes?.people[top]?.[owner.id]?.subfolders[sub.key] : sizes?.tree[top]?.subfolders[sub.key];
    return actions.menuFor({
      title: sub.label,
      href,
      path: `Vault › ${where} › ${sub.label}`,
      files: sub.count,
      loadDocuments: () =>
        (sub.category && !owner ? fetchFolderDocuments(sub.category) : fetchTreeSubfolderDocuments(top, sub.key, owner?.id)).then(uniqueDocs),
      details: sizeDetails(tally, !!sizes, sub.count),
    });
  }

  /** ⋮ menu for a person's folder. */
  function personMenu(person: VaultTreePerson): FolderMenuItem[] {
    const gaps = person.subfolders.filter((s) => s.state === "missing" || s.state === "expired");
    const isWorker = top === "staff" && !person.id.startsWith("name:");
    return actions.menuFor(
      {
        title: person.name,
        href: personHref(top, person.id),
        path: `Vault › ${topFolder?.label ?? ""} › ${person.name}`,
        files: person.document_count,
        loadDocuments: () =>
          Promise.all(
            person.subfolders.filter((s) => s.count > 0).map((s) => fetchTreeSubfolderDocuments(top, s.key, person.id)),
          ).then((lists) => uniqueDocs(lists.flat())),
        details: [
          ...sizeDetails(sizes?.people[top]?.[person.id], !!sizes, person.document_count),
          [personNoun === "worker" ? "Employee ID" : "NDIS number", person.ref ?? "Not recorded"],
          ["Status", person.status === "active" ? "Active" : person.status === "exited" ? "Exited" : "Not yet active"],
          ["Missing", gaps.length ? gaps.map((g) => g.label).join(", ") : "Nothing"],
        ],
      },
      {
        shortcuts: isWorker
          ? [{ label: "Open staff profile", icon: UserRound, onSelect: () => navigate(`/md/staff?workerId=${encodeURIComponent(person.id)}`) }]
          : [],
      },
    );
  }
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
        size: sizeLabel(personSizes?.subfolders[s.key], !!sizes),
        menu: subfolderMenu(s, personHref(top, person.id, s.key), person),
      }));
      return <TreeSubfolderGrid items={items} />;
    }

    if (!topFolder) return tree === null && !loadError ? loading : null;

    if (!personNoun) {
      const items: TreeGridItem[] = topFolder.subfolders.map((s) => ({
        ...s,
        href: s.category ? `/md/vault/${s.category}` : `${base}/${s.key}`,
        size: sizeLabel(topSizes?.subfolders[s.key], !!sizes),
        menu: subfolderMenu(s, s.category ? `/md/vault/${s.category}` : `${base}/${s.key}`),
      }));
      return <TreeSubfolderGrid items={items} />;
    }

    return (
      <div className="space-y-4">
        <div className="inline-flex rounded-full border p-1" role="group" aria-label="View" style={{ borderColor: BORDER }}>
          {[
            { label: `By ${personNoun}`, active: !byType, href: base },
            { label: "By type", active: byType, href: `${base}?view=type` },
          ].map((opt) => (
            <button
              key={opt.label}
              type="button"
              aria-pressed={opt.active}
              onClick={() => navigate(opt.href)}
              className="min-h-9 rounded-full px-4 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cc-plum"
              style={opt.active ? { background: TEXT, color: "var(--cc-bg)" } : { color: TEXT }}
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
              size: sizeLabel(topSizes?.subfolders[s.key], !!sizes),
              menu: subfolderMenu(s, `${base}/${s.key}`),
            }))}
          />
        ) : people === null ? (
          loading
        ) : (
          <TreePeopleList
            top={top}
            people={people}
            personNoun={personNoun}
            initialGapsOnly={params.get("gaps") === "1"}
            sizeOf={(id) => sizeLabel(sizes?.people[top]?.[id], !!sizes)}
            menuFor={personMenu}
          />
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
            <h1 className="text-3xl font-semibold tracking-tight" style={{ color: TEXT, fontFamily: "var(--app-font-display)" }}>{title}</h1>
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
      {actions.dialogs}
    </HubLayout>
  );
}
