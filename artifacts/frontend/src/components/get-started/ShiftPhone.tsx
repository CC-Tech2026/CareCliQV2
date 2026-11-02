import { useEffect, useState } from "react";
import {
  ArrowUp,
  BatteryFull,
  Camera,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Globe,
  Loader2,
  MapPin,
  Mic,
  Paperclip,
  Pause,
  Send,
  Signal,
  Wifi,
  Zap,
} from "lucide-react";

/** A faithful mock of the worker app's live shift screen (artifacts/mobile
 * app/session/[id].tsx with WorkerMobileComposer at the bottom), using the
 * mobile brand tokens from constants/brand.ts. The participant, worker and
 * times are made up. */
const M = {
  bg: "#F2F3F5",
  card: "#FFFFFF",
  ink: "#2D2D3D",
  muted: "#6B6B7A",
  purple: "#4B3F91",
  pink: "#E8457A",
  tint: "#EEECF7",
  success: "#2E7D5B",
  live: "#22C55E",
};

export type DemoLanguage = "en" | "vi" | "zh" | "ar";

/** What the support worker types, in the language they think in. The
 * composer's input-language pill uses its own option labels (Vietnamese
 * isn't one of them, so it goes through Auto detect, as in the real app). */
export const DEMO_LANGUAGES: Record<
  DemoLanguage,
  { chip: string; pill: string; typed: string; idleHint: string; recordingHint: string; htmlLang: string; rtl?: boolean }
> = {
  en: {
    chip: "English",
    pill: "English",
    htmlLang: "en",
    typed:
      "Liam planned the route on his phone and tapped on without a prompt. One reminder at the interchange, then walked to campus on his own.",
    idleHint: "Hold mic to record · tap to send when typing.",
    recordingHint: "Recording… tap send to save, or cancel.",
  },
  vi: {
    chip: "Tiếng Việt",
    pill: "Auto detect",
    htmlLang: "vi",
    typed:
      "Liam tự lên lộ trình trên điện thoại và quẹt thẻ lên xe mà không cần nhắc. Nhắc một lần ở trạm trung chuyển, sau đó tự đi bộ đến trường.",
    idleHint: "Giữ mic để ghi âm · nhấn để gửi khi đang gõ.",
    recordingHint: "Đang ghi âm… nhấn gửi để lưu, hoặc hủy.",
  },
  zh: {
    chip: "简体中文",
    pill: "Chinese",
    htmlLang: "zh-Hans",
    typed: "Liam 在手机上自己规划了路线，没有提醒就刷卡上车。在换乘站提醒了一次，之后自己走到了校园。",
    idleHint: "按住麦克风录音 · 输入时点击发送。",
    recordingHint: "录音中…点击发送以保存，或取消。",
  },
  ar: {
    chip: "العربية",
    pill: "Arabic",
    htmlLang: "ar",
    typed: "خطط ليام للمسار على هاتفه وصعد إلى الحافلة دون تذكير. احتاج إلى تذكير واحد في محطة التبديل، ثم مشى إلى الحرم الجامعي بمفرده.",
    idleHint: "اضغط مطولاً على الميكروفون للتسجيل · اضغط للإرسال أثناء الكتابة.",
    recordingHint: "جارٍ التسجيل… اضغط على إرسال للحفظ، أو الإلغاء.",
    rtl: true,
  },
};

const LANGUAGE_NAME: Record<DemoLanguage, string> = {
  en: "English",
  vi: "Vietnamese",
  zh: "Chinese",
  ar: "Arabic",
};

/** Every note is stored in English, whatever it was written in. */
const SAVED_NOTE =
  "Liam planned the route on his phone and tapped on without a prompt. One reminder at the interchange, then walked to campus on his own.";

export type NoteMode = "type" | "voice";

/** Ticks a voice note records for in the demo; at 200ms a tick that's 7s. */
export const VOICE_TICKS = 35;

const CLOCK = ["9:02", "10:40", "12:34", "12:35"];

/** The recording waveform from WorkerMobileComposer's RecordingWave: 14
 * bars pulsing at staggered speeds. */
