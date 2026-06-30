import React, {
  useRef,
  useCallback,
  useEffect,
  useState,
  forwardRef,
  TextareaHTMLAttributes,
  InputHTMLAttributes,
} from "react";
import { cn } from "@/lib/utils";
import { Mic, MicOff, Loader2, Globe } from "lucide-react";
import { apiFetch } from "@/lib/api-fetch";
import { useAccessibility } from "@/contexts/AccessibilityContext";

interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}
interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}
interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: { transcript: string; confidence: number };
}
interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}
declare global {
  interface Window {
    SpeechRecognition: new () => SpeechRecognitionInstance;
    webkitSpeechRecognition: new () => SpeechRecognitionInstance;
  }
}

type SmartMode = "raw" | "translate" | "clinical";

interface DictationState {
  rawTranscript: string;
  detectedLanguage: string;
  isListening: boolean;
  isProcessing: boolean;
  mode: SmartMode;
  cache: Partial<Record<SmartMode, string>>;
  hasDictated: boolean;
}

const INITIAL: DictationState = {
  rawTranscript: "",
  detectedLanguage: "",
  isListening: false,
  isProcessing: false,
  mode: "raw",
  cache: {},
  hasDictated: false,
};

const LANG_LABELS: Record<string, string> = {
  en: "EN", fr: "FR", es: "ES", de: "DE", it: "IT", pt: "PT",
  nl: "NL", sv: "SV", no: "NO", da: "DA", pl: "PL", cs: "CS",
  ru: "RU", uk: "UA", tr: "TR", el: "EL", zh: "ZH", ja: "JA",
  ko: "KO", ar: "AR", he: "HE", hi: "HI", ur: "UR", bn: "BN",
  th: "TH", vi: "VI", id: "ID", ms: "MS", tl: "TL", km: "KM",
  lo: "LO", sw: "SW", zu: "ZU", am: "AM", so: "SO",
};

function langLabel(code: string): string {
  const base = (code || "").toLowerCase().split(/[-_]/)[0];
  return LANG_LABELS[base] || base.toUpperCase().slice(0, 3) || "?";
}

function speechSupported(): boolean {
  return typeof window !== "undefined" &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition);
}

