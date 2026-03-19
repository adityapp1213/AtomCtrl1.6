"use server";

import { detectIntent, generateSmallTalkReply, looksLikeSmallTalk } from "@/app/lib/ai/genai";
import {
  webSearch,
  imageSearch,
  summarizeItems,
  summarizeChatAnswerFromWebItems,
  summarizeChatAnswerFromShoppingItems,
} from "@/app/lib/ai/search";
import { youtubeSearch, YouTubeVideo } from "@/app/lib/ai/youtube";
import { fetchWeatherForCity, WeatherItem } from "@/app/lib/weather";
import { cookies } from "next/headers";
import { GroqClient } from "@/app/lib/ai/groq/groq-client";
import { shoppingSearch, type ShoppingProduct } from "@/app/lib/serpapi/shopping";

function looksLikeRefersToPreviousResults(q: string): boolean {
  const raw = (q || "").trim().toLowerCase();
  if (!raw) return false;
  if (raw.length > 120) return false;
  if (!/\b(this|that|it|them|these|those|above|here|there)\b/.test(raw)) return false;
  return true;
}

function extractLocationsFromQuery(q: string): string[] {
  const trimmed = (q || "").trim();
  if (!trimmed) return [];
  const lowered = trimmed.toLowerCase();
  const parts: string[] = [];
  const inIdx = lowered.indexOf(" in ");
  const forIdx = lowered.indexOf(" for ");
  const atIdx = lowered.indexOf(" at ");
  let tail = "";
  if (inIdx >= 0) tail = trimmed.slice(inIdx + 4);
  else if (forIdx >= 0) tail = trimmed.slice(forIdx + 5);
  else if (atIdx >= 0) tail = trimmed.slice(atIdx + 4);
  if (tail) {
    tail.split(/,| and /i).map((x) => x.trim()).filter(Boolean).forEach((t) => parts.push(t));
  }
  if (!parts.length) {
    if (!/\d/.test(trimmed)) parts.push(trimmed);
  }
  return Array.from(new Set(parts)).slice(0, 4);
}

function extractShoppingQuery(q: string): string | null {
  const trimmed = (q || "").trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("Shopping ")) {
    const rest = trimmed.slice(9).trim();
    return rest || null;
  }
  const patterns = [/^shop for\s+(.+)/i, /^shopping for\s+(.+)/i, /^buy\s+(.+)/i, /^purchase\s+(.+)/i];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match && match[1]) {
      const candidate = match[1].trim();
      if (candidate) return candidate;
    }
  }
  return null;
}

function extractExplicitSearchQuery(q: string): string | null {
  const trimmed = (q || "").trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  const direct = trimmed.match(/^(search|search for)\s+(.+)/i);
  if (direct && direct[2]) {
    const candidate = direct[2].trim();
    if (candidate) return candidate;
  }

  const idxFor = lower.indexOf("search for ");
  if (idxFor >= 0) {
    const candidate = trimmed.slice(idxFor + "search for ".length).trim();
    if (candidate) return candidate;
  }

  const idx = lower.indexOf("search ");
  if (idx >= 0) {
    const candidate = trimmed.slice(idx + "search ".length).trim();
    if (candidate) return candidate;
  }

  return null;
}

export type DynamicSearchResult = {
  type: "text" | "search";
  content?: string;
  data?: {
    searchQuery: string;
    overallSummaryLines: string[];
    summary?: string | null;
    webItems: { link: string; title: string; summaryLines: string[]; imageUrl?: string }[];
    mediaItems: { src: string; alt?: string }[];
    scrapedItems?: { url: string; title?: string; summary: string }[];
    weatherItems: WeatherItem[];
    youtubeItems?: YouTubeVideo[];
    shoppingItems?: ShoppingProduct[];
    shouldShowTabs: boolean;
    mapLocation?: string;
    googleMapsKey?: string;
  };
};

export type PerformSearchOptions = {
  context?: string[];
  userId?: string | null;
  sessionId?: string | null;
  shoppingLocation?: string | null;
};

