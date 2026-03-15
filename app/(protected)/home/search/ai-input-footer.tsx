"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { useUser } from "@clerk/nextjs";
import { useMutation, useQuery } from "convex/react";
import { AIInput, type AIInputSubmitMeta } from "@/components/ui/ai-input";
import { cn } from "@/lib/utils";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
} from "@/components/ai-elements/message";
import { AtomLogo } from "@/components/logo";
import {
  extractMemoryFromWindow,
  type MemoryWindowTurn,
  type DynamicSearchResult,
} from "@/app/actions/search";
import {
  planQuerySteps,
  answerQueryDirect,
  runAgentPlan,
  type PlannedStep,
  type PlanMode,
} from "@/app/actions/agent-plan";
import { SearchResultsBlock } from "@/components/search-results-block";
import { YouTubeVideo } from "@/app/lib/ai/youtube";
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit3,
  Globe,
  Mic,
  PlayIcon,
  Quote,
  X,
} from "lucide-react";
import { Browser, BrowserTab } from "@/components/ui/browser";
import { saveChatSession, type PinnedItem } from "@/app/lib/chat-store";

import { MapBlock } from "@/components/map-block";
import Spinner7 from "@/components/spinner7";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { HomeSearchInput } from "../home-search-input";
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselHeader,
  InlineCitationCarouselIndex,
  InlineCitationCarouselItem,
  InlineCitationCarouselNext,
  InlineCitationCarouselPrev,
  InlineCitationSource,
} from "@/components/ai-elements/inline-citation";
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from "@/components/ai-elements/reasoning";
import { Queue } from "@/components/ai-elements/queue";
import { isVoiceSource, speakAssistantWithDeepgram } from "@/app/lib/deepgram/voice";

// Ensure this component is imported only on client side or handling it correctly
// Since SearchResultsBlock is a client component, it's fine.

type AskCloudyContext = {
  selectedText: string;
  source: "conversation" | "web" | "youtube" | "other";
  link?: string;
  title?: string;
  searchQuery?: string;
  messageRole?: "user" | "assistant";
  messageId?: number | string;
};

type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  promptId?: string;
  turnKey?: string;
  versionIndex?: number;
  promptVersions?: string[];
  activeVersionIndex?: number;
  isVoice?: boolean;
  type?: "text" | "search";
  data?: DynamicSearchResult["data"];
  mem0Ops?: import("@/app/lib/mem0").Mem0Operation[];
  askCloudy?: AskCloudyContext | null;
  inputsUsed?: string[];
  planReasoning?: string | null;
  planSteps?: PlannedStep[];
  planMode?: PlanMode;
};

type SearchConversationShellProps = {
  tab: string;
  searchQuery: string;
  shouldShowTabs: boolean;
  overallSummaryLines: string[];
  summary?: string | null;
  webItems: { link: string; title: string; summaryLines: string[]; imageUrl?: string }[];
  mediaItems: { src: string; alt?: string }[];
  isWeatherQuery?: boolean;
  weatherItems?: Array<{
    city: string;
    latitude?: number;
    longitude?: number;
    data?: {
      city: string;
      temperature: number;
      weatherType: "clear" | "clouds" | "rain" | "snow" | "thunderstorm" | "mist" | "unknown";
      dateTime: string;
      isDay: boolean;
    } | null;
    error?: string | null;
  }>;
  youtubeItems?: YouTubeVideo[];
  mapLocation?: string;
  googleMapsKey?: string;
  shoppingItems?: Array<{
    id: string;
    title: string;
    link: string;
    thumbnailUrl?: string;
    priceText?: string;
    price?: number | null;
    rating?: number | null;
    reviewCount?: number | null;
    source?: string;
    sourceIconUrl?: string;
  }>;
};

type AIInputFooterProps = {
  onSubmit?: (value: string, meta?: AIInputSubmitMeta) => void;
  inputValue?: string;
  onInputChange?: (value: string) => void;
  onSpeechProcessingChange?: (isProcessing: boolean) => void;
  askCloudyOverlayText?: string | null;
  onClearAskCloudyOverlay?: () => void;
};