async function apiTranslate(text: string): Promise<{ translated: string; detected_language: string }> {
  const res = await apiFetch("/api/ai/translate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`translate ${res.status}`);
  return res.json();
}

async function apiClinical(text: string): Promise<{ clinical: string; detected_language: string }> {
  const res = await apiFetch("/api/ai/clinical-rewrite", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) throw new Error(`clinical-rewrite ${res.status}`);
  return res.json();
}

function useDictation(onChange: (val: string) => void, speechLang?: string, currentValue = "") {
  const [st, setSt] = useState<DictationState>({ ...INITIAL, rawTranscript: currentValue });
  const recRef = useRef<SpeechRecognitionInstance | null>(null);
  const accumRef = useRef<string>("");

  const switchMode = useCallback(
    async (newMode: SmartMode, raw: string, cache: Partial<Record<SmartMode, string>>, lang: string) => {
      if (newMode === "raw") {
        setSt((s) => ({ ...s, mode: "raw" }));
        onChange(raw);
        return;
      }
      if (cache[newMode]) {
        setSt((s) => ({ ...s, mode: newMode }));
        onChange(cache[newMode]!);
        return;
      }
      setSt((s) => ({ ...s, mode: newMode, isProcessing: true }));
      try {
        if (newMode === "translate") {
          const r = await apiTranslate(raw);
          setSt((s) => ({
            ...s,
            isProcessing: false,
            detectedLanguage: r.detected_language || lang,
            cache: { ...s.cache, translate: r.translated },
          }));
          onChange(r.translated);
        } else {
          const r = await apiClinical(raw);
          setSt((s) => ({
            ...s,
            isProcessing: false,
            detectedLanguage: r.detected_language || lang,
            cache: { ...s.cache, clinical: r.clinical },
          }));
          onChange(r.clinical);
        }
      } catch {
        setSt((s) => ({ ...s, isProcessing: false }));
      }
    },
    [onChange],
  );

  const handleModeClick = useCallback(
    (mode: SmartMode) => {
      setSt((s) => {
        const raw = s.rawTranscript || currentValue;
        if (!raw.trim()) return s;
        switchMode(mode, raw, s.cache, s.detectedLanguage);
        return s;
      });
    },
    [switchMode, currentValue],
  );

  const handleTextChange = useCallback(
    (value: string) => {
      setSt((s) => ({
        ...s,
        rawTranscript: value,
        cache: {},
        mode: "raw",
        hasDictated: false,
      }));
      onChange(value);
    },
    [onChange],
  );

  const toggleListening = useCallback(() => {
    if (!speechSupported()) return;

    if (recRef.current) {
      recRef.current.stop();
      recRef.current = null;
      return;
    }

    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    if (speechLang) {
      rec.lang = speechLang;
    }

    accumRef.current = "";

    rec.onresult = (event) => {
      let finalPart = "";
      let interimPart = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const r = event.results[i];
        if (r.isFinal) finalPart += r[0].transcript;
        else interimPart += r[0].transcript;
      }
      if (finalPart) {
        accumRef.current = (accumRef.current + " " + finalPart).trim();
      }
      onChange((accumRef.current + " " + interimPart).trim());
    };

    rec.onend = () => {
      recRef.current = null;
      const raw = accumRef.current;
      setSt((s) => ({
        ...s,
        isListening: false,
        rawTranscript: raw,
        hasDictated: !!raw,
        cache: {},
        mode: "raw",
        detectedLanguage: "",
      }));
    };

    rec.onerror = () => {
      recRef.current = null;
      setSt((s) => ({ ...s, isListening: false }));
    };

    rec.start();
    recRef.current = rec;
    setSt((s) => ({ ...s, isListening: true, hasDictated: false }));
  }, [onChange, speechLang]);

  const reset = useCallback(() => {
    recRef.current?.stop();
    recRef.current = null;
    setSt(INITIAL);
  }, []);

  return { st, toggleListening, handleModeClick, handleTextChange, reset };
}

interface ModePillsProps {
  st: DictationState;
  onMode: (m: SmartMode) => void;
}

function ModePills({ st, onMode }: ModePillsProps) {
  const { translate } = useAccessibility();
  const { isListening, isProcessing, hasDictated, detectedLanguage, mode, rawTranscript } = st;

  if (!isListening && !hasDictated && !rawTranscript.trim()) return null;

  return (
    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap select-none">
      {isListening ? (
        <span className="flex items-center gap-1.5 text-xs text-red-500 font-medium animate-pulse">
          <span className="h-2 w-2 rounded-full bg-red-500 inline-block animate-pulse" />
          {translate("clinical.smartInput.listening")}
        </span>
      ) : (
        <>
          {detectedLanguage && (
            <span className="flex items-center gap-1 text-xs text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">
              <Globe className="h-3 w-3" />
              {langLabel(detectedLanguage)}
            </span>
          )}
          {(["raw", "translate", "clinical"] as SmartMode[]).map((m) => {
            const isActive = mode === m;
            const isBusy = isProcessing && isActive;
            const label =
              m === "raw" ? translate("clinical.smartInput.raw") :
              m === "translate" ? (isBusy ? translate("clinical.smartInput.translating") : translate("clinical.smartInput.translate")) :
              isBusy ? translate("clinical.smartInput.rewriting") : translate("clinical.smartInput.clinical");
            return (
              <button
                key={m}
                type="button"
                disabled={isProcessing}
                onClick={() => onMode(m)}
                className={cn(
                  "text-xs px-2.5 py-0.5 rounded-full border transition-all duration-150 font-medium",
                  isActive
                    ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
                    : "bg-cc-surface text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600",
                  isProcessing && "opacity-60 cursor-not-allowed",
                )}
              >
                {isBusy && (
                  <Loader2 className="h-3 w-3 inline mr-1 animate-spin" />
                )}
                {label}
              </button>
            );
          })}
        </>
      )}
    </div>
  );
}

