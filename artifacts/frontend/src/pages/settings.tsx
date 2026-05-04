import { useRef, useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  useGetPractitionerSettings,
  useSavePractitionerSettings,
} from "@workspace/api-client-react";

// ABN validation: 11 digits, passes the ABN checksum algorithm
function isValidABN(abn: string): boolean {
  const digits = abn.replace(/\s/g, "");
  if (!/^\d{11}$/.test(digits)) return false;
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const d = digits.split("").map(Number);
  d[0] -= 1;
  const sum = d.reduce((acc, v, i) => acc + v * weights[i], 0);
  return sum % 89 === 0;
}

export default function Settings() {
  const { toast } = useToast();
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

  // ── Practitioner Details state ─────────────────────────────────────────────
  const [practName, setPractName] = useState("");
  const [practCredentials, setPractCredentials] = useState("");
  const [isSavingPract, setIsSavingPract] = useState(false);

  // ── Provider Information state ─────────────────────────────────────────────
  const [businessName, setBusinessName] = useState("");
  const [abn, setAbn] = useState("");
  const [abnTouched, setAbnTouched] = useState(false);
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
  const [isSavingCompliance, setIsSavingCompliance] = useState(false);

  // ── API ────────────────────────────────────────────────────────────────────
  const { data: serverSettings, isLoading: isLoadingSettings } =
    useGetPractitionerSettings();

  const { mutateAsync: saveToServer, isPending: isSaving } =
    useSavePractitionerSettings();

  // ── Populate all fields from server settings ───────────────────────────────
  useEffect(() => {
    if (isLoadingSettings || !serverSettings) return;

    // Signature
    if (serverSettings.signature) {
      setSavedSignature(serverSettings.signature);
      saveSignature(serverSettings.signature);
    } else {
      const local = getStoredSignature();
      if (local) setSavedSignature(local);
    }

    // Practitioner Details
    if (serverSettings.name) setPractName(serverSettings.name);
    if (serverSettings.credentials) setPractCredentials(serverSettings.credentials);

    // Provider
    const provider = serverSettings.provider as { businessName?: string | null; abn?: string | null } | null;
    if (provider?.businessName) setBusinessName(provider.businessName);
    if (provider?.abn) setAbn(provider.abn);

    // Session Defaults
    const sd = serverSettings.sessionDefaults as {
      defaultDuration?: number | null;
      autoStartTimer?: boolean | null;
      enableVoice?: boolean | null;
    } | null;
    if (sd?.defaultDuration != null) setDefaultDuration(String(sd.defaultDuration));
    if (sd?.autoStartTimer != null) setAutoStartTimer(sd.autoStartTimer);
    if (sd?.enableVoice != null) setEnableVoice(sd.enableVoice);

    // Compliance
    const comp = serverSettings.compliance as {
      requireActivity?: boolean | null;
      requireNotes?: boolean | null;
      requireDuration?: boolean | null;
    } | null;
    if (comp?.requireActivity != null) setRequireActivity(comp.requireActivity);
    if (comp?.requireNotes != null) setRequireNotes(comp.requireNotes);
    if (comp?.requireDuration != null) setRequireDuration(comp.requireDuration);
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
      return {
        x: (touch.clientX - rect.left) * scaleX,
        y: (touch.clientY - rect.top) * scaleY,
      };
    }
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
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
    reader.onloadend = () => {
      setUploadPreview(reader.result as string);
    };
    reader.readAsDataURL(file);
  };

  // ── Section save handlers ──────────────────────────────────────────────────
  const handleSavePractitioner = async () => {
    setIsSavingPract(true);
    try {
      await saveToServer({
        data: {
          name: practName.trim() || null,
          credentials: practCredentials.trim() || null,
        },
      });
      toast({ title: "Practitioner details saved" });
    } catch {
      toast({ title: "Save failed", description: "Could not save practitioner details.", variant: "destructive" });
    } finally {
      setIsSavingPract(false);
    }
  };

  const abnValid = abn.replace(/\s/g, "") === "" || isValidABN(abn);
  const abnError = abnTouched && abn.replace(/\s/g, "") !== "" && !isValidABN(abn);

  const handleSaveProvider = async () => {
    if (!abnValid) {
      toast({ title: "Invalid ABN", description: "Please enter a valid 11-digit Australian Business Number.", variant: "destructive" });
      return;
    }
    setIsSavingProvider(true);
    try {
      await saveToServer({
        data: {
          provider: {
            businessName: businessName.trim() || null,
            abn: abn.replace(/\s/g, "") || null,
          },
        },
      });
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
      await saveToServer({
        data: {
          sessionDefaults: {
            defaultDuration: defaultDuration ? Number(defaultDuration) : null,
            autoStartTimer,
            enableVoice,
          },
        },
      });
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

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-slate-500 dark:text-slate-400">
          Manage your practitioner profile, provider details, session defaults, and compliance requirements.
        </p>
      </div>

      {/* ── Signature section ──────────────────────────────────────────────── */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <PenLine className="h-4 w-4 text-primary" />
            Practitioner Signature
          </CardTitle>
          <CardDescription>
            Your signature will be embedded into the sign-off section of all PDF audit reports.
            Draw it with your mouse or touchscreen, or upload an image of your existing signature.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {isLoadingSettings && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading saved signature…
            </div>
          )}

          {!isLoadingSettings && savedSignature && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-emerald-700 flex items-center gap-1.5">
                  <Check className="h-3.5 w-3.5" /> Saved signature
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
              <div className="bg-white border border-emerald-100 rounded-md p-2 flex items-center justify-center h-20">
                <img
                  src={savedSignature}
                  alt="Saved signature"
                  className="max-h-full max-w-full object-contain"
                />
              </div>
            </div>
          )}

          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "draw" | "upload")}>
            <TabsList className="w-full">
              <TabsTrigger value="draw" className="flex-1 gap-1.5">
                <PenLine className="h-3.5 w-3.5" /> Draw
              </TabsTrigger>
              <TabsTrigger value="upload" className="flex-1 gap-1.5">
                <Upload className="h-3.5 w-3.5" /> Upload Image
              </TabsTrigger>
            </TabsList>

            <TabsContent value="draw" className="space-y-3 mt-4">
              <p className="text-xs text-slate-500">
                Draw your signature below using your mouse, stylus, or finger on a touchscreen.
              </p>

              <div
                className={cn(
                  "rounded-lg border-2 border-dashed overflow-hidden cursor-crosshair",
                  hasDrawing ? "border-slate-300" : "border-slate-200"
                )}
                style={{ touchAction: "none" }}
              >
                <canvas
                  ref={canvasRef}
                  width={560}
                  height={160}
                  className="w-full block bg-white"
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
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={clearCanvas}
                  disabled={!hasDrawing}
                >
                  <RotateCcw className="h-3.5 w-3.5" /> Clear
                </Button>
                <Button
                  size="sm"
                  className="gap-1.5 ml-auto"
                  onClick={saveDrawn}
                  disabled={!hasDrawing || isSaving || isLoadingSettings}
                >
                  {isSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Save Signature
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="upload" className="space-y-3 mt-4">
              <p className="text-xs text-slate-500">
                Upload a PNG or JPG image of your handwritten signature. For best results, scan or
                photograph your signature on a white background. Max 2 MB.
              </p>

              <div
                className={cn(
                  "rounded-lg border-2 border-dashed flex flex-col items-center justify-center py-8 cursor-pointer transition-colors hover:bg-slate-50",
                  uploadPreview ? "border-slate-300" : "border-slate-200"
                )}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadPreview ? (
                  <img
                    src={uploadPreview}
                    alt="Signature preview"
                    className="max-h-24 max-w-full object-contain"
                  />
                ) : (
                  <>
                    <ImageIcon className="h-8 w-8 text-slate-300 mb-2" />
                    <span className="text-sm text-slate-500">Click to upload a signature image</span>
                    <span className="text-xs text-slate-400 mt-1">PNG or JPG — max 2 MB</span>
                  </>
                )}
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/png,image/jpeg"
                className="hidden"
                onChange={handleFileChange}
              />

              <div className="flex gap-2">
                {uploadPreview && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      setUploadPreview(null);
                      if (fileInputRef.current) fileInputRef.current.value = "";
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" /> Reset
                  </Button>
                )}
                <Button
                  size="sm"
                  className="gap-1.5 ml-auto"
                  onClick={saveUploaded}
                  disabled={!uploadPreview || isSaving || isLoadingSettings}
                >
                  {isSaving ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                  Save Signature
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* ── Practitioner Details ───────────────────────────────────────────── */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4 text-primary" />
            Practitioner Details
          </CardTitle>
          <CardDescription>
            Your name and credentials appear on PDF audit reports and clinical records.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingSettings ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="pract-name">Full Name</Label>
                <Input
                  id="pract-name"
                  value={practName}
                  onChange={(e) => setPractName(e.target.value)}
                  placeholder="e.g. Jane Smith"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pract-credentials">Credentials</Label>
                <Input
                  id="pract-credentials"
                  value={practCredentials}
                  onChange={(e) => setPractCredentials(e.target.value)}
                  placeholder="e.g. RN, B.Sc. Nursing, NDIS Support Worker"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={handleSavePractitioner}
                  disabled={isSavingPract}
                  className="gap-1.5"
                >
                  {isSavingPract ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save Details
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Provider Information ───────────────────────────────────────────── */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary" />
            Provider Information
          </CardTitle>
          <CardDescription>
            Business name and ABN for this NDIS provider. The ABN must be a valid 11-digit Australian Business Number.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingSettings ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="business-name">Business Name</Label>
                <Input
                  id="business-name"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                  placeholder="e.g. Sunshine Support Services Pty Ltd"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="abn">ABN</Label>
                <Input
                  id="abn"
                  value={abn}
                  onChange={(e) => {
                    setAbn(e.target.value);
                    setAbnTouched(true);
                  }}
                  onBlur={() => setAbnTouched(true)}
                  placeholder="e.g. 51 824 753 556"
                  className={cn(abnError && "border-red-400 focus-visible:ring-red-400")}
                  maxLength={14}
                />
                {abnError && (
                  <p className="text-xs text-red-500">
                    Please enter a valid 11-digit ABN.
                  </p>
                )}
                {!abnError && abnTouched && abn.replace(/\s/g, "").length === 11 && isValidABN(abn) && (
                  <p className="text-xs text-emerald-600 flex items-center gap-1">
                    <Check className="h-3 w-3" /> Valid ABN
                  </p>
                )}
              </div>
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={handleSaveProvider}
                  disabled={isSavingProvider || abnError}
                  className="gap-1.5"
                >
                  {isSavingProvider ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save Provider Info
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Session Defaults ───────────────────────────────────────────────── */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Settings2 className="h-4 w-4 text-primary" />
            Session Defaults
          </CardTitle>
          <CardDescription>
            Default settings applied when you open a new live session.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingSettings ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="default-duration">Default Duration (minutes)</Label>
                <Input
                  id="default-duration"
                  type="number"
                  min={1}
                  max={480}
                  value={defaultDuration}
                  onChange={(e) => setDefaultDuration(e.target.value)}
                  placeholder="60"
                  className="max-w-[120px]"
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">Auto-start timer</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Timer starts automatically when you open the session page
                  </p>
                </div>
                <Switch
                  checked={autoStartTimer}
                  onCheckedChange={setAutoStartTimer}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">Enable voice dictation</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Voice recording is enabled by default when sessions start
                  </p>
                </div>
                <Switch
                  checked={enableVoice}
                  onCheckedChange={setEnableVoice}
                />
              </div>

              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={handleSaveDefaults}
                  disabled={isSavingDefaults}
                  className="gap-1.5"
                >
                  {isSavingDefaults ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save Defaults
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Compliance Requirements ────────────────────────────────────────── */}
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            Compliance Requirements
          </CardTitle>
          <CardDescription>
            When enabled, these checks must be satisfied before a session can be approved and saved.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoadingSettings ? (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">Require activity log</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    At least one activity must be logged before approval
                  </p>
                </div>
                <Switch
                  checked={requireActivity}
                  onCheckedChange={setRequireActivity}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">Require clinical notes</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Clinical notes must be completed before approval
                  </p>
                </div>
                <Switch
                  checked={requireNotes}
                  onCheckedChange={setRequireNotes}
                />
              </div>

              <div className="flex items-center justify-between rounded-lg border border-slate-200 px-4 py-3">
                <div>
                  <p className="text-sm font-medium text-slate-800">Require session duration</p>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Session timer must have been run before approval
                  </p>
                </div>
                <Switch
                  checked={requireDuration}
                  onCheckedChange={setRequireDuration}
                />
              </div>

              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={handleSaveCompliance}
                  disabled={isSavingCompliance}
                  className="gap-1.5"
                >
                  {isSavingCompliance ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Save Requirements
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* ── Info card ─────────────────────────────────────────────────────────── */}
      <Card className="shadow-sm bg-slate-50 border-slate-200">
        <CardContent className="p-4 text-xs text-slate-500 space-y-1">
          <p className="font-medium text-slate-700">About signature storage</p>
          <p>
            Your signature is securely saved to the server so it is available on any device you log
            in from. It is also cached locally for offline access and automatically embedded into the
            sign-off block whenever you export a PDF audit report.
          </p>
          <p>
            Clearing your signature will remove it from both the server and this device.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
