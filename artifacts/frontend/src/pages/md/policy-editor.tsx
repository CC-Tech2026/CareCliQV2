import { useEffect, useMemo, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { FileText, Loader2, Plus, Send, Save, Users, X } from "lucide-react";
import { HubLayout } from "@/components/layout/HubLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  createDocumentTemplate,
  createPolicyDocument,
  fetchDocumentTemplates,
  fetchPolicyAcknowledgementStatus,
  fetchPolicyDocument,
  fetchPolicyDocuments,
  fetchVaultFolders,
  publishPolicyDocument,
  updatePolicyDocument,
  type DocumentTemplate,
  type PolicyAcknowledgementStatus,
  type PolicyDocument,
  type VaultFolder,
} from "@/services/vaultService";

export default function PolicyEditorPage() {
  const { toast } = useToast();
  const [documents, setDocuments] = useState<PolicyDocument[]>([]);
  const [folders, setFolders] = useState<VaultFolder[]>([]);
  const [status, setStatus] = useState<PolicyAcknowledgementStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  async function loadAll() {
    setLoading(true);
    try {
      const [docs, govFolders, ackStatus] = await Promise.all([
        fetchPolicyDocuments(),
        fetchVaultFolders(),
        fetchPolicyAcknowledgementStatus().catch(() => []),
      ]);
      setDocuments(docs);
      setFolders(govFolders.filter((f) => f.group === "governance"));
      setStatus(ackStatus);
    } catch (err) {
      toast({ title: "Could not load policy documents", description: (err as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDoc = documents.find((d) => d.id === openId) ?? null;

  async function handleCreate(folderKey: string, title: string) {
    setCreating(true);
    try {
      const doc = await createPolicyDocument({ folderKey, title });
      setDocuments((prev) => [doc, ...prev]);
      setOpenId(doc.id);
    } catch (err) {
      toast({ title: "Could not create document", description: (err as Error).message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <HubLayout>
      <div className="space-y-5 p-6">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: "var(--cc-plum)" }}>
              Documents & Audit Vault
            </p>
            <h1 className="mt-1 text-2xl font-black tracking-tight" style={{ color: "var(--cc-text)" }}>
              Policy editor
            </h1>
            <p className="mt-1 text-sm font-medium" style={{ color: "var(--cc-muted)" }}>
              Write policy documents in-app using your own branded template, then publish them into the vault —
              workers you mark "visible" can read and acknowledge the published version.
            </p>
          </div>
        </header>

        {openDoc ? (
          <PolicyDocumentEditor
            document={openDoc}
            folders={folders}
            onBack={() => setOpenId(null)}
            onSaved={(updated) => {
              setDocuments((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
            }}
          />
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-3">
              <NewDocumentCard folders={folders} onCreate={handleCreate} creating={creating} />
              {loading ? (
                <p className="py-8 text-center text-sm font-medium" style={{ color: "var(--cc-muted)" }}>Loading…</p>
              ) : documents.length === 0 ? (
                <div className="rounded-2xl border bg-card p-8 text-center" style={{ borderColor: "var(--cc-border)" }}>
                  <FileText size={26} className="mx-auto mb-2" style={{ color: "var(--cc-muted)" }} />
                  <p className="text-sm font-medium" style={{ color: "var(--cc-muted)" }}>No policy documents yet.</p>
                </div>
              ) : (
                <div className="rounded-2xl border divide-y bg-card" style={{ borderColor: "var(--cc-border)" }}>
                  {documents.map((doc) => (
                    <button
                      key={doc.id}
                      type="button"
                      onClick={() => setOpenId(doc.id)}
                      className="flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-cc-bg"
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: "var(--cc-soft)" }}>
                        <FileText size={15} style={{ color: "var(--cc-plum)" }} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold truncate" style={{ color: "var(--cc-text)" }}>{doc.title}</p>
                        <p className="text-xs mt-0.5 truncate" style={{ color: "var(--cc-muted)" }}>
                          {folders.find((f) => f.category === doc.folder_key)?.label ?? doc.folder_key}
                          {doc.current_governance_document_id ? " · Published" : " · Draft, not yet published"}
                          {doc.visible_to_workers ? " · Visible to workers" : ""}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h2 className="text-xs font-black uppercase tracking-wide" style={{ color: "var(--cc-muted)" }}>
                Worker acknowledgement
              </h2>
              {status.length === 0 ? (
                <p className="text-sm font-medium" style={{ color: "var(--cc-muted)" }}>
                  No policies are currently visible to workers.
                </p>
              ) : (
                <div className="space-y-2">
                  {status.map((s) => (
                    <div key={s.document_id} className="rounded-xl border bg-card p-3" style={{ borderColor: "var(--cc-border)" }}>
                      <p className="text-xs font-bold truncate" style={{ color: "var(--cc-text)" }}>{s.title}</p>
                      <div className="mt-1.5 flex items-center gap-2">
                        <Users size={12} style={{ color: "var(--cc-muted)" }} />
                        <p className="text-[11px] font-medium" style={{ color: "var(--cc-muted)" }}>
                          {s.acknowledged} / {s.total} acknowledged
                          {s.rate_percent != null ? ` (${s.rate_percent}%)` : ""}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </HubLayout>
  );
}

function NewDocumentCard({
  folders,
  onCreate,
  creating,
}: {
  folders: VaultFolder[];
  onCreate: (folderKey: string, title: string) => void;
  creating: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [folderKey, setFolderKey] = useState("");
  const [title, setTitle] = useState("");

  if (!open) {
    return (
      <Button
        variant="outline"
        className="w-full justify-center gap-2 rounded-2xl border-dashed py-6"
        onClick={() => setOpen(true)}
      >
        <Plus size={16} /> New policy document
      </Button>
    );
  }

  return (
    <div className="rounded-2xl border bg-card p-4 space-y-2.5" style={{ borderColor: "var(--cc-border)" }}>
      <Input placeholder="Document title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <Select value={folderKey} onValueChange={setFolderKey}>
        <SelectTrigger>
          <SelectValue placeholder="Category" />
        </SelectTrigger>
        <SelectContent>
          {folders.map((f) => (
            <SelectItem key={f.category} value={f.category}>{f.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="flex gap-2">
        <Button
          className="flex-1"
          disabled={!title.trim() || !folderKey || creating}
          onClick={() => onCreate(folderKey, title.trim())}
        >
          {creating && <Loader2 size={14} className="mr-1.5 animate-spin" />}
          Create
        </Button>
        <Button variant="ghost" onClick={() => { setOpen(false); setTitle(""); setFolderKey(""); }}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function PolicyDocumentEditor({
  document: doc,
  folders,
  onBack,
  onSaved,
}: {
  document: PolicyDocument;
  folders: VaultFolder[];
  onBack: () => void;
  onSaved: (updated: PolicyDocument) => void;
}) {
  const { toast } = useToast();
  const [title, setTitle] = useState(doc.title);
  const [visibleToWorkers, setVisibleToWorkers] = useState(doc.visible_to_workers);
  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(doc.template_id);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [showTemplateUpload, setShowTemplateUpload] = useState(false);

  const editor = useEditor({
    extensions: [StarterKit],
    content: doc.content_html || "<p></p>",
  });

  useEffect(() => {
    fetchDocumentTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  const folderLabel = useMemo(
    () => folders.find((f) => f.category === doc.folder_key)?.label ?? doc.folder_key,
    [folders, doc.folder_key],
  );

  async function handleSaveDraft() {
    if (!editor) return;
    setSaving(true);
    try {
      const updated = await updatePolicyDocument(doc.id, {
        title,
        templateId,
        contentHtml: editor.getHTML(),
        visibleToWorkers,
      });
      onSaved(updated);
      toast({ title: "Draft saved" });
    } catch (err) {
      toast({ title: "Could not save draft", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handlePublish() {
    if (!editor) return;
    setPublishing(true);
    try {
      await updatePolicyDocument(doc.id, {
        title,
        templateId,
        contentHtml: editor.getHTML(),
        visibleToWorkers,
      });
      const published = await publishPolicyDocument(doc.id);
      onSaved(published);
      toast({ title: "Published", description: "Workers marked visible can now read this policy." });
    } catch (err) {
      toast({ title: "Could not publish", description: (err as Error).message, variant: "destructive" });
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 text-sm font-black" style={{ color: "var(--cc-plum)" }}>
        <X size={14} /> Back to policy documents
      </button>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_280px]">
        <div className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="text-lg font-black" />
          <p className="text-xs font-medium" style={{ color: "var(--cc-muted)" }}>{folderLabel}</p>

          <div className="rounded-2xl border bg-card" style={{ borderColor: "var(--cc-border)" }}>
            <div className="border-b px-4 py-2 flex flex-wrap gap-1" style={{ borderColor: "var(--cc-border)" }}>
              <ToolbarButton active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}>B</ToolbarButton>
              <ToolbarButton active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}>I</ToolbarButton>
              <ToolbarButton active={editor?.isActive("heading", { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
              <ToolbarButton active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}>List</ToolbarButton>
              <ToolbarButton active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1. List</ToolbarButton>
            </div>
            <EditorContent editor={editor} className="prose prose-sm max-w-none p-4 min-h-[360px] focus:outline-none" />
          </div>
        </div>

        <div className="space-y-3">
          <div className="rounded-2xl border bg-card p-3.5 space-y-2.5" style={{ borderColor: "var(--cc-border)" }}>
            <p className="text-xs font-black uppercase tracking-wide" style={{ color: "var(--cc-muted)" }}>Branding template</p>
            <Select value={templateId ?? "__default__"} onValueChange={(v) => setTemplateId(v === "__default__" ? null : v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__default__">Default letterhead</SelectItem>
                {templates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {showTemplateUpload ? (
              <TemplateUploadInline
                onCreated={(t) => { setTemplates((prev) => [t, ...prev]); setTemplateId(t.id); setShowTemplateUpload(false); }}
                onCancel={() => setShowTemplateUpload(false)}
              />
            ) : (
              <Button variant="ghost" size="sm" className="w-full text-xs" onClick={() => setShowTemplateUpload(true)}>
                Upload a new template
              </Button>
            )}
          </div>

          <label className="flex cursor-pointer items-start gap-2.5 rounded-2xl border bg-card p-3.5" style={{ borderColor: "var(--cc-border)" }}>
            <Checkbox checked={visibleToWorkers} onCheckedChange={(v) => setVisibleToWorkers(v === true)} className="mt-0.5" />
            <span>
              <span className="block text-[12.5px] font-semibold" style={{ color: "var(--cc-text)" }}>Visible to workers</span>
              <span className="block text-[11px]" style={{ color: "var(--cc-muted)" }}>
                Applies to the next published version.
              </span>
            </span>
          </label>

          <Button variant="outline" className="w-full gap-2" disabled={saving} onClick={() => void handleSaveDraft()}>
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Save draft
          </Button>
          <Button className="w-full gap-2" disabled={publishing} onClick={() => void handlePublish()}>
            {publishing ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Publish
          </Button>
          {doc.current_governance_document_id && (
            <p className="text-center text-[11px] font-medium" style={{ color: "var(--cc-muted)" }}>
              Publishing again supersedes the current version — the old one stays on file as history.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ToolbarButton({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg px-2.5 py-1 text-xs font-bold transition"
      style={{
        background: active ? "var(--cc-active-bg)" : "transparent",
        color: active ? "var(--cc-plum)" : "var(--cc-muted)",
      }}
    >
      {children}
    </button>
  );
}

function TemplateUploadInline({
  onCreated,
  onCancel,
}: {
  onCreated: (template: DocumentTemplate) => void;
  onCancel: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [html, setHtml] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim() || !html.trim()) {
      toast({ title: "Add a name and paste your template HTML", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const created = await createDocumentTemplate({ name: name.trim(), htmlContent: html });
      onCreated(created);
      toast({ title: "Template saved" });
    } catch (err) {
      toast({ title: "Could not save template", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-xl border p-2.5" style={{ borderColor: "var(--cc-border)" }}>
      <Input placeholder="Template name" value={name} onChange={(e) => setName(e.target.value)} className="text-xs" />
      <textarea
        placeholder={"Paste your branded HTML template. Use {{ content }} where the document body should go, and {{ org_name }} / {{ org_logo_url }} / {{ title }} for branding fields."}
        value={html}
        onChange={(e) => setHtml(e.target.value)}
        rows={5}
        className="w-full rounded-lg border p-2 font-mono text-[11px]"
        style={{ borderColor: "var(--cc-border)" }}
      />
      <div className="flex gap-2">
        <Button size="sm" className="flex-1 text-xs" disabled={saving} onClick={() => void handleSave()}>
          {saving && <Loader2 size={12} className="mr-1 animate-spin" />}
          Save template
        </Button>
        <Button size="sm" variant="ghost" className="text-xs" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}
