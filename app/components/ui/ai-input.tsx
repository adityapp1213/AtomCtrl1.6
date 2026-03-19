"use client";

import { CornerRightUp, Mic, Pause } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { Textarea } from "@/components/ui/textarea";
import { useAutoResizeTextarea } from "@/components/hooks/use-auto-resize-textarea";
import { deepgramTranscribeAudioBlob } from "@/app/lib/deepgram/stt";
import { stopDeepgramAudio } from "@/app/lib/deepgram/tts";

export type AIInputSubmitMeta = {
  source: "text" | "voice";
};

interface AIInputProps {
  id?: string;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number;
  value?: string;
  onValueChange?: (value: string) => void;
  onSubmit?: (value: string, meta?: AIInputSubmitMeta) => void;
  onSpeechProcessingChange?: (isProcessing: boolean) => void;
  className?: string;
}

export function AIInput({
  id = "ai-input",
  placeholder = "Type your message...",
  minHeight = 52,
  maxHeight = 200,
  value,
  onValueChange,
  onSubmit,
  onSpeechProcessingChange,
  className,
}: AIInputProps) {
  const { textareaRef, adjustHeight } = useAutoResizeTextarea({
    minHeight,
    maxHeight,
  });
  const [internalValue, setInternalValue] = useState("");
  const [isListening, setIsListening] = useState(false);
  const [isSpeechProcessing, setIsSpeechProcessing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const stopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const audioProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const silenceStartRef = useRef<number | null>(null);

  const isControlled = value !== undefined;
  const inputValue = isControlled ? value : internalValue;

  const handleValueChange = (newValue: string) => {
    if (!isControlled) {
      setInternalValue(newValue);
    }
    onValueChange?.(newValue);
    adjustHeight();
  };

  const handleReset = () => {
    if (!inputValue.trim()) return;
    void unlockAudio();
    onSubmit?.(inputValue, { source: "text" });
    if (!isControlled) {
      setInternalValue("");
    }
    onValueChange?.("");
    adjustHeight(true);
  };

  const unlockAudio = useCallback(async () => {
    const w = window as unknown as {
      __atomAudioUnlocked?: boolean;
      __atomAudioContext?: AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    if (w.__atomAudioUnlocked) return;
    w.__atomAudioUnlocked = true;
    try {
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) return;
      const ctx: AudioContext = w.__atomAudioContext ?? new Ctx();
      w.__atomAudioContext = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gain.connect(ctx.destination);
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      src.connect(gain);
      src.start(0);
      src.stop(0);
    } catch {}
  }, []);

  const speakWithSpeechSynthesis = useCallback((text: string) => {
    // Speech synthesis disabled
  }, []);

  const speakText = useCallback(
    async (text: string) => {
      // Speech disabled
    },
    [speakWithSpeechSynthesis]
  );

  const transcribeAudio = useCallback(
    async (audioBlob: Blob): Promise<string> => {
      try {
        setIsSpeechProcessing(true);
        onSpeechProcessingChange?.(true);
        const transcript = await deepgramTranscribeAudioBlob(audioBlob);
        return transcript;
      } finally {
        setIsSpeechProcessing(false);
        onSpeechProcessingChange?.(false);
      }
    },
    [onSpeechProcessingChange]
  );

  const cleanupStream = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    silenceStartRef.current = null;
    const processor = audioProcessorRef.current;
    if (processor) {
      processor.disconnect();
      audioProcessorRef.current = null;
    }
    const source = audioSourceRef.current;
    if (source) {
      source.disconnect();
      audioSourceRef.current = null;
    }
    const ctx = audioContextRef.current;
    if (ctx) {
      ctx.close().catch(() => {});
      audioContextRef.current = null;
    }
    const stream = mediaStreamRef.current;
    mediaStreamRef.current = null;
    if (stream) {
      for (const t of stream.getTracks()) t.stop();
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const stopRecording = useCallback(() => {
    if (stopTimerRef.current) {
      clearTimeout(stopTimerRef.current);
      stopTimerRef.current = null;
    }
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      rec.stop();
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (typeof window === "undefined" || !("mediaDevices" in navigator)) return;
    if (!("MediaRecorder" in window)) return;

    try {
      void unlockAudio();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream, {
        mimeType: "audio/webm",
      });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.onstop = async () => {
        setIsListening(false);
        if (typeof window !== "undefined") {
          window.dispatchEvent(
            new CustomEvent("atom-ctrl-listening-state", { detail: false })
          );
        }
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        cleanupStream();
        if (blob.size === 0) return;
        const transcript = await transcribeAudio(blob);
        const finalText = (transcript || "").trim();
        if (!finalText) return;
        handleValueChange(finalText);
        onSubmit?.(finalText, { source: "voice" });
      };

      recorder.start(250);
      setIsListening(true);
      if (stopTimerRef.current) {
        clearTimeout(stopTimerRef.current);
      }
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        try {
          if (ctx.state === "suspended") {
            await ctx.resume();
          }
        } catch {}
        audioContextRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        audioSourceRef.current = source;
        try {
          await ctx.audioWorklet.addModule("/audio-processors/silence-detector.js");
          const workletNode = new AudioWorkletNode(ctx, "silence-detector");

          workletNode.port.onmessage = (event) => {
            if (event.data?.type === "silence") {
              stopRecording();
            }
          };

          source.connect(workletNode);
          workletNode.connect(ctx.destination);
        } catch (workletErr) {
          console.warn("[voice] AudioWorklet unavailable, falling back to timer-based stop", workletErr);
        }
      }
      stopTimerRef.current = setTimeout(() => {
        stopRecording();
      }, 10000);
      window.dispatchEvent(
        new CustomEvent("atom-ctrl-listening-state", { detail: true })
      );
    } catch (err) {
      console.error("Error starting recording", err);
      setIsListening(false);
      cleanupStream();
      onSpeechProcessingChange?.(false);
      window.dispatchEvent(
        new CustomEvent("atom-ctrl-listening-state", { detail: false })
      );
    }
  }, [
    cleanupStream,
    handleValueChange,
    onSpeechProcessingChange,
    onSubmit,
    stopRecording,
    transcribeAudio,
    unlockAudio,
  ]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopRecording();
      window.dispatchEvent(
        new CustomEvent("atom-ctrl-listening-state", { detail: false })
      );
      return;
    }
    stopDeepgramAudio();
    void startRecording();
  }, [isListening, startRecording, stopRecording]);

  // Listen for global toggle from HomeCloud double-tap
  useEffect(() => {
    const handler = () => {
      toggleListening();
    };
    if (typeof window !== "undefined") {
      window.addEventListener("atom-ctrl-toggle-listening", handler as EventListener);
    }
    return () => {
      if (typeof window !== "undefined") {
        window.removeEventListener("atom-ctrl-toggle-listening", handler as EventListener);
      }
    };
  }, [toggleListening]);

  useEffect(() => {
    return () => {
      stopRecording();
      cleanupStream();
      setIsListening(false);
      setIsSpeechProcessing(false);
      onSpeechProcessingChange?.(false);
      if (typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent("atom-ctrl-listening-state", { detail: false })
        );
      }
    };
  }, [cleanupStream, onSpeechProcessingChange, stopRecording]);

  return (
    <div className={cn("w-full py-4", className)}>
      <div className="relative max-w-xl w-full mx-auto">
        <Textarea
          id={id}
          placeholder={placeholder}
          className={cn(
            "max-w-xl bg-black/5 dark:bg-white/5 rounded-3xl pl-6 pr-16",
            "placeholder:text-black/50 dark:placeholder:text-white/50",
            "border-none ring-black/20 dark:ring-white/20",
            "text-black dark:text-white text-wrap",
            "overflow-y-auto resize-none",
            "focus-visible:ring-0 focus-visible:ring-offset-0",
            "transition-[height] duration-100 ease-out",
            "leading-[1.2] py-[16px]",
            `min-h-[${minHeight}px]`,
            `max-h-[${maxHeight}px]`,
            "[&::-webkit-resizer]:hidden"
          )}
          ref={textareaRef}
          value={inputValue}
          onChange={(e) => handleValueChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleReset();
            }
          }}
        />

        <button
          type="button"
          onClick={toggleListening}
          className={cn(
            "absolute top-1/2 -translate-y-1/2 rounded-xl py-1 px-1 transition-all duration-200",
            isListening
              ? "bg-accent text-accent-foreground"
              : "bg-black/5 dark:bg-white/5",
            inputValue ? "right-10" : "right-3"
          )}
        >
          {isListening ? (
            <Pause className="w-4 h-4" />
          ) : (
            <Mic className="w-4 h-4 text-black/70 dark:text-white/70" />
          )}
        </button>
        <button
          onClick={handleReset}
          type="button"
          className={cn(
            "absolute top-1/2 -translate-y-1/2 right-3",
            "rounded-xl bg-black/5 dark:bg-white/5 py-1 px-1",
            "transition-all duration-200",
            inputValue ? "opacity-100 scale-100" : "opacity-0 scale-95 pointer-events-none"
          )}
        >
          <CornerRightUp className="w-4 h-4 text-black/70 dark:text-white/70" />
        </button>
      </div>
    </div>
  );
}