export async function performDynamicSearch(
  query: string,
  options?: PerformSearchOptions
): Promise<DynamicSearchResult> {
  const trimmed = (query || "").trim();
  if (!trimmed) return { type: "text", content: "" };

  if (looksLikeSmallTalk(trimmed)) {
    const reply = await generateSmallTalkReply(trimmed);
    return { type: "text", content: reply };
  }

  const explicitShoppingQuery = extractShoppingQuery(trimmed);
  const explicitSearchQuery = extractExplicitSearchQuery(trimmed);
  const shoppingLocation = (options?.shoppingLocation || "").trim() || null;

  const aiProvider = "groq";

  const baseContext = options?.context ?? [];

  let askCloudyContext: any = null;
  let conversationContext: any = null;
  if (Array.isArray(baseContext)) {
    const marker = baseContext.find(
      (c) => typeof c === "string" && c.trim().startsWith("AskCloudyContext:")
    );
    if (marker) {
      const raw = marker.replace(/^AskCloudyContext:\s*/i, "");
      try {
        askCloudyContext = JSON.parse(raw);
      } catch {
        askCloudyContext = null;
      }
    }
    const convMarker = baseContext.find(
      (c) => typeof c === "string" && c.trim().startsWith("ConversationContext:")
    );
    if (convMarker) {
      const raw = convMarker.replace(/^ConversationContext:\s*/i, "");
      try {
        conversationContext = JSON.parse(raw);
      } catch {
        conversationContext = null;
      }
    }
  }

  const isAskCloudy = Boolean(askCloudyContext && askCloudyContext.kind === "ask_cloudy_context");

  const combinedContext = [...baseContext];

  const lastSearchQueryFromContext: string | null =
    typeof conversationContext?.latest_search?.searchQuery === "string"
      ? conversationContext.latest_search.searchQuery
      : null;

  let resolvedExplicitSearchQuery = explicitSearchQuery;
  if (explicitSearchQuery && lastSearchQueryFromContext) {
    const norm = explicitSearchQuery.toLowerCase().replace(/\s+/g, " ").trim();
    if (norm === "it" || norm === "it up" || norm === "it again" || norm === "this" || norm === "that") {
      resolvedExplicitSearchQuery = lastSearchQueryFromContext;
    }
  }

  const detectQuery = explicitShoppingQuery || resolvedExplicitSearchQuery || trimmed;
  const intent = await detectIntent(detectQuery, combinedContext);

  const shoppingQuery = intent.shoppingQuery || explicitShoppingQuery || null;
  const forceSearchTabs = Boolean(resolvedExplicitSearchQuery);
  const shouldShowTabs = intent.shouldShowTabs || forceSearchTabs;

  if (!shouldShowTabs && !shoppingQuery) {
    const raw = intent.overallSummaryLines;
    const lines = Array.isArray(raw) ? raw.filter(Boolean) : [];
    const content = lines.length > 0 ? lines.join(" ") : "Cloudy could not generate a summary for this query.";

    return {
      type: "text",
      content,
    };
  }

  let webQuery: string | null = null;
  let searchQuery: string = detectQuery;

  // If the user explicitly said "search ..." or "search for ...",
  // always use ONLY that extracted phrase as the search query.
  if (resolvedExplicitSearchQuery && !shoppingQuery && !isAskCloudy) {
    searchQuery = resolvedExplicitSearchQuery;
    webQuery = resolvedExplicitSearchQuery;
  } else {
    webQuery = intent.webSearchQuery ?? null;
    searchQuery = intent.searchQuery ?? detectQuery;
    if (shoppingQuery) {
      searchQuery = shoppingQuery;
      webQuery = null;
    }
    if (!intent.searchQuery && resolvedExplicitSearchQuery) {
      searchQuery = resolvedExplicitSearchQuery;
    }
  }
  if (isAskCloudy) {
    const selected = (askCloudyContext && (askCloudyContext as any).selected) || null;
    const link =
      selected && typeof selected.link === "string"
        ? (selected.link as string).trim()
        : "";
    const title =
      selected && typeof selected.title === "string"
        ? (selected.title as string).trim()
        : "";
    const text =
      selected && typeof selected.text === "string"
        ? (selected.text as string).trim()
        : "";
    if (link) {
      searchQuery = link;
    } else {
      const combined = `${title} ${text}`.trim();
      if (combined) {
        searchQuery = combined;
      }
    }
  }
  if (!webQuery && shouldShowTabs && !shoppingQuery) {
    webQuery = searchQuery;
  }
  let overallSummaryLines = intent.overallSummaryLines;

  const [rawWebItems, mediaItems, weatherItems, youtubeItems, shoppingItems] = await Promise.all([
    webQuery ? webSearch(searchQuery) : Promise.resolve([]),
    webQuery ? imageSearch(searchQuery) : Promise.resolve([]),
    (async () => {
      if (!webQuery) return [];
      const lower = searchQuery.toLowerCase();
      const isWeather = /(weather|forecast|temperature|rain|snow|thunder|wind|humidity)\b/.test(lower);
      if (isWeather) {
        const locs = extractLocationsFromQuery(searchQuery);
        if (locs.length) {
          return Promise.all(locs.map((city) => fetchWeatherForCity(city)));
        }
      }
      return [];
    })(),
    (async () => {
      if (intent.youtubeQuery) {
        return youtubeSearch(intent.youtubeQuery);
      }
      return [];
    })(),
    shoppingQuery
      ? shoppingSearch(shoppingQuery, {
          maxResults: 4,
          location: shoppingLocation || undefined,
        })
      : Promise.resolve([]),
  ]);

  let webItems: { link: string; title: string; summaryLines: string[]; imageUrl?: string }[] = [];
  let summary: string | null = null;
  const hasShopping = Array.isArray(shoppingItems) && shoppingItems.length > 0;

  if (rawWebItems.length > 0) {
    const s = await summarizeItems(rawWebItems, searchQuery, aiProvider);
    if (s.overallSummaryLines.length > 0) {
      overallSummaryLines = s.overallSummaryLines;
    }
    webItems = rawWebItems.map((it, idx) => {
      const found = s.summaries.find((x) => x.index === idx);
      const lines = Array.isArray(found?.summary_lines) && found.summary_lines.length
        ? found.summary_lines.slice(0, 3)
        : [it.snippet || ""].filter(Boolean).slice(0, 1);
      const normalized = [lines[0] ?? "", lines[1] ?? "", lines[2] ?? ""];
      return { link: it.link, title: it.title, summaryLines: normalized, imageUrl: it.imageUrl };
    });
    summary = await summarizeChatAnswerFromWebItems(webItems, searchQuery, aiProvider);
  } else if (hasShopping) {
    const shoppingSummary = await summarizeChatAnswerFromShoppingItems(
      shoppingItems.map((p) => ({
        title: p.title,
        priceText: p.priceText,
        price: p.price,
        rating: p.rating,
        reviewCount: p.reviewCount,
        source: p.source,
      })),
      searchQuery,
      aiProvider
    );
    if (shoppingSummary) {
      summary = shoppingSummary;
      overallSummaryLines = [shoppingSummary, ""];
    } else if (!overallSummaryLines.length) {
      overallSummaryLines = ["Found products for your request.", ""];
    }
  } else if (!overallSummaryLines.length) {
    overallSummaryLines = ["No results found.", ""];
  }

  const summaryText = overallSummaryLines.filter(Boolean).join(" ");

  return {
    type: "search",
    data: {
      searchQuery,
      overallSummaryLines,
      summary,
      webItems,
      mediaItems,
      weatherItems,
      youtubeItems,
      shoppingItems,
      shouldShowTabs: true,
      mapLocation: intent.mapLocation,
      googleMapsKey: process.env.GOOGLE_MAP_API_KEY,
    },
  };
}

