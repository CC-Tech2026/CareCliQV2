import { useRef, useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getStoredSignature, saveSignature, clearSignature } from "@/lib/signature-store";
import {
  PenLine,
  Upload,
  Trash2,
  Check,
  RotateCcw,
  ImageIcon,
  Loader2,
  Building2,
  Settings2,
  ShieldCheck,
  User,
  Plus,
  X,
  Info,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  useGetPractitionerSettings,
  useSavePractitionerSettings,
} from "@workspace/api-client-react";
import { AvatarPicker, AvatarDisplay } from "@/components/AvatarPicker";

// ---------------------------------------------------------------------------
// ABN validation
// ---------------------------------------------------------------------------
function isValidABN(abn: string): boolean {
  const digits = abn.replace(/\s/g, "");
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const d = digits.split("").map(Number);
  d[0] -= 1;
  const sum = d.reduce((acc, v, i) => acc + v * weights[i], 0);
  return sum % 89 === 0;
}

// ---------------------------------------------------------------------------
// Sidebar nav items
// ---------------------------------------------------------------------------
type SectionId = "account" | "provider" | "defaults" | "compliance";

const NAV_ITEMS: { id: SectionId; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: "account",    label: "Account",          icon: User        },
  { id: "provider",   label: "Provider",          icon: Building2   },
  { id: "defaults",   label: "Session Defaults",  icon: Settings2   },
  { id: "compliance", label: "Compliance",        icon: ShieldCheck },
];

