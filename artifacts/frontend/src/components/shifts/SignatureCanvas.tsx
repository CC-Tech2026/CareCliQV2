import { useCallback, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RotateCcw } from "lucide-react";

type Props = {
  minWidth?: number;
  minHeight?: number;
  className?: string;
  onChange?: (payload: { svg: string; pngDataUrl: string; hasStroke: boolean }) => void;
};

export function SignatureCanvas({ minWidth = 150, minHeight = 60, className, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isDrawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const pathsRef = useRef<string[]>([]);
  const currentPathRef = useRef<string>("");
  const [hasStroke, setHasStroke] = useState(false);

  const emitChange = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !onChange) return;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}"><path d="${pathsRef.current.join(" ")}" stroke="#1E1640" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    onChange({
      svg,
      pngDataUrl: canvas.toDataURL("image/png"),
      hasStroke: pathsRef.current.length > 0,
    });
  }, [onChange]);

  const getCanvasPos = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      const clientY = "touches" in e ? e.touches[0].clientY : e.clientY;
      return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    },
    [],
  );

  const startDrawing = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      e.preventDefault();
      isDrawingRef.current = true;
      const pos = getCanvasPos(e);
      lastPosRef.current = pos;
      currentPathRef.current = `M ${pos.x.toFixed(1)} ${pos.y.toFixed(1)}`;
    },
    [getCanvasPos],
  );

  const draw = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
      if (!isDrawingRef.current) return;
      e.preventDefault();
      const canvas = canvasRef.current!;
      const ctx = canvas.getContext("2d")!;
      const pos = getCanvasPos(e);
      ctx.beginPath();
      ctx.moveTo(lastPosRef.current?.x ?? pos.x, lastPosRef.current?.y ?? pos.y);
      ctx.lineTo(pos.x, pos.y);
      ctx.strokeStyle = "#1E1640";
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.stroke();
      lastPosRef.current = pos;
      currentPathRef.current += ` L ${pos.x.toFixed(1)} ${pos.y.toFixed(1)}`;
      if (!hasStroke) setHasStroke(true);
      emitChange();
    },
    [emitChange, getCanvasPos, hasStroke],
  );

  const stopDrawing = useCallback(() => {
    if (isDrawingRef.current && currentPathRef.current) {
      pathsRef.current.push(currentPathRef.current);
      currentPathRef.current = "";
    }
    isDrawingRef.current = false;
    lastPosRef.current = null;
    emitChange();
  }, [emitChange]);

  const clearCanvas = useCallback(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    pathsRef.current = [];
    currentPathRef.current = "";
    setHasStroke(false);
    onChange?.({ svg: "", pngDataUrl: "", hasStroke: false });
  }, [onChange]);

  return (
    <div className={cn("space-y-2", className)}>
      <div
        className="overflow-hidden rounded-xl border-2 border-dashed bg-white"
        style={{ borderColor: hasStroke ? "rgba(85,51,204,0.35)" : "#E2DEF2", touchAction: "none" }}
      >
        <canvas
          ref={canvasRef}
          width={Math.max(minWidth, 320)}
          height={Math.max(minHeight, 120)}
          className="block w-full"
          style={{ touchAction: "none", minHeight: `${minHeight}px` }}
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
        />
      </div>
      <Button type="button" variant="outline" size="sm" className="gap-1.5 rounded-xl" onClick={clearCanvas} disabled={!hasStroke}>
        <RotateCcw className="h-3.5 w-3.5" /> Clear
      </Button>
    </div>
  );
}

export function useSignatureCanvasState() {
  const [signatureSvg, setSignatureSvg] = useState("");
  const [signaturePng, setSignaturePng] = useState("");
  const [hasStroke, setHasStroke] = useState(false);

  const onCanvasChange = useCallback((payload: { svg: string; pngDataUrl: string; hasStroke: boolean }) => {
    setSignatureSvg(payload.svg);
    setSignaturePng(payload.pngDataUrl);
    setHasStroke(payload.hasStroke);
  }, []);

  return { signatureSvg, signaturePng, hasStroke, onCanvasChange };
}