function normalizeExternalUrl(value: string | undefined) {
  const raw = (value ?? "").trim().replace(/^['"`]+|['"`]+$/g, "");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function formatDisplayUrl(value: string) {
  try {
    const u = new URL(value);
    const host = u.hostname.replace(/^www\./i, "");
    return `www.${host}`;
  } catch {
    return value;
  }
}

function normalizeSummaryText(value: string) {
  return value
    .replace(/\r?\n+/g, " ")
    .replace(/(^|\s)[-*•]+(?=\s)/g, " ")
    .replace(/(^|\s)\d+[.)](?=\s)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function AIInputFooter({
  onSubmit,
  inputValue,
  onInputChange,
  onSpeechProcessingChange,
  askCloudyOverlayText,
  onClearAskCloudyOverlay,
}: AIInputFooterProps) {
  const router = useRouter();

  const handleSubmit = (value: string, meta?: AIInputSubmitMeta) => {
    const q = (value || "").trim();
    if (!q) return;
    if (onSubmit) {
      onSubmit(q, meta);
      return;
    }
    router.push(`/home/search?q=${encodeURIComponent(q)}&tab=chat`);
  };

  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 w-full bg-background/80 backdrop-blur-md border-t supports-[backdrop-filter]:bg-background/60 py-4">
      <div className="max-w-3xl mx-auto px-4">
        <div className="relative">
          {askCloudyOverlayText && (
            <div className="absolute -top-7 left-0 right-0 flex items-center justify-between text-xs px-3">
              <div className="inline-flex items-center gap-2 max-w-full">
                <span className="text-muted-foreground">↩</span>
                <span className="truncate text-muted-foreground">
                  “{askCloudyOverlayText}”
                </span>
              </div>
              <button
                type="button"
                onClick={onClearAskCloudyOverlay}
                className="ml-2 text-muted-foreground hover:text-foreground"
              >
                ×
              </button>
            </div>
          )}
          <AIInput
            className="animate-[fade-scale_0.2s_ease-out]"
            onSubmit={handleSubmit}
            value={inputValue}
            onValueChange={onInputChange}
            onSpeechProcessingChange={onSpeechProcessingChange}
          />
        </div>
      </div>
    </div>
  );
}

export function SearchConversationShell(props: SearchConversationShellProps) {
  const searchParams = useSearchParams();
  const router = useRouter();
  const chatId = searchParams.get("chatId");
  const voiceParam = searchParams.get("voice") === "1";
  
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(chatId);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const { user } = useUser();
  const userId = user?.id ?? null;
  const chatHistory = useQuery(
    api.chat.listChatMessages,
    userId && activeSessionId ? { userId, sessionId: activeSessionId } : "skip"
  );
  const isConvexChatLoading = Boolean(userId && activeSessionId && chatHistory === undefined);
  const loadedSessionIdRef = useRef<string | null>(null);
  
  // Browser state
  const [browserTabs, setBrowserTabs] = useState<BrowserTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [chatInputValue, setChatInputValue] = useState("");
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [isChatSwitchLoading, setIsChatSwitchLoading] = useState(false);
  const [isSpeechProcessing, setIsSpeechProcessing] = useState(false);
  const [chatLoadingQuery, setChatLoadingQuery] = useState<string>("");
  const [chatMediaLoaded, setChatMediaLoaded] = useState(0);
  const [chatMediaTotal, setChatMediaTotal] = useState(0);
  const [pendingMediaLoad, setPendingMediaLoad] = useState<{ messageId: number | null; total: number; loaded: number }>({
    messageId: null,
    total: 0,
    loaded: 0,
  });
  const [pendingStream, setPendingStream] = useState<{
    messageId: number;
    type: "search" | "text";
    text?: string;
    searchQuery?: string;
    webItems?: { link: string; title: string; summaryLines?: string[] }[];
  } | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const pendingSpeakTextRef = useRef<string | null>(null);
  const pendingSpeakShouldSpeakRef = useRef<boolean>(false);
  const lastSpokenKeyRef = useRef<string>("");
  const [activeInputSource, setActiveInputSource] = useState<AIInputSubmitMeta["source"] | null>(null);
  const [speakNonce, setSpeakNonce] = useState(0);
  const [pinnedItems, setPinnedItems] = useState<PinnedItem[]>([]);
  const [conversationMemory, setConversationMemory] = useState<string[]>([]);
  const [memoryWindowKey, setMemoryWindowKey] = useState<string | null>(null);
  const [askCloudySelection, setAskCloudySelection] = useState<{
    text: string;
    top: number;
    left: number;
    meta: AskCloudyContext;
  } | null>(null);
  const [askCloudyContext, setAskCloudyContext] = useState<AskCloudyContext | null>(null);
  const initialTurnPersistedRef = useRef(false);
  const [shoppingLocation, setShoppingLocation] = useState<string>("");
  const [shoppingLocationLoaded, setShoppingLocationLoaded] = useState(false);
  const [reasoningMessageId, setReasoningMessageId] = useState<number | null>(null);
  const [currentPlanMeta, setCurrentPlanMeta] = useState<{
    steps: PlannedStep[];
    completedCount: number;
  } | null>(null);
  const [editTarget, setEditTarget] = useState<ChatMessage | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedResetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleCopyUserMessage = (msg: ChatMessage) => {
    if (!msg.content) return;
    try {
      navigator.clipboard?.writeText(msg.content);
      const nextKey = `${String(msg.turnKey ?? msg.id)}:${msg.activeVersionIndex ?? 0}`;
      setCopiedKey(nextKey);
      if (copiedResetTimeoutRef.current) {
        clearTimeout(copiedResetTimeoutRef.current);
      }
      copiedResetTimeoutRef.current = setTimeout(() => {
        setCopiedKey(null);
      }, 900);
    } catch {
      // ignore clipboard failures
    }
  };

  const setUserActiveVersion = (turnKey: string, nextIndex: number) => {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.role !== "user" || m.turnKey !== turnKey) return m;
        const versions = Array.isArray(m.promptVersions) && m.promptVersions.length > 0 ? m.promptVersions : [m.content];
        const clamped = Math.max(0, Math.min(nextIndex, versions.length - 1));
        return {
          ...m,
          activeVersionIndex: clamped,
          content: versions[clamped] ?? m.content,
        };
      })
    );
  };

  const handleStartEditUserMessage = (msg: ChatMessage) => {
    setEditTarget(msg);
    setEditDraft(msg.content);
  };

  const handleCancelEdit = () => {
    setEditTarget(null);
    setEditDraft("");
  };

  const handleSubmitEdit = async () => {
    const nextPrompt = (editDraft || "").trim();
    if (!nextPrompt || !editTarget) {
      handleCancelEdit();
      return;
    }

    const target = editTarget;
    const turnKey = (target.turnKey || target.promptId || String(target.id)) as string;
    const basePromptId = target.promptId ? (target.promptId as any as Id<"user_prompts">) : null;
    const responseMessageId = Date.now() + 1;

    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === target.id && m.role === "user");
      if (idx < 0) return prev;
      const current = prev[idx];
      const existingVersions =
        Array.isArray(current.promptVersions) && current.promptVersions.length > 0
          ? current.promptVersions
          : [current.content];
      const next = [...prev];

      let inferredVersion = 0;
      for (let j = idx + 1; j < next.length; j += 1) {
        const msg = next[j];
        if (msg.role === "user") break;
        if (msg.role !== "assistant") continue;
        const existingIndex =
          typeof msg.versionIndex === "number" ? msg.versionIndex : null;
        const effectiveIndex = existingIndex ?? inferredVersion;
        next[j] = {
          ...msg,
          turnKey,
          versionIndex: effectiveIndex,
        };
        inferredVersion = Math.max(inferredVersion, effectiveIndex + 1);
      }

      const updatedUser: ChatMessage = {
        ...current,
        turnKey,
        promptVersions: [...existingVersions, nextPrompt],
        activeVersionIndex: existingVersions.length,
        content: nextPrompt,
      };
      const assistantPlaceholder: ChatMessage = {
        id: responseMessageId,
        role: "assistant",
        content: "Thinking!!",
        type: "text",
        turnKey,
        versionIndex: existingVersions.length,
      };
      next[idx] = updatedUser;
      next.splice(idx + 1, 0, assistantPlaceholder);
      return next;
    });

    handleCancelEdit();

    setIsChatLoading(true);
    setChatLoadingQuery(nextPrompt);
    setActiveInputSource("text");

    try {
      const contextInputs = [...messages]
        .filter((m) => {
          const hasContent =
            typeof m.content === "string" && m.content.trim().length > 0;
          const isSearch = m.type === "search" && m.data;
          return hasContent || isSearch;
        })
        .slice(-50)
        .map((m) => {
          const prefix = m.role === "user" ? "User" : "Assistant";
          if (m.type === "search" && m.data) {
            const summary =
              m.data.overallSummaryLines?.filter(Boolean).join(" ") ||
              "Search results";
            return `${prefix}: (Search for "${m.data.searchQuery}") ${summary.slice(
              0,
              500
            )}`;
          }
          const body = (m.content || "").trim().slice(0, 500);
          return `${prefix}: ${body}`;
        });

      contextInputs.push(`User: ${nextPrompt.slice(0, 500)}`);

      setReasoningMessageId(responseMessageId);
      const plan = await planQuerySteps(nextPrompt, contextInputs);
      const hasNonAnswerTool = plan.steps.some((step) => step.tool !== "answer");
      const mode: PlanMode =
        plan.mode === "plan" || hasNonAnswerTool ? "plan" : "answer";

      setCurrentPlanMeta({
        steps: plan.steps,
        completedCount: 0,
      });

      setMessages((prev) =>
        prev.map((m) =>
          m.id === responseMessageId
            ? {
                ...m,
                role: "assistant",
                content: "",
                type: "text",
                planReasoning: plan.reasoning,
                planSteps: plan.steps,
                planMode: mode,
              }
            : m
        )
      );

      if (mode === "answer") {
        const answer = await answerQueryDirect(nextPrompt, contextInputs);
        const finalAnswer =
          (answer || "").trim() ||
          "I am not able to generate a useful answer right now.";

        setPendingStream({
          messageId: responseMessageId,
          type: "text",
          text: finalAnswer,
        });

        if (userId && activeSessionId && basePromptId) {
          const responseArgs = {
            userId,
            sessionId: activeSessionId,
            promptId: basePromptId,
            responseType: "text" as const,
            content: finalAnswer,
            data: { reasoning: plan.reasoning },
            createdAt: Date.now(),
          };
          const saved = await writeResponse(responseArgs).catch(async () => {
            return await writeResponse(responseArgs);
          });
          const savedResponseId = (saved as any)?.responseId;
          if (savedResponseId) {
            await addPromptEdit({
              promptId: basePromptId,
              content: nextPrompt,
              responseId: savedResponseId,
              createdAt: Date.now(),
            });
          }
        }
      } else {
        const searchResult = await runAgentPlan(nextPrompt, {
          context: contextInputs,
          userId,
          sessionId: activeSessionId,
          shoppingLocation,
          planOverride: plan,
        });
        setCurrentPlanMeta((prev) =>
          prev ? { ...prev, completedCount: prev.steps.length } : prev
        );

        if (searchResult.type === "search" && searchResult.data) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === responseMessageId
                ? {
                    ...m,
                    role: "assistant",
                    type: "search",
                    content: searchResult.content ?? "",
                    data: searchResult.data,
                  }
                : m
            )
          );

          if (userId && activeSessionId && basePromptId) {
            const responseArgs = {
              userId,
              sessionId: activeSessionId,
              promptId: basePromptId,
              responseType: "search" as const,
              content: searchResult.content ?? "",
              data: { ...(searchResult.data as any), reasoning: plan.reasoning },
              createdAt: Date.now(),
            };
            const saved = await writeResponse(responseArgs).catch(async () => {
              return await writeResponse(responseArgs);
            });
            const savedResponseId = (saved as any)?.responseId;
            if (savedResponseId) {
              await addPromptEdit({
                promptId: basePromptId,
                content: nextPrompt,
                responseId: savedResponseId,
                createdAt: Date.now(),
              });
            }
          }
        } else {
          const fallbackAnswer =
            (searchResult.content || "").toString().trim() ||
            "I am not able to generate a useful answer right now.";
          setPendingStream({
            messageId: responseMessageId,
            type: "text",
            text: fallbackAnswer,
          });

          if (userId && activeSessionId && basePromptId) {
            const responseArgs = {
              userId,
              sessionId: activeSessionId,
              promptId: basePromptId,
              responseType: "text" as const,
              content: fallbackAnswer,
              data: { reasoning: plan.reasoning },
              createdAt: Date.now(),
            };
            const saved = await writeResponse(responseArgs).catch(async () => {
              return await writeResponse(responseArgs);
            });
            const savedResponseId = (saved as any)?.responseId;
            if (savedResponseId) {
              await addPromptEdit({
                promptId: basePromptId,
                content: nextPrompt,
                responseId: savedResponseId,
                createdAt: Date.now(),
              });
            }
          }
        }

        setCurrentPlanMeta((prev) =>
          prev ? { ...prev, completedCount: prev.steps.length } : prev
        );
      }
    } catch {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === responseMessageId
            ? {
                ...m,
                role: "assistant",
                content:
                  "There was an error processing your request. Please try again.",
              }
            : m
        )
      );
    } finally {
      setReasoningMessageId(null);
      setIsChatLoading(false);
      setActiveInputSource(null);
    }
  };
  const [isPlanDetailsOpen, setIsPlanDetailsOpen] = useState(false);

  const writePrompt = useMutation(api.chat.writePrompt);
  const writeResponse = useMutation(api.chat.writeResponse);
  const editPrompt = useMutation(api.chat.editPrompt);
  const addPromptEdit = useMutation(api.chat.addPromptEdit);
  const [storageError, setStorageError] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const saved = window.localStorage.getItem("shopping_location") || "";
      if (saved) {
        setShoppingLocation(saved);
      }
    } catch {}
    setShoppingLocationLoaded(true);
  }, []);

  const renderCitation = (
    msg: ChatMessage,
    index: number,
    variant: "inline" | "block" = "block"
  ) => {
    const inputs = msg.inputsUsed ?? [];
    const lowerInputs = inputs
      .map((line) => line.toLowerCase())
      .filter(Boolean);

    const usedUserMessages =
      lowerInputs.length === 0
        ? []
        : messages
            .slice(0, index)
            .filter(
              (m) =>
                m.role === "user" &&
                m.content &&
                m.content.trim().length > 0
            )
            .filter((m) => {
              const text = m.content.toLowerCase();
              return lowerInputs.some((li) => {
                const s = li.slice(0, 80);
                if (!s) return false;
                return text.includes(s) || s.includes(text);
              });
            });

    const webItemsForMsg =
      msg.type === "search" && msg.data ? msg.data.webItems ?? [] : [];
    const topWebItems = webItemsForMsg.slice(0, 3);

    if (usedUserMessages.length === 0 && topWebItems.length === 0) {
      return null;
    }

    const lastUserContent =
      usedUserMessages[usedUserMessages.length - 1]?.content ?? "";

    const triggerSources: string[] = [];
    if (lastUserContent) triggerSources.push(lastUserContent);
    if (topWebItems.length) {
      triggerSources.push(
        ...topWebItems.map((item) => item.title || item.link || "")
      );
    }

    const slideItems: {
      key: string;
      kind: "user" | "web" | "memory";
      id?: number;
      title: string;
      url?: string;
      description?: string;
    }[] = [];

    usedUserMessages.forEach((u) => {
      slideItems.push({
        key: `user-${u.id}`,
        kind: "user",
        id: u.id,
        title: "User input",
        description: u.content,
      });
    });

    topWebItems.forEach((item, i) => {
      const isMemoryLink = typeof item.link === "string" && item.link.startsWith("memory://");
      slideItems.push({
        key: `${isMemoryLink ? "memory" : "web"}-${i}-${item.link}`,
        kind: isMemoryLink ? "memory" : "web",
        title: item.title || item.link || "Source",
        url: isMemoryLink ? undefined : item.link,
        description: item.summaryLines?.[0],
      });
    });

    const citation = (
      <InlineCitation
        className={
          variant === "inline" ? "ml-2 align-baseline" : "mt-3 inline-flex"
        }
      >
        <InlineCitationCard>
          <InlineCitationCardTrigger sources={triggerSources} />
          <InlineCitationCardBody>
            <InlineCitationCarousel>
              <InlineCitationCarouselHeader>
                <InlineCitationCarouselPrev />
                <InlineCitationCarouselNext />
                <InlineCitationCarouselIndex />
              </InlineCitationCarouselHeader>
              <InlineCitationCarouselContent>
                {slideItems.map((item) => (
                  <InlineCitationCarouselItem key={item.key}>
                    <InlineCitationSource
                      title={item.title}
                      url={item.url}
                      description={item.description}
                    />
                  </InlineCitationCarouselItem>
                ))}
              </InlineCitationCarouselContent>
            </InlineCitationCarousel>
          </InlineCitationCardBody>
        </InlineCitationCard>
      </InlineCitation>
    );

    if (variant === "inline") {
      return citation;
    }

    return <div className="mt-3">{citation}</div>;
  };

  // Content state
  const [contentState, setContentState] = useState({
     searchQuery: props.searchQuery,
     shouldShowTabs: props.shouldShowTabs,
     overallSummaryLines: props.overallSummaryLines,
     summary: props.summary ?? null,
     webItems: props.webItems,
     mediaItems: props.mediaItems,
     isWeatherQuery: props.isWeatherQuery,
     weatherItems: props.weatherItems ?? [],
     youtubeItems: props.youtubeItems ?? [],
     mapLocation: props.mapLocation,
     googleMapsKey: props.googleMapsKey,
     tab: props.tab,
     pinnedItems: [] as PinnedItem[],
     shoppingItems: props.shoppingItems ?? [],
  });

  const {
    searchQuery,
    shouldShowTabs,
    overallSummaryLines,
    summary,
    webItems,
    mediaItems,
    isWeatherQuery,
    weatherItems,
    youtubeItems,
    mapLocation,
    googleMapsKey,
    tab,
    shoppingItems,
  } = contentState;

  useEffect(() => {
    if (chatId) {
      setActiveSessionId(chatId);
      setIsChatSwitchLoading(true);
      loadedSessionIdRef.current = null;
      setMessages([]);
      setBrowserTabs([]);
      setActiveTabId(null);
      setPinnedItems([]);
      setConversationMemory([]);
      setMemoryWindowKey(null);
      setContentState({
        searchQuery: props.searchQuery,
        shouldShowTabs: false,
        overallSummaryLines: [],
        summary: null,
        webItems: [],
        mediaItems: [],
        isWeatherQuery: false,
        weatherItems: [],
        youtubeItems: [],
        mapLocation: undefined,
        googleMapsKey: undefined,
        tab: props.tab,
        pinnedItems: [],
        shoppingItems: [],
      });
      return;
    }

    if (props.searchQuery && !chatId && userId) {
      const newId = Date.now().toString();
      setActiveSessionId(newId);
      const newUrl = `/home/search?q=${encodeURIComponent(props.searchQuery)}&tab=${props.tab}&chatId=${newId}`;
      window.history.replaceState(
        { ...(window.history.state || {}), as: newUrl, url: newUrl },
        "",
        newUrl
      );
      return;
    }

    if (!chatId && !props.searchQuery) {
      setActiveSessionId(null);
      setMessages([]);
      setBrowserTabs([]);
      setActiveTabId(null);
      setConversationMemory([]);
      setMemoryWindowKey(null);
      setContentState({
        searchQuery: "",
        shouldShowTabs: false,
        overallSummaryLines: [],
        summary: null,
        webItems: [],
        mediaItems: [],
        isWeatherQuery: false,
        weatherItems: [],
        youtubeItems: [],
        mapLocation: undefined,
        googleMapsKey: undefined,
        tab: "chat",
        pinnedItems: [],
        shoppingItems: [],
      });
      setPinnedItems([]);
    }
  }, [chatId, userId, props.searchQuery, props.tab]);

  useEffect(() => {
    if (!userId || !activeSessionId) return;
    if (chatHistory === undefined) return;
    if (!chatHistory) return;
    if (!isChatSwitchLoading && loadedSessionIdRef.current === activeSessionId) return;

    const prompts = Array.isArray(chatHistory.prompts)
      ? chatHistory.prompts
      : [];
    const responses = Array.isArray(chatHistory.responses)
      ? chatHistory.responses
      : [];

    if (!prompts.length && !responses.length) {
      setMessages([]);
      setIsChatSwitchLoading(false);
      loadedSessionIdRef.current = activeSessionId;
      return;
    }

    const promptsById = new Map<string, any>();
    prompts.forEach((p: any) => {
      promptsById.set(p._id, p);
    });

    const responsesByPrompt = new Map<string, any[]>();
    const orphanResponses: any[] = [];

    responses.forEach((r: any) => {
      const pid = r.promptId as string | null;
      if (!pid) {
        orphanResponses.push(r);
        return;
      }
      if (!responsesByPrompt.has(pid)) {
        responsesByPrompt.set(pid, []);
      }
      responsesByPrompt.get(pid)!.push(r);
    });

    const sortedPrompts = [...prompts].sort((a: any, b: any) => {
      const aCount = typeof a.countNo === "number" ? a.countNo : null;
      const bCount = typeof b.countNo === "number" ? b.countNo : null;
      if (aCount !== null && bCount !== null && aCount !== bCount) {
        return aCount - bCount;
      }
      return Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0);
    });

    const sortedOrphanResponses = orphanResponses.sort(
      (a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0)
    );

    const rebuilt: ChatMessage[] = [];
    let nextId = Date.now() - 1000 * (sortedPrompts.length + sortedOrphanResponses.length);

    sortedPrompts.forEach((p: any) => {
      const basePrompt = (p.content || "").toString();
      if (!basePrompt) return;

      const editArr = Array.isArray(p.edit) ? p.edit : [];
      const edits = [...editArr].sort(
        (a: any, b: any) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0)
      );
      const promptVersions = [
        basePrompt,
        ...edits.map((e: any) => (e?.content || "").toString()).filter(Boolean),
      ];

      const userMsgId = nextId++;
      rebuilt.push({
        id: userMsgId,
        role: "user",
        content: basePrompt,
        type: "text",
        promptId: p._id,
        turnKey: p._id,
        promptVersions,
        activeVersionIndex: 0,
      });

      const respList = (responsesByPrompt.get(p._id) || []).sort(
        (a, b) => Number(a.createdAt ?? 0) - Number(b.createdAt ?? 0)
      );

      const pushAssistant = (r: any, versionIndex: number) => {
        const hasSearchData =
          r.responseType === "search" && r.data && typeof r.data === "object";
        rebuilt.push({
          id: nextId++,
          role: "assistant",
          content: (r.content || "").toString(),
          type: hasSearchData ? "search" : "text",
          data: hasSearchData ? (r.data as DynamicSearchResult["data"]) : undefined,
          planReasoning:
            typeof r?.data?.reasoning === "string"
              ? r.data.reasoning
              : typeof r.reasoning === "string"
                ? r.reasoning
                : null,
          turnKey: p._id,
          versionIndex,
        });
      };

      const baseResponse = respList.length > 0 ? respList[0] : null;
      if (baseResponse) {
        pushAssistant(baseResponse, 0);
      }

      for (let i = 0; i < edits.length; i += 1) {
        const edit = edits[i];
        const responseId = edit?.responseId;
        const match = responseId
          ? respList.find((r: any) => String(r._id) === String(responseId))
          : null;
        if (match) {
          pushAssistant(match, i + 1);
        }
      }
    });

    sortedOrphanResponses.forEach((r) => {
      const hasSearchData =
        r.responseType === "search" &&
        r.data &&
        typeof r.data === "object";
      rebuilt.push({
        id: nextId++,
        role: "assistant",
        content: hasSearchData ? (r.content || "").toString() : (r.content || "").toString(),
        type: hasSearchData ? "search" : "text",
        data: hasSearchData
          ? (r.data as DynamicSearchResult["data"])
          : undefined,
      });
    });

    if (rebuilt.length > 0) {
      setMessages(rebuilt);
    }
    setIsChatSwitchLoading(false);
    loadedSessionIdRef.current = activeSessionId;
  }, [chatHistory, userId, activeSessionId, isChatSwitchLoading]);

  // Removed Convex loader effect to restore original chat logic

  useEffect(() => {
    const q = (searchQuery || "").trim();
    if (!q) return;
    if (!userId || !activeSessionId) return;
    if (!chatHistory) return;

    const prompts = Array.isArray(chatHistory.prompts)
      ? chatHistory.prompts
      : [];
    const responses = Array.isArray(chatHistory.responses)
      ? chatHistory.responses
      : [];

    if (prompts.length > 0 || responses.length > 0) {
      initialTurnPersistedRef.current = true;
      return;
    }

    if (initialTurnPersistedRef.current) return;
    initialTurnPersistedRef.current = true;

    void handleChatSubmit(q, {
      source: voiceParam ? "voice" : "text",
    });
  }, [searchQuery, userId, activeSessionId, chatHistory, voiceParam]);

  useEffect(() => {
    if (!userId) return;
    if (!activeSessionId) return;
    if (messages.length === 0 && !contentState.searchQuery) return;
    saveChatSession(userId, {
      id: activeSessionId,
      title: contentState.searchQuery || "New Chat",
      timestamp: Date.now(),
      messages: messages as any,
      browserTabs,
      activeTabId,
      ...contentState,
      pinnedItems,
      conversationMemory,
      memoryWindowKey,
    });
  }, [
    userId,
    activeSessionId,
    messages,
    browserTabs,
    activeTabId,
    contentState,
    pinnedItems,
    conversationMemory,
    memoryWindowKey,
  ]);

  const primaryTab: "chat" | "results" | "media" =
    tab === "media" ? "media" : tab === "chat" ? "chat" : "results";

  useEffect(() => {
    const q = (searchQuery || "").trim();
    if (!q) return;
    if (isChatLoading) return;
    if (!voiceParam) return;

    let toSpeak = "";
    if (Array.isArray(youtubeItems) && youtubeItems.length > 0) {
      toSpeak = `Here are your vids on ${q}`;
    } else if (shouldShowTabs) {
      toSpeak = overallSummaryLines.filter(Boolean).join(" ");
      if (!toSpeak.trim() && Array.isArray(webItems) && webItems.length > 0) {
        const top = webItems[0];
        toSpeak = [top.title, top.summaryLines?.[0]].filter(Boolean).join(". ");
      }
    } else {
      toSpeak = overallSummaryLines.filter(Boolean).join(" ");
    }

    toSpeak = stripCloudyMarkersForSpeech(toSpeak);
    if (!toSpeak) return;
    const mode = Array.isArray(youtubeItems) && youtubeItems.length > 0 ? "yt" : shouldShowTabs ? "tabs" : "text";
    const key = `initial:${q}:${mode}:${toSpeak.slice(0, 80)}`;
    if (lastSpokenKeyRef.current === key) return;
    lastSpokenKeyRef.current = key;
    void speakAssistantWithDeepgram(toSpeak);
  }, [isChatLoading, overallSummaryLines, searchQuery, shouldShowTabs, voiceParam, webItems, youtubeItems]);

  useEffect(() => {
    if (isSpeechProcessing) setActiveInputSource("voice");
  }, [isSpeechProcessing]);

  const [bootStatus, setBootStatus] = useState<{ query: string; webDone: boolean; mediaDone: boolean }>(() => {
    const q = (props.searchQuery || "").trim();
    return {
      query: q,
      webDone: props.webItems.length > 0,
      mediaDone: props.mediaItems.length > 0,
    };
  });
  const [chatSummaryStatus, setChatSummaryStatus] = useState<"idle" | "loading" | "ready">("idle");
  const summaryAttemptRef = useRef<string>("");
  const summaryStreamAbortRef = useRef<AbortController | null>(null);
  const messageStreamAbortRef = useRef<AbortController | null>(null);
  const streamTaskRef = useRef(0);
  const deferChatLoadingRef = useRef(false);

  useEffect(() => {
    const q = (searchQuery || "").trim();
    if (!q) {
      setBootStatus({ query: "", webDone: true, mediaDone: true });
      return;
    }
    const hasServerSnapshot =
      (props.searchQuery || "").trim() === q && !isChatLoading;
    const hasWebData =
      webItems.length > 0 ||
      overallSummaryLines.some((line) => (line || "").trim().length > 0) ||
      (summary || "").trim().length > 0 ||
      hasServerSnapshot;
    const hasMediaData = mediaItems.length > 0;
    setBootStatus((prev) => {
      if (prev.query === q) {
        return {
          query: q,
          webDone: prev.webDone || hasWebData,
          mediaDone: prev.mediaDone || hasMediaData,
        };
      }
      return { query: q, webDone: hasWebData, mediaDone: hasMediaData };
    });
  }, [searchQuery, webItems.length, mediaItems.length, overallSummaryLines, summary, props.searchQuery, isChatLoading]);

  useEffect(() => {
    summaryAttemptRef.current = "";
    setChatSummaryStatus("idle");
  }, [searchQuery]);

  useEffect(() => {
    const q = (searchQuery || "").trim();
    if (!q || !shouldShowTabs) return;
    if (summary && summary.trim().length > 0) {
      setChatSummaryStatus("ready");
      summaryAttemptRef.current = q;
      return;
    }
    if (!webItems.length) {
      setChatSummaryStatus("ready");
      return;
    }
    if (!bootStatus.webDone) return;
    if (summaryAttemptRef.current === q) return;
    if (chatSummaryStatus === "loading") return;
    setChatSummaryStatus("loading");
    summaryAttemptRef.current = q;
    summaryStreamAbortRef.current?.abort();
    const controller = new AbortController();
    summaryStreamAbortRef.current = controller;
    void (async () => {
      try {
        const resp = await fetch("/api/ai/summary-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            searchQuery: q,
            webItems: webItems.map((it) => ({
              link: it.link,
              title: it.title,
              summaryLines: it.summaryLines,
            })),
          }),
          signal: controller.signal,
        });
        if (!resp.ok || !resp.body) {
          throw new Error("stream_failed");
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (!chunk) continue;
          buffer += chunk;
          setContentState((prev) => {
            if ((prev.searchQuery || "").trim() !== q) return prev;
            return { ...prev, summary: buffer };
          });
        }
      } catch {
      } finally {
        setChatSummaryStatus("ready");
      }
    })();
    return () => controller.abort();
  }, [searchQuery, shouldShowTabs, summary, webItems, chatSummaryStatus, bootStatus.webDone]);

  useEffect(() => {
    if (!pendingStream) return;
    if (pendingMediaLoad.messageId !== null && pendingMediaLoad.messageId !== pendingStream.messageId) return;

    streamTaskRef.current += 1;
    const taskId = streamTaskRef.current;
    deferChatLoadingRef.current = false;
    setIsChatLoading(false);
    setActiveInputSource(null);

    messageStreamAbortRef.current?.abort();
    const controller = new AbortController();
    messageStreamAbortRef.current = controller;

    const run = async () => {
      if (pendingStream.type === "text") {
        const text = String(pendingStream.text ?? "");
        const parts = text.split(/(\s+)/);
        let buffer = "";
        let wordBatchCount = 0;
        const wordsPerBatch = 6;

        for (const part of parts) {
          if (!part) continue;
          if (streamTaskRef.current !== taskId) return;

          buffer += part;

          if (/\S/.test(part)) {
            wordBatchCount += 1;
          }

          const isLastChunk = buffer.length >= text.length;

          if (wordBatchCount >= wordsPerBatch || isLastChunk) {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === pendingStream.messageId ? { ...m, content: buffer } : m
              )
            );
            wordBatchCount = 0;
            await new Promise<void>((resolve) =>
              requestAnimationFrame(() => resolve())
            );
          }
        }

        setPendingStream(null);
        setCurrentPlanMeta((prev) =>
          prev ? { ...prev, completedCount: prev.steps.length } : prev
        );
        return;
      }

      const q = String(pendingStream.searchQuery ?? "").trim();
      const items = Array.isArray(pendingStream.webItems) ? pendingStream.webItems : [];
      if (!q || items.length === 0) {
        setPendingStream(null);
        return;
      }
      try {
        const resp = await fetch("/api/ai/summary-stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ searchQuery: q, webItems: items }),
          signal: controller.signal,
        });
        if (!resp.ok || !resp.body) {
          throw new Error("stream_failed");
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          if (!chunk) continue;
          buffer += chunk;
          setMessages((prev) =>
            prev.map((m) => {
              if (m.id !== pendingStream.messageId || m.type !== "search" || !m.data) return m;
              return { ...m, data: { ...m.data, summary: buffer } };
            })
          );
        }
      } catch {
      } finally {
        setPendingStream(null);
      }
    };

    void run();

    return () => controller.abort();
  }, [pendingStream, pendingMediaLoad.messageId]);


  useEffect(() => {
    const handleSelectionCheck = () => {
      const root = rootRef.current;
      if (!root) return;
      if (typeof window === "undefined") return;
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) {
        setAskCloudySelection(null);
        return;
      }
      const text = sel.toString().trim();
      if (!text) {
        setAskCloudySelection(null);
        return;
      }
      const range = sel.getRangeAt(0);
      const container =
        range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
          ? (range.commonAncestorContainer as Element)
          : range.commonAncestorContainer.parentElement;
      if (!container || !root.contains(container)) {
        setAskCloudySelection(null);
        return;
      }
      let current: HTMLElement | null =
        container instanceof HTMLElement ? container : container.parentElement;
      let meta: AskCloudyContext = {
        selectedText: text,
        source: "other",
      };
      while (current && root.contains(current)) {
        const ds = current.dataset;
        if (ds && ds.cloudyKind) {
          const kind = ds.cloudyKind as AskCloudyContext["source"];
          meta = {
            selectedText: text,
            source:
              kind === "conversation" || kind === "web" || kind === "youtube"
                ? kind
                : "other",
            link: ds.cloudyLink,
            title: ds.cloudyTitle,
            searchQuery: ds.cloudySearchQuery,
            messageRole:
              ds.cloudyRole === "user" || ds.cloudyRole === "assistant"
                ? ds.cloudyRole
                : undefined,
            messageId: ds.cloudyMessageId,
          };
          break;
        }
        current = current.parentElement;
      }
      const rect = range.getBoundingClientRect();
      const top = rect.top - 40;
      const left = rect.left + rect.width / 2;
      setAskCloudySelection({
        text,
        top,
        left,
        meta,
      });
    };

    const handleMouseUp = () => {
      setTimeout(handleSelectionCheck, 0);
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setAskCloudySelection(null);
        setAskCloudyContext(null);
        if (typeof window !== "undefined") {
          const sel = window.getSelection();
          sel?.removeAllRanges();
        }
        return;
      }
      setTimeout(handleSelectionCheck, 0);
    };

    document.addEventListener("mouseup", handleMouseUp);
    document.addEventListener("keyup", handleKeyUp);
    document.addEventListener("touchend", handleMouseUp);

    return () => {
      document.removeEventListener("mouseup", handleMouseUp);
      document.removeEventListener("keyup", handleKeyUp);
      document.removeEventListener("touchend", handleMouseUp);
    };
  }, []);


  const sources = (() => {
    const hosts: string[] = [];
    for (const it of webItems) {
      try {
        const h = new URL(it.link).hostname.replace(/^www\\./i, "");
        if (h && !hosts.includes(h)) hosts.push(h);
      } catch {}
      if (hosts.length >= 6) break;
    }
    return hosts;
  })();


  const handlePrimaryTabChange = (nextTab: "chat" | "results" | "media") => {
    setContentState((prev) => ({ ...prev, tab: nextTab }));
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (searchQuery) params.set("q", searchQuery);
    params.set("tab", nextTab);
    if (activeSessionId) params.set("chatId", activeSessionId);
    const qs = params.toString();
    const newUrl = qs ? `/home/search?${qs}` : "/home/search";
    window.history.replaceState(
      { ...window.history.state, as: newUrl, url: newUrl },
      "",
      newUrl
    );
  };

  const handleAddToChat = (text: string) => {
    setChatInputValue((prev) => {
      const prefix = prev ? prev + "\n\n" : "";
      return prefix + `> ${text}`;
    });
  };

  const handleLinkClick = (url: string, title: string) => {
    // Check if tab already exists
    const existingTab = browserTabs.find((t) => t.url === url);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }

    const newTab: BrowserTab = {
      id: Date.now().toString(),
      url,
      title,
    };
    
    setBrowserTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  };

  const handleCloseTab = (id: string) => {
    setBrowserTabs((prev) => {
      const newTabs = prev.filter((t) => t.id !== id);
      if (newTabs.length === 0) {
        setActiveTabId(null);
      } else if (activeTabId === id) {
        setActiveTabId(newTabs[newTabs.length - 1].id);
      }
      return newTabs;
    });
  };

  const handleCloseBrowser = () => {
    setBrowserTabs([]);
    setActiveTabId(null);
  };

  const handleTogglePinItem = (item: PinnedItem) => {
    setPinnedItems((prev) => {
      const idx = prev.findIndex((p) => p.id === item.id && p.kind === item.kind);
      if (idx >= 0) {
        return prev.filter((_, i) => i !== idx);
      }
      return [...prev, item];
    });
  };

  // playingVideoId moved to VideoList component

  function stripCloudyMarkersForSpeech(text: string): string {
    let value = (text || "").trim();
    if (!value) return "";
    value = value.replace(/<(https?:\/\/[^>|]+)\|([^>]+)>/g, "$2");
    value = value.replace(/<(https?:\/\/[^>]+)>/g, "");
    value = value.replace(/\*\*(.*?)\*\*/g, "$1");
    value = value.replace(/i\*(.*?)\*i/g, "$1");
    value = value.replace(/\[(\d+)\]/g, "");
    value = value.replace(/\s+/g, " ").trim();
    return value;
  }

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
    const cleaned = stripCloudyMarkersForSpeech(text);
    if (!cleaned) return;
    void speakAssistantWithDeepgram(cleaned);
  }, []);

  // speakWithCartesia definition removed


  const handleChatSubmit = async (value: string, meta?: AIInputSubmitMeta) => {
    const trimmed = (value || "").trim();
    if (!trimmed) return;

    let effectiveQuery = trimmed;
    const lower = trimmed.toLowerCase();
    const againPhrases = [
      "do it again",
      "do that again",
      "again",
      "repeat that",
      "repeat it",
      "search it again",
      "search that again",
    ];
    if (againPhrases.includes(lower)) {
      const lastSearch = [...messages].reverse().find(
        (m) => m.role === "assistant" && m.type === "search" && m.data?.searchQuery
      );
      const lastQuery = lastSearch?.data?.searchQuery;
      if (lastQuery && typeof lastQuery === "string" && lastQuery.trim().length > 0) {
        effectiveQuery = lastQuery.trim();
      }
    }

    const askCtx = askCloudyContext;
    if (askCtx) {
      setAskCloudyContext(null);
    }

    const source: AIInputSubmitMeta["source"] = meta?.source ?? "text";
    const isVoice = source === "voice";

    const baseId = Date.now();
    const responseId = baseId + 1;

    void unlockAudio();
    setChatInputValue("");
    setIsChatLoading(true);
    setChatLoadingQuery(effectiveQuery);
    setActiveInputSource(source);

    setMessages((prev) => [
      ...prev,
      {
        id: baseId,
        role: "user",
        content: trimmed,
        turnKey: String(baseId),
        promptVersions: [trimmed],
        activeVersionIndex: 0,
        isVoice,
        askCloudy: askCtx ?? null,
      },
      {
        id: responseId,
        role: "assistant",
        content: "Thinking!!",
        type: "text",
        turnKey: String(baseId),
        versionIndex: 0,
      },
    ]);

    const promptCreatedAt = Date.now();
    let promptId: Id<"user_prompts"> | null = null;
    if (userId && activeSessionId) {
      const args = {
        userId,
        sessionId: activeSessionId,
        promptText: trimmed,
        source,
        is_SST: isVoice,
        createdAt: promptCreatedAt,
        searchQuery: searchQuery || undefined,
      };
      try {
        const res = await writePrompt(args);
        promptId = (res as { promptId?: Id<"user_prompts"> }).promptId ?? null;
      } catch {
        try {
          const res = await writePrompt(args);
          promptId = (res as { promptId?: Id<"user_prompts"> }).promptId ?? null;
        } catch (err) {
          console.error("Failed to save prompt", err);
          setStorageError("Some messages could not be saved. Check your connection.");
          promptId = null;
        }
      }
    }

    if (promptId) {
      const pid = String(promptId);
      setMessages((prev) =>
        prev.map((m) =>
          m.turnKey === String(baseId)
            ? {
                ...m,
                turnKey: pid,
                ...(m.role === "user" ? { promptId: pid } : {}),
              }
            : m
        )
      );
    }

    const messagesForContext: ChatMessage[] = (() => {
      const hasSearchMessage = messages.some((m) => m.type === "search" && m.data);
      const q = (searchQuery || "").trim();
      const hasInitialSearch =
        Boolean(q) &&
        (shouldShowTabs ||
          (Array.isArray(webItems) && webItems.length > 0) ||
          (Array.isArray(mediaItems) && mediaItems.length > 0) ||
          (Array.isArray(youtubeItems) && youtubeItems.length > 0) ||
          (Array.isArray(weatherItems) && weatherItems.length > 0));
      if (!hasInitialSearch || hasSearchMessage) return messages;
      const syntheticSearch: ChatMessage = {
        id: -1,
        role: "assistant",
        content: "",
        type: "search",
        data: {
          searchQuery: q,
          overallSummaryLines,
          webItems,
          mediaItems,
          weatherItems,
          youtubeItems,
          shouldShowTabs,
          mapLocation,
          googleMapsKey,
        },
      };
      return [syntheticSearch, ...messages];
    })();

    const historyContext = messagesForContext
      .filter((m) => {
        const hasContent = typeof m.content === "string" && m.content.trim().length > 0;
        const isSearch = m.type === "search" && m.data;
        return hasContent || isSearch;
      })
      .slice(-50)
      .map((m) => {
        const prefix = m.role === "user" ? "User" : "Assistant";
        if (m.type === "search" && m.data) {
          const summary = m.data.overallSummaryLines?.filter(Boolean).join(" ") || "Search results";
          return `${prefix}: (Search for "${m.data.searchQuery}") ${summary.slice(0, 500)}`;
        }
        const body = (m.content || "").trim().slice(0, 500);
        return `${prefix}: ${body}`;
      });

    const pinnedContext = pinnedItems.slice(-10).map((p) => {
      const kindLabel = p.kind === "youtube" ? "video" : "page";
      const summary = (p.summary || "").trim().slice(0, 200);
      return `Pinned ${kindLabel}: ${p.title}${summary ? ` - ${summary}` : ""}`;
    });

    const convexHistoryContext = (() => {
    const prompts = Array.isArray(chatHistory?.prompts) ? chatHistory?.prompts : [];
    const responses = Array.isArray(chatHistory?.responses) ? chatHistory?.responses : [];
      if (!prompts.length && !responses.length) return [];
      const merged = [
        ...prompts.map((p) => {
          const editArr = Array.isArray((p as any).edit) ? ((p as any).edit as any[]) : [];
          let latestEdit: any = null;
          for (const e of editArr) {
            if (!e || typeof e !== "object") continue;
            if (!latestEdit || Number(e.createdAt ?? 0) > Number(latestEdit.createdAt ?? 0)) {
              latestEdit = e;
            }
          }
          return {
            role: "user" as const,
            type: "text" as const,
            content: ((latestEdit?.content ?? (p as any).content) || "").toString(),
            data: null as null,
            createdAt: Number((p as any).createdAt ?? 0),
          };
        }),
        ...responses.map((r) => {
          const hasSearchData =
            r.responseType === "search" && r.data && typeof r.data === "object";
          return {
            role: "assistant" as const,
            type: hasSearchData ? ("search" as const) : ("text" as const),
            content: hasSearchData ? "" : (r.content || "").toString(),
            data: hasSearchData ? (r.data as DynamicSearchResult["data"]) : null,
            createdAt: Number(r.createdAt ?? 0),
          };
        }),
      ].sort((a, b) => a.createdAt - b.createdAt);

      return merged
        .filter((m) => {
          const hasContent = typeof m.content === "string" && m.content.trim().length > 0;
          const isSearch = m.type === "search" && m.data;
          return hasContent || isSearch;
        })
        .slice(-50)
        .map((m) => {
          const prefix = m.role === "user" ? "User" : "Assistant";
          if (m.type === "search" && m.data) {
            const summary =
              m.data.overallSummaryLines?.filter(Boolean).join(" ") || "Search results";
            const searchQuery = m.data.searchQuery || "";
            return `${prefix}: (Search for "${searchQuery}") ${summary.slice(0, 500)}`;
          }
          const body = (m.content || "").trim().slice(0, 500);
          return `${prefix}: ${body}`;
        });
    })();

    const chatTurnCount = chatHistory?.chat?.count ?? 0;
    const shouldAttachConvexHistory = chatTurnCount >= 1;
    const historySet = new Set(historyContext);
    const mergedHistoryContext = shouldAttachConvexHistory
      ? [
          ...historyContext,
          ...convexHistoryContext.filter((line) => !historySet.has(line)),
        ]
      : historyContext;

    const maxWindowMessages = 6;
    const recentMessages = [...messagesForContext]
      .filter((m) => typeof m.content === "string" || (m.type === "search" && m.data))
      .slice(-maxWindowMessages);

    let lastSearchIndex = -1;
    for (let i = messagesForContext.length - 1; i >= 0; i -= 1) {
      const m = messagesForContext[i];
      if (m.type === "search" && m.data) {
        lastSearchIndex = i;
        break;
      }
    }

    let lastSearchData: DynamicSearchResult["data"] | null = null;
    if (lastSearchIndex >= 0) {
      const turnsSinceSearch = messagesForContext.length - lastSearchIndex - 1;
      if (turnsSinceSearch <= maxWindowMessages) {
        const msg = messagesForContext[lastSearchIndex];
        if (msg.type === "search" && msg.data) {
          lastSearchData = msg.data;
        }
      }
    }

    let structuredConversationContext: string | null = null;
    try {
      const conv = {
        kind: "conversation_context",
        window_size: maxWindowMessages,
        turns: recentMessages.map((m) => {
          const base = {
            role: m.role,
            type: m.type ?? "text",
            text: (m.content || "").toString().slice(0, 500),
          };
          if (m.type === "search" && m.data) {
            return {
              ...base,
              search: {
                searchQuery: m.data.searchQuery,
                overallSummary: m.data.overallSummaryLines?.slice(0, 3) ?? [],
              },
            };
          }
          return base;
        }),
        latest_search: lastSearchData
          ? {
              searchQuery: lastSearchData.searchQuery,
              overallSummary: lastSearchData.overallSummaryLines?.slice(0, 3) ?? [],
              webItems: lastSearchData.webItems
                .slice(0, 5)
                .map((it) => ({
                  link: it.link,
                  title: it.title,
                  summaryLines: it.summaryLines.slice(0, 3),
                })),
              youtubeItems: (lastSearchData.youtubeItems ?? [])
                .slice(0, 5)
                .map((yt) => ({
                  id: yt.id,
                  title: yt.title,
                  channelTitle: yt.channelTitle,
                  url: `https://www.youtube.com/watch?v=${yt.id}`,
                })),
              shoppingItems: (lastSearchData.shoppingItems ?? [])
                .slice(0, 4)
                .map((p, idx) => ({
                  index: idx + 1,
                  id: p.id ?? null,
                  title: p.title,
                  priceText: p.priceText ?? null,
                  rating: p.rating ?? null,
                  reviewCount: p.reviewCount ?? null,
                  source: p.source ?? null,
                })),
            }
          : null,
        memory: {
          summaries: conversationMemory.slice(-10),
        },
      };
      structuredConversationContext = JSON.stringify(conv);
    } catch {
      structuredConversationContext = null;
    }

    let structuredContext: string | null = null;
    if (askCtx) {
      const lastUser = [...messages]
        .slice()
        .reverse()
        .find((m) => m.role === "user");
      const lastAssistant = [...messages]
        .slice()
        .reverse()
        .find((m) => m.role === "assistant");
      const structured = {
        kind: "ask_cloudy_context",
        selected: {
          text: askCtx.selectedText,
          source: askCtx.source,
          link: askCtx.link ?? null,
          title: askCtx.title ?? null,
          search_query: askCtx.searchQuery ?? null,
          message_role: askCtx.messageRole ?? null,
          message_id: askCtx.messageId ?? null,
        },
        last_turn: {
          user: lastUser
            ? {
                role: lastUser.role,
                text: lastUser.content,
                type: lastUser.type ?? "text",
              }
            : null,
          assistant: lastAssistant
            ? {
                role: lastAssistant.role,
                text:
                  lastAssistant.type === "search" && lastAssistant.data
                    ? lastAssistant.data.overallSummaryLines
                        ?.filter(Boolean)
                        .join(" ")
                    : lastAssistant.content,
                type: lastAssistant.type ?? "text",
                search:
                  lastAssistant.type === "search" && lastAssistant.data
                    ? {
                        searchQuery: lastAssistant.data.searchQuery,
                        topWebResult:
                          lastAssistant.data.webItems &&
                          lastAssistant.data.webItems.length > 0
                            ? lastAssistant.data.webItems[0]
                            : null,
                        mapLocation: lastAssistant.data.mapLocation ?? null,
                      }
                    : null,
              }
            : null,
        },
        pinned_items: pinnedItems.slice(-10).map((p) => ({
          kind: p.kind,
          title: p.title,
          link: p.link ?? null,
          summary: (p.summary || "").slice(0, 500),
        })),
      };
      try {
        structuredContext = JSON.stringify(structured);
      } catch {
        structuredContext = null;
      }
    }

    try {
      const shouldBuildMemoryWindow = userId && activeSessionId && recentMessages.length > 0;

      let memoryTurns: MemoryWindowTurn[] = [];
      let nextWindowKey: string | null = null;

      if (shouldBuildMemoryWindow) {
        memoryTurns = recentMessages.map((m) => {
          const base = {
            role: m.role,
            type: (m.type ?? "text") as "text" | "search",
            text: (m.content || "").toString().slice(0, 500),
          };
          if (m.type === "search" && m.data) {
            return {
              ...base,
              search: {
                searchQuery: m.data.searchQuery,
                overallSummary: m.data.overallSummaryLines?.slice(0, 3) ?? [],
              },
            };
          }
          return base;
        });
        nextWindowKey = JSON.stringify(
          memoryTurns.map((t) => ({
            role: t.role,
            type: t.type,
            text: t.text,
            searchQuery: t.search?.searchQuery ?? "",
          }))
        );
      }

      if (
        shouldBuildMemoryWindow &&
        recentMessages.length === maxWindowMessages &&
        nextWindowKey &&
        nextWindowKey !== memoryWindowKey
      ) {
        void (async () => {
          const result = await extractMemoryFromWindow({
            windowKey: nextWindowKey as string,
            turns: memoryTurns,
            userId,
            sessionId: activeSessionId as string,
          });
          if (result.windowKey) {
            setMemoryWindowKey(result.windowKey);
          }
          const summary = result.conversationSummary ?? "";
          if (summary) {
            setConversationMemory((prev) => {
              const next = [...prev, summary];
              return Array.from(new Set(next)).slice(-20);
            });
          }
        })();
      }

      let baseContext: string[] = [];
      if (structuredContext) {
        baseContext = [`AskCloudyContext: ${structuredContext}`];
        if (structuredConversationContext) {
          baseContext.push(`ConversationContext: ${structuredConversationContext}`);
        }
      } else {
        baseContext = [...mergedHistoryContext, ...pinnedContext];
        if (structuredConversationContext) {
          baseContext.push(`ConversationContext: ${structuredConversationContext}`);
        }
      }
      const contextInputs = [
        ...baseContext,
        `User: ${trimmed.slice(0, 500)}`,
        effectiveQuery !== trimmed ? `EffectiveQuery: ${effectiveQuery}` : "",
      ].filter(Boolean);

      setReasoningMessageId(responseId);

      const plan = await planQuerySteps(effectiveQuery, contextInputs);

      const hasNonAnswerTool = plan.steps.some(
        (step) => step.tool !== "answer"
      );
      const mode: PlanMode =
        plan.mode === "plan" || hasNonAnswerTool ? "plan" : "answer";

      setCurrentPlanMeta({
        steps: plan.steps,
        completedCount: 0,
      });

      setMessages((prev) =>
        prev.map((m) =>
          m.id === responseId
            ? {
                ...m,
                role: "assistant",
                content: "",
                type: "text",
                planReasoning: plan.reasoning,
                planSteps: plan.steps,
                planMode: mode,
              }
            : m
        )
      );

      if (mode === "answer") {
        const answer = await answerQueryDirect(trimmed, contextInputs);
        const finalAnswer =
          (answer || "").trim() ||
          "I am not able to generate a useful answer right now.";

        setPendingStream({
          messageId: responseId,
          type: "text",
          text: finalAnswer,
        });

        if (userId && activeSessionId) {
          const responseArgs = {
            userId,
            sessionId: activeSessionId,
            promptId: promptId ?? undefined,
            responseType: "text" as const,
            content: finalAnswer,
            data: { reasoning: plan.reasoning },
            createdAt: Date.now(),
          };

          try {
            await writeResponse(responseArgs);
          } catch {
            try {
              await writeResponse(responseArgs);
            } catch (err) {
              console.error("Failed to save response", err);
              setStorageError(
                "Some messages could not be saved. Check your connection."
              );
            }
          }
        }

        pendingSpeakShouldSpeakRef.current = isVoice;
        pendingSpeakTextRef.current = finalAnswer;
      } else {
        const searchResult = await runAgentPlan(effectiveQuery, {
          context: contextInputs,
          userId,
          sessionId: activeSessionId,
          shoppingLocation,
          planOverride: plan,
        });
        setCurrentPlanMeta((prev) =>
          prev ? { ...prev, completedCount: prev.steps.length } : prev
        );

        if (searchResult.type === "search" && searchResult.data) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === responseId
                ? {
                    ...m,
                    role: "assistant",
                    type: "search",
                    content: searchResult.content ?? "",
                    data: searchResult.data,
                  }
                : m
            )
          );

          if (userId && activeSessionId) {
            const responseArgs = {
              userId,
              sessionId: activeSessionId,
              promptId: promptId ?? undefined,
              responseType: "search" as const,
              content: searchResult.content ?? "",
              data: { ...(searchResult.data as any), reasoning: plan.reasoning },
              createdAt: Date.now(),
            };

            try {
              await writeResponse(responseArgs);
            } catch {
              try {
                await writeResponse(responseArgs);
              } catch (err) {
                console.error("Failed to save response", err);
                setStorageError(
                  "Some messages could not be saved. Check your connection."
                );
              }
            }
          }
        } else {
          const fallbackAnswer =
            (searchResult.content || "").toString().trim() ||
            "I am not able to generate a useful answer right now.";

          setPendingStream({
            messageId: responseId,
            type: "text",
            text: fallbackAnswer,
          });

          if (userId && activeSessionId) {
            const responseArgs = {
              userId,
              sessionId: activeSessionId,
              promptId: promptId ?? undefined,
              responseType: "text" as const,
              content: fallbackAnswer,
              data: { reasoning: plan.reasoning },
              createdAt: Date.now(),
            };

            try {
              await writeResponse(responseArgs);
            } catch {
              try {
                await writeResponse(responseArgs);
              } catch (err) {
                console.error("Failed to save response", err);
                setStorageError(
                  "Some messages could not be saved. Check your connection."
                );
              }
            }
          }

          pendingSpeakShouldSpeakRef.current = isVoice;
          pendingSpeakTextRef.current = fallbackAnswer;
        }

        setCurrentPlanMeta((prev) =>
          prev ? { ...prev, completedCount: prev.steps.length } : prev
        );
      }

      setReasoningMessageId(null);
      setIsChatLoading(false);
      setActiveInputSource(null);
      return;
    } catch (err) {
      deferChatLoadingRef.current = false;
      pendingSpeakShouldSpeakRef.current = false;
      pendingSpeakTextRef.current = "There was an error processing your request. Please try again.";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === responseId
            ? {
                ...m,
                role: "assistant",
                content: "There was an error processing your request. Please try again.",
              }
            : m
        )
      );
    } finally {
      if (!deferChatLoadingRef.current) {
        setIsChatLoading(false);
        setActiveInputSource(null);
      }
    }
  };

  useEffect(() => {
    if (!pendingSpeakShouldSpeakRef.current) return;
    const text = (pendingSpeakTextRef.current || "").trim();
    if (!text) return;
    pendingSpeakShouldSpeakRef.current = false;
    pendingSpeakTextRef.current = null;
    void speakWithSpeechSynthesis(text);
  }, [messages, searchQuery, speakWithSpeechSynthesis]);

  const pinnedIds = pinnedItems.map((p) => p.id);

  const handleAskCloudyClick = () => {
    if (!askCloudySelection) return;
    setAskCloudyContext({
      ...askCloudySelection.meta,
      selectedText: askCloudySelection.text,
    });
    setAskCloudySelection(null);
    if (typeof window !== "undefined") {
      const sel = window.getSelection();
      sel?.removeAllRanges();
    }
  };

  const rawSummaryText = (summary || "").trim() || overallSummaryLines.filter(Boolean).join(" ");
  const firstParagraph = rawSummaryText.split(/\n\s*\n/)[0] || rawSummaryText;
  const trimmedWords = firstParagraph.split(/\s+/).slice(0, 70).join(" ");
  const summaryText = trimmedWords.trim();
  const summaryParagraphs = summaryText ? summaryText.split(/\n\s*\n/).filter(Boolean) : [];
  const summaryWordSplit = summaryText ? summaryText.split(/\s+/) : [];
  const summarySplitIndex = Math.max(1, Math.floor(summaryWordSplit.length / 2));
  const summaryFirst =
    summaryParagraphs.length >= 2 ? summaryParagraphs[0] : summaryWordSplit.slice(0, summarySplitIndex).join(" ");
  const summarySecond =
    summaryParagraphs.length >= 2
      ? summaryParagraphs.slice(1).join("\n\n")
      : summaryWordSplit.slice(summarySplitIndex).join(" ");

  const chatMediaItems = mediaItems
    .map((item) => ({ ...item, src: normalizeExternalUrl(item.src) }))
    .filter((item) => Boolean(item.src)) as Array<{ src: string; alt?: string }>;
  const chatMediaItemsLimited = chatMediaItems.slice(0, 3);

  useEffect(() => {
    setChatMediaTotal(chatMediaItemsLimited.length);
    setChatMediaLoaded(0);
  }, [chatMediaItemsLimited.length, searchQuery]);

  const handleChatMediaLoaded = useCallback(() => {
    setChatMediaLoaded((prev) => (prev < chatMediaTotal ? prev + 1 : prev));
  }, [chatMediaTotal]);

  const handlePendingMediaLoaded = useCallback(() => {
    setPendingMediaLoad((prev) => ({
      ...prev,
      loaded: prev.loaded < prev.total ? prev.loaded + 1 : prev.loaded,
    }));
  }, []);

  const handleLightboxClose = useCallback(() => {
    setLightboxIndex(null);
  }, []);

  const handleLightboxPrev = useCallback(() => {
    setLightboxIndex((prev) => {
      if (prev === null || chatMediaItemsLimited.length === 0) return prev;
      return (prev - 1 + chatMediaItemsLimited.length) % chatMediaItemsLimited.length;
    });
  }, [chatMediaItemsLimited.length]);

  const handleLightboxNext = useCallback(() => {
    setLightboxIndex((prev) => {
      if (prev === null || chatMediaItemsLimited.length === 0) return prev;
      return (prev + 1) % chatMediaItemsLimited.length;
    });
  }, [chatMediaItemsLimited.length]);

  const isAnswerStreaming =
    Boolean(pendingStream && pendingStream.type === "text");

  const handlePauseStreaming = useCallback(() => {
    if (pendingStream) {
      streamTaskRef.current += 1;
      setPendingStream(null);
      messageStreamAbortRef.current?.abort();
    }
    summaryStreamAbortRef.current?.abort();
    setChatSummaryStatus((status) =>
      status === "loading" ? "ready" : status
    );
    pendingSpeakShouldSpeakRef.current = false;
    pendingSpeakTextRef.current = "";
    setIsChatLoading(false);
    setActiveInputSource(null);
  }, [pendingStream]);

  const renderSummaryWithCitations = (text: string) => {
    const normalized = normalizeSummaryText(text || "");
    if (!normalized) return null;
    const parts = normalized.split(/\[(\d+)\]/g);
    return parts.map((part, idx) => {
      const isIndex = idx % 2 === 1;
      if (!isIndex) return <span key={`t-${idx}`}>{part}</span>;
      const sourceIndex = Number(part);
      const item = Number.isFinite(sourceIndex) ? webItems[sourceIndex - 1] : undefined;
      const label = item?.link ? formatDisplayUrl(item.link) : `[${part}]`;
      if (!item?.link) return <span key={`t-${idx}`}>{label}</span>;
      return (
        <a
          key={`t-${idx}`}
          href={item.link}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline underline-offset-2"
        >
          {label}
        </a>
      );
    });
  };

  return (
    <div className="flex flex-col h-full w-full" ref={rootRef}>
      <div className="flex-1 min-h-0 flex flex-row bg-background overflow-hidden relative">
        <h1 className="hidden md:block pointer-events-none select-none absolute top-4 left-8 text-2xl md:text-3xl font-serif italic tracking-tight text-neutral-800">
          Ctrl 1.6 Beta
        </h1>
        {askCloudySelection && (
          <button
            type="button"
            className="fixed z-[80] -translate-x-1/2 rounded-full bg-black text-white dark:bg-white dark:text-black px-3 py-1 text-xs shadow-md flex items-center gap-1 hover:bg-zinc-800 dark:hover:bg-zinc-200 transition-colors"
            style={{ top: askCloudySelection.top, left: askCloudySelection.left }}
            onClick={handleAskCloudyClick}
          >
            <Quote className="w-3 h-3" />
            <span>Ask Cloudy</span>
          </button>
        )}

        {lightboxIndex !== null && chatMediaItemsLimited[lightboxIndex] && (
          <div
            className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center"
            onClick={handleLightboxClose}
          >
            <button
              type="button"
              onClick={handleLightboxClose}
              className="absolute top-6 right-6 text-white/80 hover:text-white"
            >
              <X className="w-6 h-6" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleLightboxPrev();
              }}
              className="absolute left-6 text-white/80 hover:text-white"
            >
              <ChevronLeft className="w-8 h-8" />
            </button>
            <div
              className="max-w-5xl w-full px-10"
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={chatMediaItemsLimited[lightboxIndex].src}
                alt={chatMediaItemsLimited[lightboxIndex].alt ?? ""}
                referrerPolicy="no-referrer"
                className="w-full max-h-[80vh] object-contain rounded-lg"
              />
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleLightboxNext();
              }}
              className="absolute right-6 text-white/80 hover:text-white"
            >
              <ChevronRight className="w-8 h-8" />
            </button>
          </div>
        )}

        <div
          className={cn(
            "flex flex-col h-full transition-all duration-300 ease-in-out relative",
            browserTabs.length > 0 ? "w-1/3 min-w-[350px] border-r" : "w-full"
          )}
        >
          <div className="flex-1 w-full min-h-0 relative overflow-y-auto overflow-x-hidden">
            <Conversation className="w-full h-full">
              <ConversationContent className="max-w-5xl mx-auto px-4 pt-10 pb-64 md:pb-32">
                {(isChatSwitchLoading || isConvexChatLoading) && (
                  <div className="w-full flex justify-center">
                    <Spinner7 />
                  </div>
                )}

                {!isChatSwitchLoading &&
                  !isConvexChatLoading &&
                  messages.length === 0 &&
                  (!chatHistory?.chat || (chatHistory.chat.count ?? 0) === 0) && (
                    <>
                      <Message from="user" className="ml-auto">
                        <div className="w-full max-w-xl flex flex-row justify-end">
                          <MessageContent
                            className="bg-neutral-100 text-neutral-900 rounded-xl px-4 py-2 shadow-sm text-center"
                            data-cloudy-kind="conversation"
                            data-cloudy-role="user"
                            data-cloudy-message-id="initial-search"
                          >
                            <span className="inline-flex items-center gap-2">
                              {voiceParam && <Mic className="w-4 h-4" />}
                              <span>{searchQuery}</span>
                            </span>
                          </MessageContent>
                        </div>
                      </Message>

                      <Message from="assistant" className="mr-auto">
                        <div className="flex items-start gap-3 w-full flex-row">
                          <div className="shrink-0">
                            <AtomLogo size={28} className="text-foreground" />
                          </div>
                          <div className="w-full pt-1">
                            {overallSummaryLines.length > 0 && !shouldShowTabs && (
                              <div className="mb-4">
                                <MessageContent className="mt-1">
                                  {overallSummaryLines.filter(Boolean).join(" ")}
                                </MessageContent>
                              </div>
                            )}

                            {mapLocation && (
                              <div className="mb-6">
                                <MessageContent className="mb-2">
                                  I found {mapLocation} on the map. You can view it
                                  in the side panel.
                                </MessageContent>
                                <MapBlock
                                  location={mapLocation}
                                  onOpenSideMap={() =>
                                    handleLinkClick(
                                      `/home/map-view?location=${encodeURIComponent(
                                        mapLocation
                                      )}`,
                                      `Map: ${mapLocation}`
                                    )
                                  }
                                />
                              </div>
                            )}

                            {shouldShowTabs && (
                              <SearchResultsBlock
                                searchQuery={searchQuery}
                                overallSummaryLines={overallSummaryLines}
                                summary={summary}
                                summaryIsStreaming={chatSummaryStatus === "loading"}
                                webItems={webItems}
                                mediaItems={mediaItems}
                                weatherItems={weatherItems}
                                youtubeItems={youtubeItems}
                                shoppingItems={shoppingItems}
                                shouldShowTabs={shouldShowTabs}
                                onLinkClick={handleLinkClick}
                                onPinItem={handleTogglePinItem}
                                pinnedIds={pinnedIds}
                                onMediaLoad={handleChatMediaLoaded}
                              />
                            )}

                            {!shouldShowTabs && (
                              <>
                                {webItems.length ? (
                                  <>
                                    <div className="text-sm font-medium mb-2">
                                      Search results
                                    </div>
                                    {webItems.map((item, i) => (
                                      <div key={i} className="space-y-2 mb-8">
                                        <div className="bg-accent w-full rounded-md border px-3 py-2 text-sm">
                                          <a
                                            href={item.link}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-600 underline underline-offset-2 truncate block"
                                            title={item.title}
                                            onClick={(e) => {
                                              e.preventDefault();
                                              handleLinkClick(item.link, item.title);
                                            }}
                                          >
                                            {formatDisplayUrl(item.link)}
                                          </a>
                                        </div>
                                        <div className="bg-accent w-full rounded-md border px-3 py-2 text-sm text-muted-foreground">
                                          {item.summaryLines[0]}
                                        </div>
                                        <div className="bg-accent w-full rounded-md border px-3 py-2 text-sm text-muted-foreground">
                                          {item.summaryLines[1]}
                                        </div>
                                      </div>
                                    ))}
                                  </>
                                ) : null}
                              </>
                            )}
                          </div>
                        </div>
                      </Message>
                    </>
                  )}

                {!isChatSwitchLoading && !isConvexChatLoading && messages.length > 0 && (
                  <div className="mt-6 space-y-4">
                    {messages.map((msg, index) => {
                      if (msg.role === "assistant" && msg.turnKey) {
                        const userForTurn = messages.find(
                          (m) => m.role === "user" && m.turnKey === msg.turnKey
                        );
                        const active = userForTurn?.activeVersionIndex ?? 0;
                        const version = msg.versionIndex ?? 0;
                        if (active !== version) return null;
                      }

                      return (
                        <Message
                          key={msg.id}
                          from={msg.role}
                          className={cn(
                            msg.role === "user" ? "ml-auto" : "mr-auto"
                          )}
                        >
                        {msg.type === "search" && msg.data ? (
                          <div className="flex items-start gap-3 w-full flex-row">
                            <div className="shrink-0">
                              <AtomLogo size={28} className="text-foreground" />
                            </div>
                            <div className="w-full pt-1">
                              {msg.planReasoning && (
                                <div className="mb-3">
                                  <Reasoning
                                    isStreaming={reasoningMessageId === msg.id}
                                  >
                                    <ReasoningTrigger />
                                    <ReasoningContent>
                                      {msg.planReasoning}
                                    </ReasoningContent>
                                  </Reasoning>
                                </div>
                              )}
                              {msg.data.mapLocation && (
                                <div className="mb-6">
                                  <MessageContent className="mb-2">
                                    I found {msg.data.mapLocation} on the map. You
                                    can view it in the side panel.
                                  </MessageContent>
                                  <MapBlock
                                    location={msg.data.mapLocation}
                                    onOpenSideMap={() => {
                                      const loc = msg.data?.mapLocation;
                                      if (!loc) return;
                                      handleLinkClick(
                                        `/home/map-view?location=${encodeURIComponent(
                                          loc
                                        )}`,
                                        `Map: ${loc}`
                                      );
                                    }}
                                  />
                                </div>
                              )}
                              <SearchResultsBlock
                                searchQuery={msg.data.searchQuery}
                                overallSummaryLines={msg.data.overallSummaryLines}
                                summary={msg.data.summary}
                                summaryIsStreaming={
                                  pendingStream?.type === "search" &&
                                  pendingStream?.messageId === msg.id
                                }
                                webItems={msg.data.webItems}
                                mediaItems={msg.data.mediaItems}
                                weatherItems={msg.data.weatherItems}
                                youtubeItems={msg.data.youtubeItems}
                                shoppingItems={msg.data.shoppingItems}
                                shouldShowTabs={msg.data.shouldShowTabs}
                                onLinkClick={handleLinkClick}
                                onPinItem={handleTogglePinItem}
                                pinnedIds={pinnedIds}
                                onMediaLoad={
                                  msg.id === pendingMediaLoad.messageId
                                    ? handlePendingMediaLoaded
                                    : undefined
                                }
                              />
                              {renderCitation(msg, index)}
                            </div>
                          </div>
                        ) : (
                          <>
                            {msg.role === "assistant" ? (
                              <div className="flex items-start gap-3 w-full flex-row">
                                <div className="shrink-0">
                                  <AtomLogo size={28} className="text-foreground" />
                                </div>
                                <div className="w-full pt-1">
                                  {msg.planReasoning && (
                                    <div className="mb-3">
                                      <Reasoning
                                        isStreaming={reasoningMessageId === msg.id}
                                      >
                                        <ReasoningTrigger />
                                        <ReasoningContent>
                                          {msg.planReasoning}
                                        </ReasoningContent>
                                      </Reasoning>
                                    </div>
                                  )}
                                  {(() => {
                                    const body = (msg.content || "").trim();
                                    const reasoning = (msg.planReasoning || "").trim();
                                    const shouldHide =
                                      Boolean(reasoning) && body === reasoning;
                                    if (!body || shouldHide) return null;
                                    return (
                                      <MessageContent
                                        className="mt-1"
                                        data-cloudy-kind="conversation"
                                        data-cloudy-role={msg.role}
                                        data-cloudy-message-id={String(msg.id)}
                                      >
                                        {msg.content}
                                      </MessageContent>
                                    );
                                  })()}
                                  {renderCitation(msg, index, "inline")}
                                </div>
                              </div>
                        ) : (
                          <div className="w-full max-w-xl flex flex-col items-end gap-1 group">
                            {msg.askCloudy?.selectedText && (
                              <div className="max-w-full">
                                <div className="inline-flex items-center gap-2 rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">
                                  <span>↩</span>
                                  <span className="truncate max-w-[220px]">
                                    {msg.askCloudy.selectedText}
                                  </span>
                                </div>
                              </div>
                            )}
                            <MessageContent
                              className="bg-neutral-100 text-neutral-900 rounded-xl px-4 py-2 text-center"
                              data-cloudy-kind="conversation"
                              data-cloudy-role={msg.role}
                              data-cloudy-message-id={String(msg.id)}
                            >
                              {msg.content}
                            </MessageContent>
                            <div className="mt-1 flex items-center gap-3 text-xs text-neutral-500 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                              <button
                                type="button"
                                className="p-1 rounded-full hover:bg-neutral-200"
                                aria-label="Copy message"
                                onClick={() => handleCopyUserMessage(msg)}
                              >
                                {copiedKey ===
                                `${String(msg.turnKey ?? msg.id)}:${msg.activeVersionIndex ?? 0}` ? (
                                  <Image
                                    src="/check.png"
                                    alt="Copied"
                                    width={16}
                                    height={16}
                                    className="w-4 h-4 transition-transform duration-200 scale-100"
                                  />
                                ) : (
                                  <Copy className="w-4 h-4 transition-transform duration-200 scale-100" />
                                )}
                              </button>
                              <button
                                type="button"
                                className="p-1 rounded-full hover:bg-neutral-200"
                                aria-label="Edit message"
                                onClick={() => handleStartEditUserMessage(msg)}
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              {Array.isArray(msg.promptVersions) &&
                                msg.promptVersions.length > 1 &&
                                msg.turnKey && (
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      className="px-1 py-0.5 rounded-full hover:bg-neutral-200 disabled:opacity-40"
                                      aria-label="Previous version"
                                      disabled={(msg.activeVersionIndex ?? 0) <= 0}
                                      onClick={() =>
                                        setUserActiveVersion(
                                          msg.turnKey as string,
                                          (msg.activeVersionIndex ?? 0) - 1
                                        )
                                      }
                                    >
                                      {"<"}
                                    </button>
                                    <span className="tabular-nums">
                                      {(msg.activeVersionIndex ?? 0) + 1}/
                                      {msg.promptVersions.length}
                                    </span>
                                    <button
                                      type="button"
                                      className="px-1 py-0.5 rounded-full hover:bg-neutral-200 disabled:opacity-40"
                                      aria-label="Next version"
                                      disabled={
                                        (msg.activeVersionIndex ?? 0) >=
                                        msg.promptVersions.length - 1
                                      }
                                      onClick={() =>
                                        setUserActiveVersion(
                                          msg.turnKey as string,
                                          (msg.activeVersionIndex ?? 0) + 1
                                        )
                                      }
                                    >
                                      {">"}
                                    </button>
                                  </div>
                                )}
                            </div>
                          </div>
                        )}
                          </>
                        )}
                        </Message>
                      );
                    })}
                    {isChatLoading && shouldShowTabs && (
                      <Message from="assistant" className="mr-auto">
                        <div className="flex items-start gap-3 w-full flex-row">
                          <div className="shrink-0">
                            <AtomLogo size={28} className="text-foreground" />
                          </div>
                          <div className="w-full pt-1">
                            <MessageContent className="mt-1 text-blue-600 dark:text-blue-400">
                              Searching up…
                            </MessageContent>
                          </div>
                        </div>
                      </Message>
                    )}
                  </div>
                )}
              </ConversationContent>
              <ConversationScrollButton />
            </Conversation>
          </div>
        </div>

        {browserTabs.length > 0 && (
          <div className="flex-1 w-full h-full min-w-0 animate-in slide-in-from-right duration-300">
            <Browser
              tabs={browserTabs}
              activeTabId={activeTabId}
              onCloseTab={handleCloseTab}
              onSwitchTab={setActiveTabId}
              onClose={handleCloseBrowser}
              onAddToChat={handleAddToChat}
            />
          </div>
        )}
      </div>

      {primaryTab === "chat" && (
        <>
          {/* Desktop input (inside layout flow, no extra background bar) */}
          <div className="hidden md:block px-4 py-4 shrink-0">
            <div className="w-full max-w-3xl mx-auto space-y-2">
              {currentPlanMeta && currentPlanMeta.steps.length > 0 && (
                <div
                  onMouseLeave={() => setIsPlanDetailsOpen(false)}
                  onClick={() => {
                    if (currentPlanMeta.steps.length > 1) {
                      setIsPlanDetailsOpen((open) => !open);
                    }
                  }}
                  className={cn(
                    currentPlanMeta.steps.length > 1 && "cursor-pointer"
                  )}
                >
                  {isPlanDetailsOpen && currentPlanMeta.steps.length > 1 ? (
                    <div className="rounded-2xl border border-border/60 bg-white px-5 py-3 text-xs text-muted-foreground">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-foreground text-sm">
                          Task progress
                        </span>
                        <span className="text-[0.8rem] tabular-nums">
                          {Math.min(
                            currentPlanMeta.completedCount,
                            currentPlanMeta.steps.length
                          )}
                          /{currentPlanMeta.steps.length}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {currentPlanMeta.steps.map((step, idx) => {
                          const done =
                            currentPlanMeta.completedCount >= idx + 1;
                          return (
                            <div
                              key={step.id || idx}
                              className="flex items-start gap-2"
                            >
                              <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center">
                                <Image
                                  src={done ? "/check.png" : "/pending.png"}
                                  alt={done ? "Step complete" : "Step pending"}
                                  width={14}
                                  height={14}
                                />
                              </span>
                              <span className="truncate">
                                {step.description}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-border/60 bg-white/80 px-5 py-3 text-sm text-muted-foreground flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="inline-flex h-5 w-5 items-center justify-center">
                          <Image
                            src={
                              currentPlanMeta.completedCount >=
                              currentPlanMeta.steps.length
                                ? "/check.png"
                                : "/pending.png"
                            }
                            alt={
                              currentPlanMeta.completedCount >=
                              currentPlanMeta.steps.length
                                ? "Step complete"
                                : "Step pending"
                            }
                            width={18}
                            height={18}
                          />
                        </span>
                        <span className="truncate">
                          {currentPlanMeta.steps[0]?.description ||
                            "Planning steps"}
                        </span>
                      </div>
                      <div className="ml-3 flex items-center gap-1 text-[0.8rem] tabular-nums">
                        <span>
                          {isAnswerStreaming &&
                          currentPlanMeta.completedCount === 0
                            ? `./${currentPlanMeta.steps.length}`
                            : `${Math.min(
                                currentPlanMeta.completedCount,
                                currentPlanMeta.steps.length
                              )}/${currentPlanMeta.steps.length}`}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <HomeSearchInput
                isStreaming={isAnswerStreaming}
                onPauseStreaming={handlePauseStreaming}
                onSubmitOverride={(value, meta) => {
                  handleChatSubmit(value, meta);
                }}
              />
            </div>
          </div>

          {/* Mobile: home-style mobile input, fixed to bottom of viewport */}
          <div className="block md:hidden fixed inset-x-0 bottom-0 border-t bg-white/70 backdrop-blur supports-[backdrop-filter]:bg-white/50 px-4 py-3">
            <div className="w-full max-w-3xl mx-auto space-y-2">
              {currentPlanMeta && currentPlanMeta.steps.length > 0 && (
                <div
                  onMouseLeave={() => setIsPlanDetailsOpen(false)}
                  onClick={() => {
                    if (currentPlanMeta.steps.length > 1) {
                      setIsPlanDetailsOpen((open) => !open);
                    }
                  }}
                  className={cn(
                    currentPlanMeta.steps.length > 1 && "cursor-pointer"
                  )}
                >
                  {isPlanDetailsOpen && currentPlanMeta.steps.length > 1 ? (
                    <div className="rounded-2xl border border-border/60 bg-white px-5 py-3 text-xs text-muted-foreground">
                      <div className="flex items-center justify-between mb-2">
                        <span className="font-medium text-foreground text-sm">
                          Task progress
                        </span>
                        <span className="text-[0.8rem] tabular-nums">
                          {Math.min(
                            currentPlanMeta.completedCount,
                            currentPlanMeta.steps.length
                          )}
                          /{currentPlanMeta.steps.length}
                        </span>
                      </div>
                      <div className="space-y-1">
                        {currentPlanMeta.steps.map((step, idx) => {
                          const done =
                            currentPlanMeta.completedCount >= idx + 1;
                          return (
                            <div
                              key={step.id || idx}
                              className="flex items-start gap-2"
                            >
                              <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center">
                                <Image
                                  src={done ? "/check.png" : "/pending.png"}
                                  alt={done ? "Step complete" : "Step pending"}
                                  width={14}
                                  height={14}
                                />
                              </span>
                              <span className="truncate">
                                {step.description}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-border/60 bg-white/80 px-5 py-3 text-sm text-muted-foreground flex items-center justify-between">
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="inline-flex h-5 w-5 items-center justify-center">
                          <Image
                            src={
                              currentPlanMeta.completedCount >=
                              currentPlanMeta.steps.length
                                ? "/check.png"
                                : "/pending.png"
                            }
                            alt={
                              currentPlanMeta.completedCount >=
                              currentPlanMeta.steps.length
                                ? "Step complete"
                                : "Step pending"
                            }
                            width={18}
                            height={18}
                          />
                        </span>
                        <span className="truncate">
                          {currentPlanMeta.steps[0]?.description ||
                            "Planning steps"}
                        </span>
                      </div>
                      <div className="ml-3 flex items-center gap-1 text-[0.8rem] tabular-nums">
                        <span>
                          {isAnswerStreaming &&
                          currentPlanMeta.completedCount === 0
                            ? `./${currentPlanMeta.steps.length}`
                            : `${Math.min(
                                currentPlanMeta.completedCount,
                                currentPlanMeta.steps.length
                              )}/${currentPlanMeta.steps.length}`}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <HomeSearchInput
                variant="mobile"
                isStreaming={isAnswerStreaming}
                onPauseStreaming={handlePauseStreaming}
                onSubmitOverride={(value, meta) => {
                  handleChatSubmit(value, meta);
                }}
              />
            </div>
          </div>
          {editTarget && (
            <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/20 md:bg-black/30">
              <div className="w-full md:max-w-2xl mx-auto rounded-3xl bg-neutral-100 p-4 md:p-6">
                <textarea
                  className="w-full bg-transparent outline-none resize-none min-h-[120px] text-sm"
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                />
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="rounded-full border border-neutral-300 px-4 py-1 text-sm"
                    onClick={handleCancelEdit}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="rounded-full bg-black text-white px-4 py-1 text-sm"
                    onClick={handleSubmitEdit}
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
