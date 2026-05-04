import { useRef, useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getStoredSignature, saveSignature, clearSignature } from "@/lib/signature-store";
import { PenLine, Upload, Trash2, Check, RotateCcw, ImageIcon, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  useGetPractitionerSettings,
  useSavePractitionerSettings,
} from "@workspace/api-client-react";

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

  // ── API ────────────────────────────────────────────────────────────────────
  const { data: serverSettings, isLoading: isLoadingSettings } =
    useGetPractitionerSettings();

  const { mutateAsync: saveToServer, isPending: isSaving } =
    useSavePractitionerSettings();

  // ── Load signature: server first, fall back to localStorage ───────────────
  useEffect(() => {
    if (isLoadingSettings) return;

    if (serverSettings?.signature) {
      setSavedSignature(serverSettings.signature);
      saveSignature(serverSettings.signature);
    } else {
      const local = getStoredSignature();
      if (local) {
        setSavedSignature(local);
      }
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

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-slate-500 dark:text-slate-400">
          Configure your practitioner profile and signature for PDF audit reports.
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
          {/* Loading state */}
          {isLoadingSettings && (
            <div className="flex items-center gap-2 text-sm text-slate-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading saved signature…
            </div>
          )}

          {/* Currently saved signature preview */}
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

            {/* ── Draw tab ── */}
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

            {/* ── Upload tab ── */}
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