interface MicButtonProps {
  isListening: boolean;
  isProcessing: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
}

function MicButton({ isListening, isProcessing, disabled, onClick, className }: MicButtonProps) {
  const { translate } = useAccessibility();
  if (!speechSupported()) return null;
  return (
    <button
      type="button"
      aria-label={isListening ? translate("clinical.smartInput.stopRecording") : translate("clinical.smartInput.startDictation")}
      disabled={disabled || isProcessing}
      onClick={onClick}
      className={cn(
        "flex items-center justify-center rounded-md transition-all duration-200 shrink-0",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500",
        isListening
          ? "text-red-500 bg-red-50 hover:bg-red-100"
          : "text-slate-400 hover:text-indigo-600 hover:bg-indigo-50",
        isProcessing && "opacity-50 cursor-not-allowed",
        className,
      )}
    >
      {isProcessing ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : isListening ? (
        <MicOff className="h-4 w-4" />
      ) : (
        <Mic className="h-4 w-4" />
      )}
    </button>
  );
}

export interface SmartInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (val: string) => void;
  containerClassName?: string;
  speechLang?: string;
}

export const SmartInput = forwardRef<HTMLInputElement, SmartInputProps>(
  ({ value, onChange, className, containerClassName, disabled, speechLang, ...rest }, ref) => {
    const { st, toggleListening, handleModeClick, handleTextChange } = useDictation(onChange, speechLang, value);

    return (
      <div className={cn("w-full", containerClassName)}>
        <div className="relative flex items-center">
          <input
            ref={ref}
            value={value}
            onChange={(e) => handleTextChange(e.target.value)}
            disabled={disabled}
            className={cn(
              "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm",
              "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1",
              "focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
              speechSupported() ? "pr-9" : "",
              className,
            )}
            {...rest}
          />
          <MicButton
            isListening={st.isListening}
            isProcessing={st.isProcessing}
            disabled={disabled}
            onClick={toggleListening}
            className="absolute right-1.5 h-6 w-6 p-1"
          />
        </div>
        <ModePills st={st} onMode={handleModeClick} />
      </div>
    );
  },
);
SmartInput.displayName = "SmartInput";

export interface SmartTextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "onChange"> {
  value: string;
  onChange: (val: string) => void;
  containerClassName?: string;
  speechLang?: string;
}

export const SmartTextarea = forwardRef<HTMLTextAreaElement, SmartTextareaProps>(
  ({ value, onChange, className, containerClassName, rows = 4, disabled, speechLang, ...rest }, ref) => {
    const { st, toggleListening, handleModeClick, handleTextChange } = useDictation(onChange, speechLang, value);
    const innerRef = useRef<HTMLTextAreaElement>(null);

    const setRefs = useCallback(
      (el: HTMLTextAreaElement | null) => {
        (innerRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) (ref as React.MutableRefObject<HTMLTextAreaElement | null>).current = el;
      },
      [ref],
    );

    const autoGrow = useCallback(() => {
      const el = innerRef.current;
      if (!el) return;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }, []);

    useEffect(() => { autoGrow(); }, [value, autoGrow]);

    return (
      <div className={cn("w-full", containerClassName)}>
        <div className="relative">
          <textarea
            ref={setRefs}
            value={value}
            rows={rows}
            onChange={(e) => handleTextChange(e.target.value)}
            disabled={disabled}
            className={cn(
              "flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm",
              "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1",
              "focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 resize-none overflow-hidden",
              speechSupported() ? "pr-10 pb-8" : "",
              className,
            )}
            {...rest}
          />
          <MicButton
            isListening={st.isListening}
            isProcessing={st.isProcessing}
            disabled={disabled}
            onClick={toggleListening}
            className="absolute bottom-2 right-2 h-6 w-6 p-1"
          />
        </div>
        <ModePills st={st} onMode={handleModeClick} />
      </div>
    );
  },
);
SmartTextarea.displayName = "SmartTextarea";