export type WebTabData = {
  overallSummaryLines: string[];
  webItems: { link: string; title: string; summaryLines: string[]; imageUrl?: string }[];
};

export async function fetchWebTabData(searchQuery: string): Promise<WebTabData> {
  const q = (searchQuery || "").trim();
  if (!q) return { overallSummaryLines: [], webItems: [] };

  const aiProvider = "groq";

  const rawWebItems = await webSearch(q);
  if (!rawWebItems.length) return { overallSummaryLines: ["No results found.", ""], webItems: [] };

  const s = await summarizeItems(rawWebItems, q, aiProvider);
  const overallSummaryLines = s.overallSummaryLines.length ? s.overallSummaryLines : [];
  const webItems = rawWebItems.map((it, idx) => {
    const found = s.summaries.find((x) => x.index === idx);
    const lines = Array.isArray(found?.summary_lines) && found.summary_lines.length
      ? found.summary_lines.slice(0, 3)
      : [it.snippet || ""].filter(Boolean).slice(0, 1);
    const normalized = [lines[0] ?? "", lines[1] ?? "", lines[2] ?? ""];
    return { link: it.link, title: it.title, summaryLines: normalized, imageUrl: it.imageUrl };
  });

  return { overallSummaryLines, webItems };
}

export async function fetchMediaTabData(searchQuery: string): Promise<{ src: string; alt?: string }[]> {
  const q = (searchQuery || "").trim();
  if (!q) return [];
  return imageSearch(q);
}

export async function generateChatSummaryFromWebItems(
  webItems: { link: string; title: string; summaryLines?: string[] }[],
  searchQuery: string
): Promise<string> {
  const q = (searchQuery || "").trim();
  if (!q) return "";
  const trimmedItems = Array.isArray(webItems) ? webItems.slice(0, 3) : [];
  if (!trimmedItems.length) return "";
  const aiProvider = "groq";
  return summarizeChatAnswerFromWebItems(trimmedItems, q, aiProvider);
}
