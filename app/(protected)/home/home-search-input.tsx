"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useMutation } from "convex/react";
import { nanoid } from "nanoid";
import {
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputProvider,
  useProviderAttachments,
} from "@/components/ai-elements/prompt-input";
import { Suggestions, Suggestion } from "@/components/ai-elements/suggestion";
import type { AIInputSubmitMeta } from "@/components/ui/ai-input";
import {
  ArrowUp,
  Globe,
  Grid,
  Mic,
  Pause,
  Plus,
  Search,
  ShoppingBag,
  Youtube,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";

type HomeSearchInputProps = {
  variant?: "desktop" | "mobile";
  onSubmitOverride?: (value: string, meta?: AIInputSubmitMeta) => void;
  isStreaming?: boolean;
  onPauseStreaming?: () => void;
};

export function HomeSearchInput({
  variant = "desktop",
  onSubmitOverride,
  isStreaming = false,
  onPauseStreaming,
}: HomeSearchInputProps) {
  return (
    <PromptInputProvider>
      <HomeSearchInputContent
        variant={variant}
        onSubmitOverride={onSubmitOverride}
        isStreaming={isStreaming}
        onPauseStreaming={onPauseStreaming}
      />
    </PromptInputProvider>
  );
}

type HomeSearchInputContentProps = {
  variant: "desktop" | "mobile";
  onSubmitOverride?: (value: string, meta?: AIInputSubmitMeta) => void;
  isStreaming?: boolean;
  onPauseStreaming?: () => void;
};

function HomeSearchInputContent({
  variant,
  onSubmitOverride,
  isStreaming = false,
  onPauseStreaming,
}: HomeSearchInputContentProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useUser();
  const userId = user?.id ?? null;
  const initChat = useMutation(api.chat.initChat);
  const attachments = useProviderAttachments();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<any>(null);
  const inputValueRef = useRef("");
  const isVoiceInputRef = useRef(false);
  const [input, setInput] = useState("");
  const [isSearch, setIsSearch] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [hasRecognition, setHasRecognition] = useState(false);
  const [selectedApp, setSelectedApp] = useState<"apps" | "youtube" | "shopping">("apps");
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);
  const [showComingSoon, setShowComingSoon] = useState(false);
  const comingSoonTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const suggestions = [
    "Search the web for me",
    "Help me shop for something",
    "Find a YouTube video",
    "Explain a concept",
  ];

  const placeholderTexts = ["Ask me anything!", "How can i help ?"];
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [placeholderText, setPlaceholderText] = useState(placeholderTexts[0]);
  const [placeholderFadingOut, setPlaceholderFadingOut] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const interval = window.setInterval(() => {
      setPlaceholderFadingOut(true);
      window.setTimeout(() => {
        setPlaceholderIndex((prev) => {
          const next = (prev + 1) % placeholderTexts.length;
          setPlaceholderText(placeholderTexts[next]);
          return next;
        });
        setPlaceholderFadingOut(false);
      }, 250);
    }, 4000);
    return () => {
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    let currentId = params.get("cxid");
    if (!currentId) {
      currentId = nanoid();
      params.set("cxid", currentId);
      const newUrl = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState(
        { ...(window.history.state || {}), as: newUrl, url: newUrl },
        "",
        newUrl
      );
    }
    setChatSessionId(currentId);
    if (!userId) return;
    void (async () => {
      try {
        await initChat({
          userId,
          sessionId: currentId as string,
          title: "",
          createdAt: Date.now(),
        });
      } catch {
      }
    })();
  }, [userId, initChat]);

  useEffect(() => {
    return () => {
      if (comingSoonTimeoutRef.current) {
        clearTimeout(comingSoonTimeoutRef.current);
      }
    };
  }, []);

  const handleSuggestionClick = (value: string) => {
    setInput(value);
    submitText(value, "text");
  };

  const submitText = (rawText: string, source?: "text" | "voice") => {
    let text = rawText;
    if (!text.trim()) return;

    setInput("");
    inputValueRef.current = "";

    const effectiveSource: "text" | "voice" =
      source ?? (isVoiceInputRef.current ? "voice" : "text");
    isVoiceInputRef.current = false;

    const voiceParam = effectiveSource === "voice" ? "&voice=1" : "";
    let sessionId = chatSessionId;
    if (!sessionId) {
      sessionId = nanoid();
      setChatSessionId(sessionId);
      if (userId) {
        void (async () => {
          try {
            await initChat({
              userId,
              sessionId,
              title: "",
              createdAt: Date.now(),
            });
          } catch {
          }
        })();
      }
    }
    const chatIdParam = `&chatId=${encodeURIComponent(sessionId)}`;

    const searchParam = isSearch ? "&search=true" : "";

    if (selectedApp === "youtube") {
      text = `YouTube ${text}`;
    } else if (selectedApp === "shopping") {
      text = `Shopping ${text}`;
    }

    if (onSubmitOverride) {
      onSubmitOverride(text, { source: effectiveSource });
      return;
    }

    if (selectedApp === "youtube" || selectedApp === "shopping") {
      router.push(
        `/home/search?q=${encodeURIComponent(text)}${voiceParam}${chatIdParam}`
      );
      return;
    }

    router.push(
      `/home/search?q=${encodeURIComponent(text)}${searchParam}${voiceParam}${chatIdParam}`
    );
  };

  const handleSubmit = () => {
    submitText(input);
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    setHasRecognition("mediaDevices" in navigator && "MediaRecorder" in window);
  }, []);

  const renderActionButton = () => {
    if (isStreaming && onPauseStreaming) {
      return (
        <Button
          type="button"
          size="icon-lg"
          className="rounded-full bg-black text-white shadow-sm hover:bg-black/80 transition-transform duration-150 active:scale-95"
          onClick={onPauseStreaming}
          aria-label="Pause response"
        >
          <Pause className="h-4 w-4" />
        </Button>
      );
    }

    if (input.trim().length === 0) {
      return (
        <Button
          type="button"
          variant="outline"
          size="icon-lg"
          className={cn(
            "rounded-full transition-colors duration-200",
            isListening && "bg-accent text-accent-foreground border-transparent"
          )}
          onClick={toggleListening}
          aria-label="Record"
          disabled={!hasRecognition}
        >
          {isListening ? (
            <Pause className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
        </Button>
      );
    }

    return (
      <Button
        type="button"
        size="icon-lg"
        className="rounded-full bg-black text-white shadow-sm hover:bg-black/90 transition-transform duration-150 active:scale-95"
        onClick={handleSubmit}
        aria-label="Go"
      >
        <ArrowUp className="h-4 w-4" />
      </Button>
    );
  };

  const toggleListening = useCallback(() => {
    if (!hasRecognition) return;
    if (isListening) {
      if (recognitionRef.current instanceof MediaRecorder && recognitionRef.current.state !== "inactive") {
        recognitionRef.current.stop();
      }
      setIsListening(false);
      return;
    }
    if (!("mediaDevices" in navigator) || !("MediaRecorder" in window)) return;
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
        recognitionRef.current = recorder;
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (event) => {
          if (event.data && event.data.size > 0) {
            chunks.push(event.data);
          }
        };
        recorder.onstop = async () => {
          setIsListening(false);
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(chunks, { type: "audio/webm" });
          if (blob.size === 0) return;
          try {
            const formData = new FormData();
            formData.append("audio", blob, "audio.webm");
            const res = await fetch("/api/deepgram/stt", {
              method: "POST",
              body: formData,
            });
            if (!res.ok) return;
            const data = (await res.json()) as { transcript?: string };
            const transcript = (data.transcript || "").trim();
            if (!transcript) return;
            isVoiceInputRef.current = true;
            submitText(transcript, "voice");
          } catch (err) {
            console.error("HomeSearchInput STT error", err);
          }
        };
        recorder.start(250);
        setIsListening(true);
      })
      .catch((err) => {
        console.error("Error starting HomeSearchInput recording", err);
      });
  }, [hasRecognition, isListening, submitText]);

  useEffect(() => {
    return () => {
      if (recognitionRef.current instanceof MediaRecorder && recognitionRef.current.state !== "inactive") {
        recognitionRef.current.stop();
      }
    };
  }, []);

  const getAppIcon = () => {
    if (variant === "mobile" && isSearch) {
      return <Globe size={16} />;
    }
    switch (selectedApp) {
      case "youtube": return <Youtube size={16} />;
      case "shopping": return <ShoppingBag size={16} />;
      default: return <Grid size={16} />;
    }
  };

  const getAppLabel = () => {
    if (variant === "mobile" && isSearch) {
      return "Search";
    }
    switch (selectedApp) {
      case "youtube": return "YouTube";
      case "shopping": return "Shopping";
      default: return "Apps";
    }
  };

  return (
    <div className="w-full max-w-3xl">
      {variant === "mobile" && (
        <div className="mb-3 px-1">
          <Suggestions>
            {suggestions.map((s) => (
              <Suggestion
                key={s}
                suggestion={s}
                onClick={handleSuggestionClick}
              />
            ))}
          </Suggestions>
        </div>
      )}
      <div className="rounded-2xl border border-border/60 bg-white/70 shadow-sm backdrop-blur supports-[backdrop-filter]:bg-white/50">
        <div className="flex items-center gap-3 px-4 pt-4">
          <Search className="h-5 w-5 text-muted-foreground" />
          <div className="flex items-center gap-3 w-full">
            <div className="relative flex-1">
              <input
                value={input}
                onChange={(e) => {
                  inputValueRef.current = e.target.value;
                  setInput(e.target.value);
                }}
                className="w-full bg-transparent text-base outline-none"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const next = (e.currentTarget.value || "").trim();
                    if (next) submitText(next);
                  }
                }}
              />
              {input.length === 0 && (
                <span
                  className={cn(
                    "pointer-events-none absolute inset-y-0 left-0 flex items-center text-base text-muted-foreground transition-opacity duration-300",
                    placeholderFadingOut ? "opacity-0" : "opacity-100"
                  )}
                >
                  {placeholderText}
                </span>
              )}
            </div>
            {variant === "mobile" && renderActionButton()}
          </div>
        </div>

        <PromptInputAttachments className="px-4 pt-3">
          {(file) => <PromptInputAttachment key={file.id} data={file} />}
        </PromptInputAttachments>

        <div className="flex items-center justify-between px-4 pb-4 pt-3">
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <div className="relative">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                title="Coming soon"
                className="h-8 gap-2 cursor-not-allowed opacity-70"
                onClick={(e) => {
                  e.preventDefault();
                  if (comingSoonTimeoutRef.current) {
                    clearTimeout(comingSoonTimeoutRef.current);
                  }
                  setShowComingSoon(true);
                  comingSoonTimeoutRef.current = setTimeout(() => {
                    setShowComingSoon(false);
                  }, 900);
                }}
              >
                <Plus className="h-4 w-4" />
                <span>Add pages or files</span>
              </Button>
              {showComingSoon && (
                <div className="absolute -top-7 left-0 rounded-full bg-black/80 px-3 py-1 text-[11px] text-white">
                  Coming soon
                </div>
              )}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    "h-8 gap-2",
                    (selectedApp !== "apps" ||
                      (variant === "mobile" && isSearch)) &&
                      "text-blue-500"
                  )}
                >
                  {getAppIcon()}
                  <span>{getAppLabel()}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="center">
                <DropdownMenuItem
                  onClick={() => {
                    setSelectedApp("apps");
                    setIsSearch(true);
                  }}
                  className={cn(isSearch && "text-blue-500")}
                >
                  <Globe className="mr-2 h-4 w-4" />
                  <span>Search</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setSelectedApp("youtube");
                    setIsSearch(false);
                  }}
                  className={cn(selectedApp === "youtube" && "text-blue-500")}
                >
                  <Youtube className="mr-2 h-4 w-4" />
                  <span>YouTube</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setSelectedApp("shopping");
                    setIsSearch(false);
                  }}
                  className={cn(selectedApp === "shopping" && "text-blue-500")}
                >
                  <ShoppingBag className="mr-2 h-4 w-4" />
                  <span>Shopping</span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => {
                    setSelectedApp("apps");
                    setIsSearch(false);
                  }}
                  className={cn(selectedApp === "apps" && !isSearch && "text-blue-500")}
                >
                  <Grid className="mr-2 h-4 w-4" />
                  <span>No Apps</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {variant === "desktop" && selectedApp === "apps" && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setIsSearch(!isSearch)}
                className={cn("h-8 gap-2", isSearch && "text-blue-500")}
              >
                <Globe className="h-4 w-4" />
                <span>Search</span>
              </Button>
            )}
          </div>

          {variant === "desktop" && renderActionButton()}
        </div>
      </div>
      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        aria-label="Upload files"
        onChange={(e) => {
          if (e.currentTarget.files) {
            attachments.add(e.currentTarget.files);
          }
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}