// ---------------------------------------------------------------------------
// Reusable setting row (toggle + title + description)
// ---------------------------------------------------------------------------
function SettingRow({
  title,
  description,
  checked,
  onCheckedChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-6 rounded-xl px-4 py-3.5 hover:bg-slate-50 transition-colors group">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-slate-800">{title}</p>
        <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Section wrapper
// ---------------------------------------------------------------------------
function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-slate-900">{title}</h2>
        <p className="text-sm text-slate-500 mt-1 leading-relaxed">{description}</p>
      </div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Panel card
// ---------------------------------------------------------------------------
function PanelCard({
  label,
  children,
  className,
}: {
  label?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Card
      className={cn(
        "shadow-sm hover:shadow-md transition-all duration-200 hover:-translate-y-0.5 border-slate-200/80",
        className,
      )}
    >
      {label && (
        <div className="px-5 pt-5 pb-0">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
        </div>
      )}
      <CardContent className={cn("p-5", label && "pt-3")}>{children}</CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function Settings() {
  const { toast } = useToast();
  const [activeSection, setActiveSection] = useState<SectionId>("account");
  const [savedSignature, setSavedSignature] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"draw" | "upload">("draw");

  // ── Draw pad state ─────────────────────────────────────────────────────────
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const [hasDrawing, setHasDrawing] = useState(false);

  // ── Upload state ───────────────────────────────────────────────────────────
  const [uploadPreview, setUploadPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Avatar state ───────────────────────────────────────────────────────────
  const [avatarId, setAvatarId] = useState<string | null>(null);

  // ── Practitioner Details state ─────────────────────────────────────────────
  const [practName, setPractName] = useState("");
  const [practCredentials, setPractCredentials] = useState("");
  const [isSavingPract, setIsSavingPract] = useState(false);

  // ── Provider Information state ─────────────────────────────────────────────
  const [businessName, setBusinessName] = useState("");
  const [abn, setAbn] = useState("");
  const [isSavingProvider, setIsSavingProvider] = useState(false);

  // ── Session Defaults state ─────────────────────────────────────────────────
  const [defaultDuration, setDefaultDuration] = useState<string>("60");
  const [autoStartTimer, setAutoStartTimer] = useState(false);
  const [enableVoice, setEnableVoice] = useState(false);
  const [isSavingDefaults, setIsSavingDefaults] = useState(false);

  // ── Compliance Requirements state ──────────────────────────────────────────
  const [requireActivity, setRequireActivity] = useState(false);
  const [requireNotes, setRequireNotes] = useState(false);
  const [requireDuration, setRequireDuration] = useState(false);
  const [physicalExamSessionTypes, setPhysicalExamSessionTypes] = useState<string[]>([]);
  const [newSessionType, setNewSessionType] = useState("");
  const [isSavingCompliance, setIsSavingCompliance] = useState(false);

  const DEFAULT_PHYSICAL_TYPES = [
    "physiotherapy", "physio", "occupational therapy", "OT",
    "physical therapy", "therapy", "exercise physiology",
    "hydrotherapy", "rehabilitation", "rehab", "massage",
    "manual therapy", "sports therapy",
  ];

  // ── API ────────────────────────────────────────────────────────────────────
  const { data: serverSettings, isLoading: isLoadingSettings } =
    useGetPractitionerSettings();

  const { mutateAsync: saveToServer, isPending: isSaving } =
    useSavePractitionerSettings();

  // ── Populate all fields from server settings ───────────────────────────────
  useEffect(() => {
    if (isLoadingSettings || !serverSettings) return;

    if (serverSettings.signature) {
      setSavedSignature(serverSettings.signature);
      saveSignature(serverSettings.signature);
    } else {
      const local = getStoredSignature();
      if (local) setSavedSignature(local);
    }

    if (serverSettings.name) setPractName(serverSettings.name);
    if (serverSettings.credentials) setPractCredentials(serverSettings.credentials);
    if (serverSettings.avatarId) setAvatarId(serverSettings.avatarId);

    const provider = serverSettings.provider as { businessName?: string | null; abn?: string | null } | null;
    if (provider?.businessName) setBusinessName(provider.businessName);
    if (provider?.abn) setAbn(provider.abn);

    const sd = serverSettings.sessionDefaults as {
      defaultDuration?: number | null;
      autoStartTimer?: boolean | null;
      enableVoice?: boolean | null;
    } | null;
    if (sd?.defaultDuration != null) setDefaultDuration(String(sd.defaultDuration));
    if (sd?.autoStartTimer != null) setAutoStartTimer(sd.autoStartTimer);
    if (sd?.enableVoice != null) setEnableVoice(sd.enableVoice);

    const comp = serverSettings.compliance as {
      requireActivity?: boolean | null;
      requireNotes?: boolean | null;
      requireDuration?: boolean | null;
      physicalExamSessionTypes?: string[] | null;
    } | null;
    if (comp?.requireActivity != null) setRequireActivity(comp.requireActivity);
    if (comp?.requireNotes != null) setRequireNotes(comp.requireNotes);
    if (comp?.requireDuration != null) setRequireDuration(comp.requireDuration);
    if (comp?.physicalExamSessionTypes != null) {
      setPhysicalExamSessionTypes(comp.physicalExamSessionTypes);
    }
  }, [serverSettings, isLoadingSettings]);

  // ── Canvas helpers ─────────────────────────────────────────────────────────
  const getCanvasPos = (
    e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>
  ): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    if ("touches" in e) {
      const touch = e.touches[0];
      return { x: (touch.clientX - rect.left) * scaleX, y: (touch.clientY - rect.top) * scaleY };
    }
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
  };

  const startDrawing = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      isDrawingRef.current = true;
      lastPosRef.current = getCanvasPos(e);
    },
    []
  );

  const draw = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      if (!isDrawingRef.current || !lastPosRef.current) return;
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      const pos = getCanvasPos(e);
      ctx.beginPath();
      ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = "#1e293b";
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      lastPosRef.current = pos;
      setHasDrawing(true);
    },
    []
  );

  const stopDrawing = useCallback(() => {
    isDrawingRef.current = false;
    lastPosRef.current = null;
  }, []);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasDrawing(false);
  }, []);

  // ── Save helpers ───────────────────────────────────────────────────────────
  const persistSignature = useCallback(
    async (dataUrl: string) => {
      saveSignature(dataUrl);
      setSavedSignature(dataUrl);
      try {
        await saveToServer({
          data: {
            signature: dataUrl,
            name: serverSettings?.name ?? null,
            credentials: serverSettings?.credentials ?? null,
          },
        });
      } catch {
        toast({
          title: "Saved locally",
          description: "Signature saved to this device. Server sync failed — it will retry next time you open Settings.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Signature saved",
        description: "Your signature is now synced and will appear on all PDF reports across all devices.",
      });
    },
    [saveToServer, serverSettings, toast]
  );

  const saveDrawn = useCallback(async () => {
    const canvas = canvasRef.current!;
    const dataUrl = canvas.toDataURL("image/png");
    await persistSignature(dataUrl);
  }, [persistSignature]);

  const saveUploaded = useCallback(async () => {
    if (!uploadPreview) return;
    await persistSignature(uploadPreview);
  }, [uploadPreview, persistSignature]);

  const handleClear = useCallback(async () => {
    clearSignature();
    setSavedSignature(null);
    clearCanvas();
    setUploadPreview(null);
    try {
      await saveToServer({
        data: {
          signature: null,
          name: serverSettings?.name ?? null,
          credentials: serverSettings?.credentials ?? null,
        },
      });
    } catch {
      // server sync failed — signature already cleared locally
    }
    toast({ title: "Signature removed", description: "PDF reports will show the placeholder sign-here box." });
  }, [clearCanvas, saveToServer, serverSettings, toast]);

  // ── File upload ────────────────────────────────────────────────────────────
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== "image/png" && file.type !== "image/jpeg") {
      toast({ title: "Invalid file type", description: "Please upload a PNG or JPG image.", variant: "destructive" });
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast({ title: "File too large", description: "Please upload an image smaller than 2 MB.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => { setUploadPreview(reader.result as string); };
    reader.readAsDataURL(file);
  };

  // ── Avatar auto-save ───────────────────────────────────────────────────────
  const handleAvatarChange = async (newId: string | null) => {
    setAvatarId(newId);
    try {
      await saveToServer({ data: { avatarId: newId ?? null } });
    } catch {
      toast({ title: "Could not save avatar", variant: "destructive" });
    }
  };

  // ── Section save handlers ──────────────────────────────────────────────────
  const handleSavePractitioner = async () => {
    setIsSavingPract(true);
    try {
      await saveToServer({ data: { name: practName.trim() || null, credentials: practCredentials.trim() || null } });
      toast({ title: "Practitioner details saved" });
    } catch {
      toast({ title: "Save failed", description: "Could not save practitioner details.", variant: "destructive" });
    } finally {
      setIsSavingPract(false);
    }
  };

  const abnDigits = abn.replace(/\s/g, "");
  const abnValid = abnDigits === "" || isValidABN(abn);
  const abnHas11Digits = abnDigits.length === 11;
  const abnError = abnHas11Digits && !isValidABN(abn);
  const abnShowValid = abnHas11Digits && isValidABN(abn);

  const handleSaveProvider = async () => {
    if (!abnValid) {
      toast({ title: "Invalid ABN", description: "Please enter a valid 11-digit Australian Business Number.", variant: "destructive" });
      return;
    }
    setIsSavingProvider(true);
    try {
      await saveToServer({ data: { provider: { businessName: businessName.trim() || null, abn: abn.replace(/\s/g, "") || null } } });
      toast({ title: "Provider information saved" });
    } catch {
      toast({ title: "Save failed", description: "Could not save provider information.", variant: "destructive" });
    } finally {
      setIsSavingProvider(false);
    }
  };

  const handleSaveDefaults = async () => {
    setIsSavingDefaults(true);
    try {
      await saveToServer({ data: { sessionDefaults: { defaultDuration: defaultDuration ? Number(defaultDuration) : null, autoStartTimer, enableVoice } } });
      toast({ title: "Session defaults saved" });
    } catch {
      toast({ title: "Save failed", description: "Could not save session defaults.", variant: "destructive" });
    } finally {
      setIsSavingDefaults(false);
    }
  };

  const handleSaveCompliance = async () => {
    setIsSavingCompliance(true);
    try {
      await saveToServer({
        data: {
          compliance: {
            requireActivity,
            requireNotes,
            requireDuration,
            // Send null when list is empty so the backend falls back to built-in
            // defaults rather than treating an empty array as "no types required".
            physicalExamSessionTypes: physicalExamSessionTypes.length > 0 ? physicalExamSessionTypes : null,
          },
        },
      });
      toast({ title: "Compliance requirements saved" });
    } catch {
      toast({ title: "Save failed", description: "Could not save compliance requirements.", variant: "destructive" });
    } finally {
      setIsSavingCompliance(false);
    }
  };

  const handleAddSessionType = () => {
    const trimmed = newSessionType.trim();
    if (!trimmed) return;
    const lower = trimmed.toLowerCase();
    if (physicalExamSessionTypes.some((t) => t.toLowerCase() === lower)) {
      toast({ title: "Already in the list", description: `"${trimmed}" is already configured.` });
      return;
    }
    setPhysicalExamSessionTypes((prev) => [...prev, trimmed]);
    setNewSessionType("");
  };

  const handleRemoveSessionType = (index: number) => {
    setPhysicalExamSessionTypes((prev) => prev.filter((_, i) => i !== index));
  };

  const handleResetToDefaults = () => {
    setPhysicalExamSessionTypes(DEFAULT_PHYSICAL_TYPES);
  };

  // ── Loading overlay ────────────────────────────────────────────────────────
  const LoadingRow = () => (
    <div className="flex items-center gap-2 text-sm text-slate-400 py-4">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>Loading settings…</span>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex gap-8 min-h-full">

      {/* ── Sticky sidebar ──────────────────────────────────────────────────── */}
      <aside className="hidden md:flex flex-col w-52 shrink-0">
        <div className="sticky top-0 space-y-1 pt-1">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 px-3 pb-2">
            Settings
          </p>
          {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveSection(id)}
              className={cn(
                "w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 text-left",
                activeSection === id
                  ? "bg-primary/8 text-primary border-l-2 border-primary pl-[10px]"
                  : "text-slate-600 hover:bg-slate-100 hover:text-slate-900 border-l-2 border-transparent pl-[10px]"
              )}
            >
              <Icon className={cn("h-4 w-4 shrink-0", activeSection === id ? "text-primary" : "text-slate-400")} />
              {label}
            </button>
          ))}
        </div>
      </aside>

      {/* ── Mobile nav ──────────────────────────────────────────────────────── */}
      <div className="md:hidden flex gap-1 overflow-x-auto pb-1 w-full">
        {NAV_ITEMS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setActiveSection(id)}
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors shrink-0",
              activeSection === id
                ? "bg-primary text-white"
                : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      {/* ── Content panel ───────────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0 space-y-8 pb-12">

        {/* ── Account section ─────────────────────────────────────────────── */}
        {activeSection === "account" && (
          <Section
            title="Account"
            description="Your practitioner identity and digital signature for NDIS audit reports."
          >
            {/* Signature card */}
            <PanelCard label="Digital Signature">
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-5">
                  {savedSignature && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
                          <Check className="h-3.5 w-3.5" /> Signature saved
                        </span>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 gap-1"
                          onClick={handleClear}
                          disabled={isSaving}
                        >
                          <Trash2 className="h-3 w-3" /> Remove
                        </Button>
                      </div>
                      <div className="bg-white border border-emerald-100 rounded-lg p-3 flex items-center justify-center h-20 shadow-inner">
                        <img src={savedSignature} alt="Saved signature" className="max-h-full max-w-full object-contain" />
                      </div>
                    </div>
                  )}

                  <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "draw" | "upload")}>
                    <TabsList className="w-full rounded-lg h-9">
                      <TabsTrigger value="draw" className="flex-1 gap-1.5 text-xs">
                        <PenLine className="h-3.5 w-3.5" /> Draw
                      </TabsTrigger>
                      <TabsTrigger value="upload" className="flex-1 gap-1.5 text-xs">
                        <Upload className="h-3.5 w-3.5" /> Upload Image
                      </TabsTrigger>
                    </TabsList>

                    <TabsContent value="draw" className="space-y-3 mt-4">
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Draw your signature using your mouse, stylus, or finger on a touchscreen.
                      </p>
                      <div
                        className={cn(
                          "rounded-xl border-2 border-dashed overflow-hidden cursor-crosshair bg-white transition-colors",
                          hasDrawing ? "border-slate-300" : "border-slate-200 hover:border-slate-300"
                        )}
                        style={{ touchAction: "none" }}
                      >
                        <canvas
                          ref={canvasRef}
                          width={560}
                          height={160}
                          className="w-full block"
                          style={{ touchAction: "none" }}
                          onMouseDown={startDrawing}
                          onMouseMove={draw}
                          onMouseUp={stopDrawing}
                          onMouseLeave={stopDrawing}
                          onTouchStart={startDrawing}
                          onTouchMove={draw}
                          onTouchEnd={stopDrawing}
                        />
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" className="gap-1.5" onClick={clearCanvas} disabled={!hasDrawing}>
                          <RotateCcw className="h-3.5 w-3.5" /> Clear
                        </Button>
                        <Button size="sm" className="gap-1.5 ml-auto" onClick={saveDrawn} disabled={!hasDrawing || isSaving || isLoadingSettings}>
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Save Signature
                        </Button>
                      </div>
                    </TabsContent>

                    <TabsContent value="upload" className="space-y-3 mt-4">
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Upload a PNG or JPG of your handwritten signature. Scan on a white background for best results. Max 2 MB.
                      </p>
                      <div
                        className={cn(
                          "rounded-xl border-2 border-dashed flex flex-col items-center justify-center py-8 cursor-pointer transition-colors bg-white",
                          uploadPreview ? "border-slate-300" : "border-slate-200 hover:border-slate-300 hover:bg-slate-50"
                        )}
                        onClick={() => fileInputRef.current?.click()}
                      >
                        {uploadPreview ? (
                          <img src={uploadPreview} alt="Signature preview" className="max-h-24 max-w-full object-contain" />
                        ) : (
                          <>
                            <ImageIcon className="h-8 w-8 text-slate-300 mb-2" />
                            <span className="text-sm text-slate-500">Click to upload a signature image</span>
                            <span className="text-xs text-slate-400 mt-1">PNG or JPG — max 2 MB</span>
                          </>
                        )}
                      </div>
                      <input ref={fileInputRef} type="file" accept="image/png,image/jpeg" className="hidden" onChange={handleFileChange} />
                      <div className="flex gap-2">
                        {uploadPreview && (
                          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { setUploadPreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; }}>
                            <RotateCcw className="h-3.5 w-3.5" /> Reset
                          </Button>
                        )}
                        <Button size="sm" className="gap-1.5 ml-auto" onClick={saveUploaded} disabled={!uploadPreview || isSaving || isLoadingSettings}>
                          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                          Save Signature
                        </Button>
                      </div>
                    </TabsContent>
                  </Tabs>

                  <div className="pt-2 border-t border-slate-100 text-xs text-slate-400 leading-relaxed">
                    Signatures are synced to the server and cached locally for offline access. They appear in the sign-off block of every exported PDF audit report.
                  </div>
                </div>
              )}
            </PanelCard>

            {/* Practitioner details card */}
            <PanelCard label="Practitioner Details">
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="pract-name" className="text-xs font-medium text-slate-600">Full Name</Label>
                      <Input
                        id="pract-name"
                        value={practName}
                        onChange={(e) => setPractName(e.target.value)}
                        placeholder="e.g. Jane Smith"
                        className="rounded-lg"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="pract-credentials" className="text-xs font-medium text-slate-600">Credentials</Label>
                      <Input
                        id="pract-credentials"
                        value={practCredentials}
                        onChange={(e) => setPractCredentials(e.target.value)}
                        placeholder="e.g. RN, B.Sc. Nursing"
                        className="rounded-lg"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <Button size="sm" onClick={handleSavePractitioner} disabled={isSavingPract} className="gap-1.5 min-w-[110px]">
                      {isSavingPract ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Save Details
                    </Button>
                  </div>
                </div>
              )}
            </PanelCard>

            {/* Avatar picker card */}
            <PanelCard label="Profile Avatar">
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-4">
                    <AvatarDisplay
                      avatarId={avatarId}
                      sizePx={56}
                      fallback={
                        <div className="h-14 w-14 rounded-full bg-indigo-50 border-2 border-dashed border-indigo-200 flex items-center justify-center text-indigo-300">
                          <User className="h-6 w-6" />
                        </div>
                      }
                    />
                    <div>
                      <p className="text-sm font-medium text-slate-700">
                        {avatarId ? "Avatar selected" : "No avatar chosen"}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5 leading-relaxed">
                        Choose a character below. It appears in your sidebar instead of your initials. Saves automatically.
                      </p>
                    </div>
                  </div>
                  <AvatarPicker value={avatarId} onChange={handleAvatarChange} />
                </div>
              )}
            </PanelCard>
          </Section>
        )}

        {/* ── Provider section ─────────────────────────────────────────────── */}
        {activeSection === "provider" && (
          <Section
            title="Provider"
            description="Your registered NDIS provider business details. These appear on PDF audit reports and invoices."
          >
            <PanelCard label="Business Information">
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="business-name" className="text-xs font-medium text-slate-600">Business Name</Label>
                    <Input
                      id="business-name"
                      value={businessName}
                      onChange={(e) => setBusinessName(e.target.value)}
                      placeholder="e.g. Sunshine Support Services Pty Ltd"
                      className="rounded-lg"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="abn" className="text-xs font-medium text-slate-600">
                      ABN <span className="text-slate-400 font-normal">(Australian Business Number)</span>
                    </Label>
                    <Input
                      id="abn"
                      value={abn}
                      onChange={(e) => setAbn(e.target.value)}
                      placeholder="e.g. 51 824 753 556"
                      className={cn("rounded-lg max-w-[220px]", abnError && "border-red-400 focus-visible:ring-red-400")}
                      maxLength={14}
                    />
                    {abnError && (
                      <p className="text-xs text-red-500">Please enter a valid 11-digit ABN.</p>
                    )}
                    {!abnError && abnShowValid && (
                      <p className="text-xs text-emerald-600 flex items-center gap-1">
                        <Check className="h-3 w-3" /> Valid ABN
                      </p>
                    )}
                    {!abnError && !abnShowValid && abnDigits.length > 0 && (
                      <p className="text-xs text-slate-400">{11 - abnDigits.length} more digit{11 - abnDigits.length !== 1 ? "s" : ""} needed</p>
                    )}
                  </div>
                  <div className="flex justify-end pt-1">
                    <Button size="sm" onClick={handleSaveProvider} disabled={isSavingProvider || abnError} className="gap-1.5 min-w-[130px]">
                      {isSavingProvider ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                      Save Provider Info
                    </Button>
                  </div>
                </div>
              )}
            </PanelCard>
          </Section>
        )}

        {/* ── Session Defaults section ─────────────────────────────────────── */}
        {activeSection === "defaults" && (
          <Section
            title="Session Defaults"
            description="Default settings applied automatically when you start a new live session."
          >
            <PanelCard label="Duration">
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-1.5">
                  <Label htmlFor="default-duration" className="text-xs font-medium text-slate-600">
                    Default Duration <span className="text-slate-400 font-normal">(minutes)</span>
                  </Label>
                  <Input
                    id="default-duration"
                    type="number"
                    min={1}
                    max={480}
                    value={defaultDuration}
                    onChange={(e) => setDefaultDuration(e.target.value)}
                    placeholder="60"
                    className="max-w-[120px] rounded-lg"
                  />
                  <p className="text-xs text-slate-400">Used as the planned duration when creating sessions</p>
                </div>
              )}
            </PanelCard>

            <PanelCard label="Automation">
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="divide-y divide-slate-100">
                  <SettingRow
                    title="Auto-start timer"
                    description="Timer starts automatically when you open the session page, so you never forget to start it."
                    checked={autoStartTimer}
                    onCheckedChange={setAutoStartTimer}
                  />
                  <SettingRow
                    title="Enable voice dictation"
                    description="Voice recording is activated by default when a session starts, ready to capture notes hands-free."
                    checked={enableVoice}
                    onCheckedChange={setEnableVoice}
                  />
                </div>
              )}
            </PanelCard>

            {!isLoadingSettings && (
              <div className="flex justify-end">
                <Button size="sm" onClick={handleSaveDefaults} disabled={isSavingDefaults} className="gap-1.5 min-w-[120px]">
                  {isSavingDefaults ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save Defaults
                </Button>
              </div>
            )}
          </Section>
        )}

        {/* ── Compliance section ───────────────────────────────────────────── */}
        {activeSection === "compliance" && (
          <Section
            title="Compliance"
            description="Enforce documentation standards before a session can be approved. These checks run alongside the built-in NDIS compliance engine."
          >
            <PanelCard label="Required Before Approval">
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="divide-y divide-slate-100">
                  <SettingRow
                    title="Require activity log"
                    description="At least one support activity must be logged during the session before it can be approved."
                    checked={requireActivity}
                    onCheckedChange={setRequireActivity}
                  />
                  <SettingRow
                    title="Require clinical notes"
                    description="Clinical notes must be completed and contain substantive content before the session can be approved."
                    checked={requireNotes}
                    onCheckedChange={setRequireNotes}
                  />
                  <SettingRow
                    title="Require session duration"
                    description="The session timer must have been run and record a duration greater than zero before approval."
                    checked={requireDuration}
                    onCheckedChange={setRequireDuration}
                  />
                </div>
              )}
            </PanelCard>

            <PanelCard label="Session Types Requiring Physical Examination">
              {isLoadingSettings ? (
                <LoadingRow />
              ) : (
                <div className="space-y-4">
                  <p className="text-xs text-slate-500 leading-relaxed">
                    When a session's type matches one of the names below, the compliance engine will warn if no body examination markers have been recorded.
                    Names are matched case-insensitively. This list <strong>replaces</strong> the built-in defaults — leave it empty to keep using the built-in set (physiotherapy, OT, therapy, rehab, etc.).
                  </p>

                  {/* Current list */}
                  {physicalExamSessionTypes.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {physicalExamSessionTypes.map((type, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 rounded-full bg-primary/8 text-primary text-xs font-medium px-2.5 py-1 border border-primary/20"
                        >
                          {type}
                          <button
                            type="button"
                            onClick={() => handleRemoveSessionType(i)}
                            className="ml-0.5 text-primary/60 hover:text-red-500 transition-colors"
                            aria-label={`Remove ${type}`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-xs text-slate-400 rounded-lg bg-slate-50 border border-dashed border-slate-200 px-3 py-2.5">
                      <Info className="h-3.5 w-3.5 shrink-0" />
                      <span>No custom types saved — the built-in defaults (physiotherapy, OT, therapy, rehab…) are used.</span>
                    </div>
                  )}

                  {/* Add new type */}
                  <div className="flex gap-2">
                    <Input
                      value={newSessionType}
                      onChange={(e) => setNewSessionType(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { e.preventDefault(); handleAddSessionType(); }
                      }}
                      placeholder="e.g. hydrotherapy, support coordination…"
                      className="rounded-lg text-sm flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 shrink-0"
                      onClick={handleAddSessionType}
                      disabled={!newSessionType.trim()}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                  </div>

                  {/* Reset to defaults helper */}
                  <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                    <p className="text-xs text-slate-400">
                      Reset to restore the standard built-in list
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs text-slate-500 hover:text-slate-700 gap-1"
                      onClick={handleResetToDefaults}
                    >
                      <RotateCcw className="h-3 w-3" /> Reset to defaults
                    </Button>
                  </div>
                </div>
              )}
            </PanelCard>

            {!isLoadingSettings && (
              <>
                <div className="flex justify-end">
                  <Button size="sm" onClick={handleSaveCompliance} disabled={isSavingCompliance} className="gap-1.5 min-w-[140px]">
                    {isSavingCompliance ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Save Requirements
                  </Button>
                </div>

                <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 text-xs text-slate-500 leading-relaxed space-y-1.5">
                  <p className="font-semibold text-slate-600 text-sm">How compliance requirements work</p>
                  <p>
                    These toggles add enforcement gates on top of the built-in NDIS compliance scoring. When a rule is enabled, the
                    Approve &amp; Save action is blocked with a clear message if the requirement is not met. The gate fires before the session
                    review modal opens, so practitioners are prompted to complete the missing documentation immediately.
                  </p>
                  <p>
                    The built-in engine always runs regardless of these toggles and tracks participant linkage, duration, activities, clinical notes,
                    photo evidence, and goal linkage.
                  </p>
                </div>
              </>
            )}
          </Section>
        )}

      </main>
    </div>
  );
}