function RecordingWave() {
  return (
    <span className="flex items-center gap-[2px] h-[18px]" aria-hidden>
      <style>{`@keyframes gs-wave { from { transform: scaleY(0.3) } to { transform: scaleY(1) } }`}</style>
      {Array.from({ length: 14 }, (_, i) => (
        <span
          key={i}
          className="w-[2px] h-full rounded-full motion-reduce:!animate-none"
          style={{
            background: M.pink,
            transformOrigin: "center",
            animation: `gs-wave ${300 + (i % 5) * 90}ms ease-in-out ${i * 40}ms infinite alternate`,
          }}
        />
      ))}
    </span>
  );
}
/** Elapsed shift time at the start of each stage, in seconds. */
const ELAPSED_AT = [8, 98 * 60 + 12, 3 * 3600 + 32 * 60, 3 * 3600 + 33 * 60];

function formatElapsed(total: number) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

function useTicker(stage: number) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    setSeconds(0);
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [stage]);
  return ELAPSED_AT[stage] + seconds;
}

export function ShiftPhone({
  stage,
  progress,
  processing,
  sent,
  language,
  mode,
}: {
  /** 0 shift started, 1 writing the note, 2 signed off, 3 filed. */
  stage: number;
  /** Characters typed, or voice ticks recorded. */
  progress: number;
  /** A voice note being transcribed and translated after send. */
  processing: boolean;
  sent: boolean;
  language: DemoLanguage;
  mode: NoteMode;
}) {
  const lang = DEMO_LANGUAGES[language];
  const elapsed = useTicker(stage);
  const writing = stage === 1 && !sent;
  const recording = writing && mode === "voice" && !processing;
  const draft = writing && mode === "type" ? Array.from(lang.typed).slice(0, progress).join("") : "";
  const hasText = draft.length > 0;
  const noteSaved = stage >= 2 || sent;
  const recordSecs = Math.floor(progress / 5);

  return (
    <div className="relative mx-auto w-[318px] select-none" aria-label="The CareCliQ worker app during a shift">
      {/* Side buttons */}
      <span className="absolute -left-[3px] top-[118px] h-[30px] w-[3px] rounded-l" style={{ background: "#3A3A44" }} />
      <span className="absolute -left-[3px] top-[166px] h-[54px] w-[3px] rounded-l" style={{ background: "#3A3A44" }} />
      <span className="absolute -left-[3px] top-[230px] h-[54px] w-[3px] rounded-l" style={{ background: "#3A3A44" }} />
      <span className="absolute -right-[3px] top-[190px] h-[84px] w-[3px] rounded-r" style={{ background: "#3A3A44" }} />

      <div
        className="rounded-[54px] p-[11px]"
        style={{
          background: "#202028",
          boxShadow:
            "0 0 0 1.5px #4A4A55, inset 0 0 0 1px #0D0D12, 0 50px 90px -40px rgba(26,26,46,0.55), 0 20px 40px -20px rgba(26,26,46,0.35)",
        }}
      >
        <div className="relative h-[640px] rounded-[44px] overflow-hidden flex flex-col" style={{ background: M.bg }}>
          {/* Status bar + dynamic island */}
          <div className="relative h-[46px] shrink-0 flex items-center justify-between px-7 pt-1" style={{ background: M.card }}>
            <span className="text-[13.5px] font-semibold tabular-nums" style={{ color: "#000" }}>
              {CLOCK[stage]}
            </span>
            <span className="absolute left-1/2 top-[10px] -translate-x-1/2 h-[26px] w-[92px] rounded-full bg-black" />
            <span className="flex items-center gap-1" style={{ color: "#000" }}>
              <Signal size={14} strokeWidth={2.5} />
              <Wifi size={14} strokeWidth={2.5} />
              <BatteryFull size={20} strokeWidth={1.8} />
            </span>
          </div>

          {/* Filed banner */}
          <div
            className="absolute left-3 right-3 top-[52px] z-20 rounded-2xl px-3.5 py-3 flex items-center gap-2.5 transition-all duration-500"
            style={{
              background: "rgba(255,255,255,0.97)",
              boxShadow: "0 10px 30px -10px rgba(26,26,46,0.35)",
              transform: stage === 3 ? "translateY(0)" : "translateY(-140%)",
              opacity: stage === 3 ? 1 : 0,
            }}
          >
            <CheckCircle2 size={20} style={{ color: M.success }} />
            <div>
              <p className="text-[12.5px] font-bold" style={{ color: M.ink }}>
                Filed to Liam's record
              </p>
              <p className="text-[11px]" style={{ color: M.muted }}>
                Audit ready · nothing left to chase
              </p>
            </div>
          </div>

          {/* App header */}
          <div className="h-[44px] shrink-0 flex items-center px-3 gap-1.5" style={{ background: M.card, borderBottom: `1px solid ${M.tint}` }}>
            <ChevronLeft size={22} style={{ color: M.ink }} />
            <span className="flex-1 text-[15px] font-semibold truncate" style={{ color: M.ink }}>
              Liam Mitchell
            </span>
            <span className="flex items-center gap-1.5 pr-1">
              <span className="h-[7px] w-[7px] rounded-full animate-pulse motion-reduce:animate-none" style={{ background: M.live }} />
              <span className="text-[11px] font-semibold tracking-wide" style={{ color: M.muted }}>
                LIVE
              </span>
            </span>
          </div>

          <div className="flex-1 overflow-hidden">
            {/* Participant */}
            <div className="px-4 pt-3.5 pb-3" style={{ borderBottom: `1px solid ${M.tint}` }}>
              <p className="text-[19px] font-bold leading-tight" style={{ color: M.ink }}>
                Liam Mitchell
              </p>
              <p className="text-[11.5px] mt-0.5" style={{ color: M.muted }}>
                NDIS #430 185 527
              </p>
              <div className="mt-2 flex items-center gap-2">
                <span className="whitespace-nowrap rounded-full px-2.5 py-[3px] text-[11px] font-medium" style={{ background: M.tint, color: M.muted }}>
                  Community Access
                </span>
                <span className="whitespace-nowrap flex items-center gap-1 text-[11px]" style={{ color: M.muted }}>
                  <MapPin size={11} /> Adelaide CBD
                </span>
              </div>
            </div>

            {/* Timer */}
            <div className="px-4 py-2.5 flex items-center justify-between" style={{ background: M.card, borderBottom: `1px solid ${M.tint}` }}>
              <div>
                <p className="text-[9.5px] font-semibold tracking-wider" style={{ color: M.muted }}>
                  ELAPSED
                </p>
                <p className="text-[18px] font-bold tabular-nums leading-tight" style={{ color: M.ink }}>
                  {formatElapsed(elapsed)}
                </p>
              </div>
              <span className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-[12px] font-semibold" style={{ background: "#FEE2E2", color: "#DC2626" }}>
                <Pause size={13} fill="#DC2626" /> Pause
              </span>
            </div>

            {/* Goals */}
            <div className="px-4 py-3" style={{ borderBottom: `1px solid ${M.tint}` }}>
              <p className="text-[9.5px] font-semibold tracking-wider" style={{ color: M.muted }}>
                GOALS FOR THIS SHIFT
              </p>
              <p className="mt-1.5 flex gap-2 text-[12.5px]" style={{ color: M.ink }}>
                <span style={{ color: M.pink }}>•</span> Catch the bus to TAFE on my own
              </p>
            </div>

            {/* Notes */}
            <div className="px-4 py-3">
              <p className="text-[9.5px] font-semibold tracking-wider" style={{ color: M.muted }}>
                SHIFT NOTES
              </p>
              {noteSaved ? (
                <div
                  className="mt-2 rounded-2xl p-3 animate-in fade-in slide-in-from-bottom-2 duration-500 motion-reduce:animate-none"
                  style={{ background: M.card, border: `1px solid ${M.tint}` }}
                >
                  <p className="text-[12px] leading-[1.5]" style={{ color: M.ink }}>
                    {SAVED_NOTE}
                  </p>
                  <div className="mt-2 flex items-center justify-between gap-2 text-[10.5px]" style={{ color: M.muted }}>
                    <span className="flex items-center gap-1">
                      {mode === "voice" && <Mic size={10} />}
                      10:40 am · Aisha K.
                    </span>
                    {(language !== "en" || mode === "voice") && (
                      <span className="flex items-center gap-1">
                        <Globe size={10} />
                        {mode === "voice" ? "Voice" : "Typed"}
                        {language !== "en" ? ` in ${LANGUAGE_NAME[language]}` : ""}
                      </span>
                    )}
                  </div>
                  {stage >= 2 && (
                    <div
                      className="mt-2 pt-2 flex items-center gap-1.5 text-[11px] font-semibold animate-in fade-in duration-500 motion-reduce:animate-none"
                      style={{ color: M.success, borderTop: `1px solid ${M.tint}` }}
                    >
                      <Check size={12} strokeWidth={3} /> Signed off by Sarah, coordinator
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-[12px]" style={{ color: M.muted }}>
                  Nothing written yet this shift.
                </p>
              )}
            </div>
          </div>

          {/* Composer (WorkerMobileComposer) */}
          <div className="shrink-0 px-3 pt-2.5 pb-2" style={{ background: M.card, borderTop: `1px solid ${M.tint}` }}>
            <div className="flex items-center justify-between gap-1 whitespace-nowrap">
              <span className="text-[9px] font-bold tracking-wider" style={{ color: M.muted }}>
                INPUT LANGUAGE
              </span>
              <span className="flex items-center gap-1.5">
                {language !== "en" && (
                  <span
                    className="flex items-center gap-1 rounded-full px-2 py-[3px] text-[9.5px] font-bold"
                    style={{ background: M.tint, color: M.purple, border: `1px solid ${M.purple}40` }}
                  >
                    <Globe size={10} /> Translate → EN
                  </span>
                )}
                <span
                  className="flex items-center gap-0.5 rounded-full pl-2.5 pr-1.5 py-[3px] text-[10.5px] font-semibold"
                  style={{ background: M.bg, color: M.ink, border: `1px solid ${M.tint}` }}
                >
                  {DEMO_LANGUAGES[language].pill}
                  <ChevronRight size={11} style={{ color: M.muted }} />
                </span>
              </span>
            </div>

            <div className="mt-2 flex items-end gap-2">
              {recording ? (
                <div
                  className="flex-1 min-w-0 h-[42px] rounded-[20px] px-3 flex items-center gap-2"
                  style={{ background: `${M.pink}18`, border: `1px solid ${M.pink}66` }}
                >
                  <RecordingWave />
                  <span className="flex-1 whitespace-nowrap text-[12px] font-semibold tabular-nums" style={{ color: M.pink }}>
                    Recording… 0:{String(recordSecs).padStart(2, "0")}
                  </span>
                  <span className="text-[12px] font-semibold" style={{ color: M.muted }}>
                    Cancel
                  </span>
                </div>
              ) : (
              <div
                className="flex-1 min-h-[42px] rounded-[20px] pl-3.5 pr-2 py-2 flex items-end gap-1.5"
                style={{ background: M.bg, border: `1px solid ${M.tint}` }}
              >
                <p
                  dir={lang.rtl ? "rtl" : "ltr"}
                  lang={hasText ? lang.htmlLang : "en"}
                  className="flex-1 text-[12.5px] leading-[1.45] max-h-[74px] overflow-hidden"
                  style={{ color: hasText ? M.ink : M.muted, textAlign: lang.rtl ? "right" : "left" }}
                >
                  {hasText ? (
                    <>
                      {draft}
                      <span className="inline-block w-[1.5px] h-[13px] align-[-2px] mx-[1px] animate-pulse" style={{ background: M.purple }} />
                    </>
                  ) : (
                    "Add a note about Liam's progress..."
                  )}
                </p>
                <span className="flex items-center gap-2 pb-0.5" style={{ color: M.muted }}>
                  <Paperclip size={15} />
                  <Camera size={15} />
                  {hasText && <Zap size={15} style={{ color: M.purple }} />}
                </span>
              </div>
              )}
              <span
                className="h-[42px] w-[42px] shrink-0 rounded-full grid place-items-center transition-colors duration-300"
                style={{ background: recording ? "#C23B3B" : hasText ? M.purple : M.pink }}
              >
                {processing ? (
                  <Loader2 size={19} color="#FFFFFF" className="animate-spin" />
                ) : recording ? (
                  <Send size={18} color="#FFFFFF" />
                ) : hasText ? (
                  <ArrowUp size={20} color="#FFFFFF" strokeWidth={2.5} />
                ) : (
                  <Mic size={19} color="#FFFFFF" />
                )}
              </span>
            </div>

            <p
              dir={lang.rtl ? "rtl" : "ltr"}
              lang={lang.htmlLang}
              className="mt-1.5 text-[10px] text-center truncate"
              style={{ color: M.muted }}
            >
              {recording ? lang.recordingHint : lang.idleHint}
            </p>
            <div className="mt-1.5 mx-auto h-[4px] w-[110px] rounded-full bg-black/85" />
          </div>
        </div>
      </div>
    </div>
  );
}
