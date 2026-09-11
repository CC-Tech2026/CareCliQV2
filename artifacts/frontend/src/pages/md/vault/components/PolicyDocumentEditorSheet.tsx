import { useEffect, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { ChevronDown, Loader2, Plus, Save, Send } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import {
  createDocumentTemplate,
  createPolicyDocument,
  fetchDocumentTemplates,
  fetchPolicyDocument,
  previewPolicyDocument,
  previewTemplateHtml,
  publishPolicyDocument,
  updatePolicyDocument,
  type DocumentTemplate,
  type PolicyDocument,
} from "@/services/vaultService";

/** Org-level merge fields a template author can insert into the body text
 * itself (e.g. "Issued by {{ org.provider_name }}"), not just the outer
 * letterhead — mirrors merge_fields.py's "org" source. participant/worker
 * fields aren't offered here yet since nothing generates against them. */
const ORG_MERGE_FIELDS: { key: string; label: string }[] = [
  { key: "provider_name", label: "Organisation name" },
  { key: "logo_url", label: "Logo URL" },
  { key: "abn", label: "ABN" },
  { key: "address", label: "Address" },
  { key: "phone", label: "Phone" },
  { key: "email", label: "Email" },
  { key: "ndis_provider_number", label: "NDIS provider number" },
];

/** Renders arbitrary template/policy HTML with no script execution, no
 * same-origin access, and no navigation — templates are user-authored. */
function PreviewFrame({ html, className }: { html: string; className?: string }) {
  return (
    <iframe
      title="Preview"
      srcDoc={html}
      sandbox=""
      className={className}
      style={{ width: "100%", border: "none", background: "white" }}
    />
  );
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Full-height side panel version of the policy-document editor, opened
 * from a governance vault folder — the folder is already known, so unlike
 * the old standalone page there's no folder picker, just a title prompt
 * before the first save. */
export function PolicyDocumentEditorSheet({
  open,
  onOpenChange,
  folderKey,
  folderLabel,
  documentId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  folderKey: string;
  folderLabel: string;
  /** null = creating a brand-new draft in this folder. */
  documentId: string | null;
  onSaved: (doc: PolicyDocument) => void;
}) {
  const { toast } = useToast();
  const [doc, setDoc] = useState<PolicyDocument | null>(null);
  const [loading, setLoading] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (documentId) {
      setLoading(true);
      fetchPolicyDocument(documentId)
        .then(setDoc)
        .catch((err) => toast({ title: "Could not load this document", description: (err as Error).message, variant: "destructive" }))
        .finally(() => setLoading(false));
    } else {
      setDoc(null);
      setNewTitle("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, documentId]);

  async function handleCreate() {
    if (!newTitle.trim()) return;
    setCreating(true);
    try {
      const created = await createPolicyDocument({ folderKey, title: newTitle.trim() });
      setDoc(created);
      onSaved(created);
    } catch (err) {
      toast({ title: "Could not create document", description: (err as Error).message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-5xl">
        <SheetHeader>
          <SheetTitle>{doc ? doc.title : `New policy — ${folderLabel}`}</SheetTitle>
        </SheetHeader>
        <div className="mt-5">
          {loading ? (
            <p className="py-10 text-center text-sm font-medium" style={{ color: "var(--cc-muted)" }}>Loading…</p>
          ) : !doc ? (
            <div className="space-y-3">
              <Input
                placeholder="Document title"
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                autoFocus
              />
              <Button className="w-full gap-2" disabled={!newTitle.trim() || creating} onClick={() => void handleCreate()}>
                {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                Start writing
              </Button>
            </div>
          ) : (
            <PolicyDocumentEditorBody
              document={doc}
              folderLabel={folderLabel}
              onSaved={(updated) => {
                setDoc(updated);
                onSaved(updated);
              }}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PolicyDocumentEditorBody({
  document: doc,
  folderLabel,
  onSaved,
}: {
  document: PolicyDocument;
  folderLabel: string;
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
  const [contentHtml, setContentHtml] = useState(doc.content_html || "<p></p>");
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    content: doc.content_html || "<p></p>",
    onUpdate: ({ editor }) => setContentHtml(editor.getHTML()),
  });

  useEffect(() => {
    fetchDocumentTemplates().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  const debouncedTitle = useDebouncedValue(title, 500);
  const debouncedContentHtml = useDebouncedValue(contentHtml, 500);

  useEffect(() => {
    let cancelled = false;
    previewPolicyDocument({ templateId, title: debouncedTitle, contentHtml: debouncedContentHtml })
      .then((html) => {
        if (!cancelled) {
          setPreviewHtml(html);
          setPreviewError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setPreviewError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [templateId, debouncedTitle, debouncedContentHtml]);

  function insertField(key: string) {
    editor?.chain().focus().insertContent(`{{ org.${key} }}`).run();
  }

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
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1fr_260px]">
        <div className="space-y-3">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} className="text-lg font-black" />
          <p className="text-xs font-medium" style={{ color: "var(--cc-muted)" }}>{folderLabel}</p>

          <div className="rounded-2xl border bg-card" style={{ borderColor: "var(--cc-border)" }}>
            <div className="flex flex-wrap items-center gap-1 border-b px-4 py-2" style={{ borderColor: "var(--cc-border)" }}>
              <ToolbarButton active={editor?.isActive("bold")} onClick={() => editor?.chain().focus().toggleBold().run()}>B</ToolbarButton>
              <ToolbarButton active={editor?.isActive("italic")} onClick={() => editor?.chain().focus().toggleItalic().run()}>I</ToolbarButton>
              <ToolbarButton active={editor?.isActive("heading", { level: 2 })} onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}>H2</ToolbarButton>
              <ToolbarButton active={editor?.isActive("bulletList")} onClick={() => editor?.chain().focus().toggleBulletList().run()}>List</ToolbarButton>
              <ToolbarButton active={editor?.isActive("orderedList")} onClick={() => editor?.chain().focus().toggleOrderedList().run()}>1. List</ToolbarButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="ml-auto inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-bold"
                    style={{ color: "var(--cc-muted)" }}
                  >
                    Insert field <ChevronDown size={12} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {ORG_MERGE_FIELDS.map((f) => (
                    <DropdownMenuItem key={f.key} onClick={() => insertField(f.key)}>
                      {f.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <EditorContent editor={editor} className="prose prose-sm max-w-none p-4 min-h-[360px] focus:outline-none" />
          </div>
        </div>

        <div className="space-y-2">
          <p className="text-xs font-black uppercase tracking-wide" style={{ color: "var(--cc-muted)" }}>Preview</p>
          <div className="overflow-hidden rounded-2xl border bg-card" style={{ borderColor: "var(--cc-border)" }}>
            {previewError ? (
              <p className="p-4 text-xs font-medium" style={{ color: "var(--cc-destructive, #b91c1c)" }}>{previewError}</p>
            ) : previewHtml ? (
              <PreviewFrame html={previewHtml} className="h-[420px]" />
            ) : (
              <p className="p-4 text-xs font-medium" style={{ color: "var(--cc-muted)" }}>Loading preview…</p>
            )}
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
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const debouncedHtml = useDebouncedValue(html, 500);

  useEffect(() => {
    if (!debouncedHtml.trim()) {
      setPreviewHtml(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    previewTemplateHtml(debouncedHtml)
      .then((rendered) => {
        if (!cancelled) {
          setPreviewHtml(rendered);
          setPreviewError(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setPreviewError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedHtml]);

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
      {previewError ? (
        <p className="text-[11px] font-medium" style={{ color: "var(--cc-destructive, #b91c1c)" }}>{previewError}</p>
      ) : previewHtml ? (
        <div className="overflow-hidden rounded-lg border" style={{ borderColor: "var(--cc-border)" }}>
          <PreviewFrame html={previewHtml} className="h-[260px]" />
        </div>
      ) : null}
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
