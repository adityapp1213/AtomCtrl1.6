# AI Architecture and Functionality

This document summarizes all AI-related functionality in the project: how requests flow from the UI to server actions and external providers, how system prompts are constructed, and how results are rendered.

---

## 1. Core Intent Detection (`detectIntent`)

**File:** [app/lib/ai/genai.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/ai/genai.ts)

The `detectIntent` function is the central router that classifies a user query and decides which tools (web search, YouTube, maps, shopping) should be used and whether search tabs should be shown.

Key imports and types:

```ts
import { Type } from "@google/genai";
import { DETECT_INTENT_SYSTEM_PROMPT } from "./system-prompts";
import { GeminiClient } from "./gemini-client";
import { GroqClient, GroqTool } from "./groq/groq-client";

export type DetectResult = {
  shouldShowTabs: boolean;
  searchQuery: string | null;
  overallSummaryLines: string[];
  mapLocation?: string;
  youtubeQuery?: string;
  webSearchQuery?: string;
  shoppingQuery?: string;
};
```

Provider selection logic:

```ts
const hasGroqKey = Boolean(process.env.GROQ_API_KEY || process.env.OPEN_AI_API_KEY);
const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
const provider = (providerOverride || process.env.AI_PROVIDER || (hasGroqKey ? "groq" : "gemini")).toLowerCase();

if (!(hasGroqKey || hasGeminiKey)) {
  console.warn("[ai:detectIntent] Missing AI keys; AI disabled");
  return {
    shouldShowTabs: false,
    searchQuery: safeQuery,
    overallSummaryLines: [
      "AI is disabled because API keys are not set on the server.",
      "",
    ],
  };
}
```

System prompt usage:

```ts
const systemInstruction = {
  parts: [
    { text: DETECT_INTENT_SYSTEM_PROMPT },
    ...(Array.isArray(context) && context.length
      ? [
          {
            text:
              "\n\nBelow is the user's complete profile, relevant memories, and recent conversation history to provide context for the current query:\n" +
              context
                .slice(-100)
                .map((line) => `- ${line}`)
                .join("\n"),
          },
        ]
      : []),
  ],
};
```

The system prompt (in `system-prompts.ts`) describes:
- When to show search tabs.
- How to choose between web search, YouTube, maps, and shopping.
- How to interpret long-term memory lines (`Memory: ...`) and structured context (`ConversationContext`, `AskCloudyContext`).

Tool declarations (function calling) are defined for:
- `json` / `intent` (structured intent result).
- `shopping_search` (Google Shopping via SerpAPI).
- `web_search` (Google Custom Search / SerpAPI).
- `google_maps` (map location extraction).
- `youtube_search` (YouTube video search).
- `get_current_fx_rate` (FX rates).

Gemini vs Groq invocation:

```ts
const pre =
  provider === "groq" && hasGroqKey
    ? await GroqClient.getInstance().generateContent("openai/gpt-oss-20b", safeQuery, {
        tools: toolDeclarations.map(
          (d): GroqTool => ({
            type: "function",
            function: { name: d.name, description: d.description, parameters: d.parameters },
          })
        ),
        systemInstruction,
      })
    : await GeminiClient.getInstance().generateContent("gemini-2.5-flash", safeQuery, {
        tools: [
          {
            functionDeclarations: toolDeclarations.map((d) => ({
              name: d.name,
              description: d.description,
              parameters: {
                type: Type.OBJECT,
                properties: Object.fromEntries(
                  Object.entries(d.parameters.properties).map(([k, v]) => [
                    k,
                    { type: Type.STRING, description: (v as { description?: string })?.description },
                  ])
                ),
                required: d.parameters.required,
              },
            })),
          },
        ],
        systemInstruction,
      });
```

The function then parses function call arguments to produce a `DetectResult` that downstream code (server actions, search page) uses to decide what to fetch and how to render tabs.

---

## 2. Web & Image Search + Summarization

**File:** [app/lib/ai/search.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/ai/search.ts)

This module provides:
- `webSearch` (Google Custom Search + SerpAPI fallback).
- `imageSearch` (Google Custom Search Images + SerpAPI fallback).
- `summarizeItems` (LLM summarization of web results).
- `summarizeChatAnswerFromWebItems` and `summarizeChatAnswerFromShoppingItems` (chat-style answers from search/shopping results).

SerpAPI web fallback:

```ts
async function webSearchViaSerpApi(query: string, options: WebSearchOptions = {}): Promise<RawItem[]> {
  const trimmed = (query ?? "").trim();
  if (!trimmed) return [];

  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    console.warn("[ai:webSearch] Missing SERPAPI_API_KEY for SerpAPI fallback");
    return [];
  }

  const params = new URLSearchParams();
  params.set("engine", "google");
  params.set("q", trimmed);
  params.set("api_key", apiKey);
  // ...
}
```

Google Custom Search primary path:

```ts
export async function webSearch(query: string, options: WebSearchOptions = {}): Promise<RawItem[]> {
  const trimmed = (query ?? "").trim();
  if (!trimmed) return [];

  const apiKey = process.env.GOOGLE_API_KEY;
  const cxEnv = process.env.GOOGLE_CX || process.env.GOOGLE_CSE_ID;
  const cx = options.cx || cxEnv;
  if (!apiKey || !cx) {
    console.warn("[ai:webSearch] Missing GOOGLE_API_KEY or GOOGLE_CX, using SerpAPI fallback if available");
    return webSearchViaSerpApi(trimmed, options);
  }

  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", trimmed);
  // ...
}
```

Image search is analogous, hitting `searchType=image` with specific fields and falling back to SerpAPI image search when Google keys are missing.

Summarization:

```ts
export async function summarizeItems(
  items: RawItem[],
  query?: string,
  providerOverride?: "gemini" | "groq"
): Promise<{ overallSummaryLines: string[]; summaries: SummItem[] }> {
  if (!Array.isArray(items) || !items.length) {
    return { overallSummaryLines: [], summaries: [] };
  }

  const hasGroqKey = Boolean(process.env.GROQ_API_KEY || process.env.OPEN_AI_API_KEY);
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  const provider = (providerOverride || process.env.AI_PROVIDER || (hasGroqKey ? "groq" : "gemini")).toLowerCase();
  // ...
  const prompt =
    `You are answering the user query: "${trimmedQuery || "N/A"}" using web search results. ` +
    "Return strictly valid compact JSON with keys overall_summary_lines and items. " +
    // ...
```

The model is again called via `GeminiClient` or `GroqClient`, and the response is parsed via `extractJson` to a strict structure used by the UI.

---

## 3. YouTube Search

**File:** [app/lib/ai/youtube.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/ai/youtube.ts)

This module wraps the YouTube Data API v3 and is used in both the search page and server actions.

```ts
export type YouTubeVideo = {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  channelTitle: string;
  publishedAt: string;
};

export async function youtubeSearch(
  query: string,
  options: YouTubeSearchOptions = {}
): Promise<YouTubeVideo[]> {
  const trimmed = (query ?? "").trim();
  if (!trimmed) return [];

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error("[ai:youtubeSearch] Missing YOUTUBE_API_KEY");
    return [];
  }

  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("type", "video");
  // ...
}
```

The returned normalized `YouTubeVideo[]` is:
- Stored in Convex as part of `search_results`.
- Exposed via `DynamicSearchResult.data.youtubeItems`.
- Rendered in the UI via [components/search-results-block.tsx](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/components/search-results-block.tsx), which passes them into `VideoList`.

---

## 4. Shopping Search (SerpAPI)

**File:** [app/lib/serpapi/shopping.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/serpapi/shopping.ts)

This module encapsulates Google Shopping via SerpAPI.

```ts
export type ShoppingProduct = {
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
  descriptionSnippet?: string;
  additionalImageUrls?: string[];
};
```

Search wrapper:

```ts
export async function shoppingSearch(
  query: string,
  options?: ShoppingSearchOptions
): Promise<ShoppingProduct[]> {
  const q = (query || "").trim();
  if (!q) return [];

  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    console.warn("[shoppingSearch] Missing SERPAPI_API_KEY");
    return [];
  }

  const params = new URLSearchParams();
  params.set("engine", "google_shopping_light");
  params.set("q", q);
  params.set("api_key", apiKey);
  params.set("hl", options?.hl || defaultHl);
  params.set("gl", options?.gl || defaultGl);
  params.set("device", options?.device || "desktop");
  if (options?.location || defaultLocation) {
    params.set("location", options?.location || defaultLocation!);
  }
  // fetch, normalize into ShoppingProduct[]
}
```

The results flow into `DynamicSearchResult.data.shoppingItems` and are rendered by `SearchResultsBlock` as shopping cards.

---

## 5. Weather Integration

**File:** [app/lib/weather.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/weather.ts)

This module maps OpenWeather API responses into a small `WeatherItem` structure.

```ts
export type WeatherType = "clear" | "clouds" | "rain" | "snow" | "thunderstorm" | "mist" | "unknown";

export type WeatherData = {
  city: string;
  temperature: number;
  weatherType: WeatherType;
  dateTime: string;
  isDay: boolean;
};

export async function fetchWeatherForCity(city: string): Promise<WeatherItem> {
  const apiKey = process.env.OPENWEATHER_API_KEY || process.env.NEXT_PUBLIC_OPENWEATHER_API_KEY || "";
  // geocode + weather queries, map to WeatherData
}
```

Weather results are included in `DynamicSearchResult.data.weatherItems` and rendered via `WeatherWidget` inside `SearchResultsBlock`.

---

## 6. Long-Term Memory with Mem0

**File:** [app/lib/mem0.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/mem0.ts)  
**Helper:** [app/actions/memory-read.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/actions/memory-read.ts)

Mem0 provides user-level long-term memory.

Client initialization:

```ts
const MEM0_API_KEY = process.env.MEM0_API_KEY;
let mem0Client: MemoryClient | null = null;

function getClient(): MemoryClient | null {
  if (!MEM0_API_KEY) return null;
  if (!mem0Client) {
    mem0Client = new MemoryClient({ apiKey: MEM0_API_KEY });
  }
  return mem0Client;
}
```

Search for context:

```ts
export async function mem0SearchForContext(
  query: string,
  ids: Mem0Ids,
  options?: { topK?: number }
): Promise<{ lines: string[]; used: boolean }> {
  const client = getClient();
  if (!client) return { lines: [], used: false };
  const trimmed = (query || "").trim();
  if (!trimmed) return { lines: [], used: false };

  const allLines: string[] = [];
  // 1) getAll user memories -> "Memory: ..." lines
  // 2) targeted search -> additional "Memory: ..." lines
  // 3) dedupe and slice to top 50
}
```

Adding turns:

```ts
export async function mem0AddTurn(
  messages: Mem0Message[],
  ids: Mem0Ids,
  metadata?: Record<string, any>
): Promise<void> {
  const client = getClient();
  if (!client) return;
  if (!ids.userId) return;
  const cleaned = (messages || []).map((m) => ({
    role: m.role,
    content: (m.content || "").toString(),
  }));
  await (client as any).add(cleaned, {
    user_id: ids.userId,
    run_id: ids.sessionId ?? undefined,
    agent_id: "cloudy-web",
    metadata,
  });
}
```

`readConversationMemoryForQuery` in `app/actions/memory-read.ts`:
- Finds the best matching chat by title similarity to the query.
- Pulls chat history from Convex (`listChatMessages`).
- Summarizes with Groq, returning `{ chatId, title, summary, content }`.
- Used by `performDynamicSearch` to answer “what do you remember about me?” style queries, and these answers are also written back to Mem0.

---

## 7. Dynamic Search Orchestration (`performDynamicSearch`)

**File:** [app/actions/search.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/actions/search.ts)

This server action ties together:
- Intent detection (`detectIntent`).
- Web/image search, YouTube, weather, shopping.
- Mem0 retrieval and write-back.
- Structured `DynamicSearchResult` for the UI.

Key types:

```ts
export type DynamicSearchResult = {
  type: "text" | "search";
  content?: string;
  mem0Ops?: Mem0Operation[];
  data?: {
    searchQuery: string;
    overallSummaryLines: string[];
    summary?: string | null;
    webItems: { link: string; title: string; summaryLines: string[]; imageUrl?: string }[];
    mediaItems: { src: string; alt?: string }[];
    weatherItems: WeatherItem[];
    youtubeItems?: YouTubeVideo[];
    shoppingItems?: ShoppingProduct[];
    shouldShowTabs: boolean;
    mapLocation?: string;
    googleMapsKey?: string;
  };
};
```

Mem0 usage inside `performDynamicSearch`:

```ts
const mem0Ops: Mem0Operation[] = [];
// mem0SearchForContext...
const memContextResult =
  options?.userId && process.env.MEM0_API_KEY && !isAskCloudy
    ? await mem0SearchForContext(memQuery, { userId: options.userId, sessionId: options.sessionId ?? undefined })
    : { lines: [], used: false };

if (memContextResult.used) {
  mem0Ops.push("search");
}

const combinedContext = [...baseContext, ...memContext];
```

Three main branches:
- Pure text answer (no tabs) → returns `type: "text"` and writes conversation memory to Mem0.
- Memory recall via `readConversationMemoryForQuery` → returns synthetic `webItems` with `link: "memory://..."`.
- Full search flow (tabs) → calls web/image search, YouTube, weather, shopping; summarizes into `summary` and `overallSummaryLines`, and writes a “search” memory to Mem0.

`DynamicSearchResult` is later consumed by the UI to render search results and feed into TTS.

---

## 8. AI API Routes (Streaming, Health, Map Test)

### 8.1 Summary Streaming

**File:** [app/api/ai/summary-stream/route.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/ai/summary-stream/route.ts)

This route streams a plain-text summary from Groq or Gemini given `searchQuery` and `webItems`.

Core flow:

```ts
type WebItem = {
  link?: string;
  title?: string;
  summaryLines?: string[];
  snippet?: string;
};

// choose stream: Groq streaming vs Gemini streaming / fallback to generateContent

const encoder = new TextEncoder();
const body = new ReadableStream({
  async start(controller) {
    try {
      for await (const chunk of stream as AsyncIterable<string>) {
        if (chunk) controller.enqueue(encoder.encode(chunk));
      }
    } finally {
      controller.close();
    }
  },
});
```

The client (`SearchConversationShell`) consumes this stream to show a progressively updating summary for the current search tab.

### 8.2 Search Health Check

**File:** [app/api/ai/search-health/route.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/ai/search-health/route.ts)

```ts
export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").toString();
  const trimmed = q.trim();

  const intent = await detectIntent(trimmed);
  const web = await webSearch(trimmed);
  const images = await imageSearch(trimmed);
  const summary = await summarizeItems(web, trimmed);

  return NextResponse.json({
    ok: true,
    intent,
    webCount: web.length,
    imageCount: images.length,
    summaryLines: summary.overallSummaryLines.length,
  });
}
```

Used by tests (`tests/ai-search-page.test.mjs`) to validate end-to-end AI search stack.

### 8.3 Map Test

**File:** [app/api/test-map/route.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/test-map/route.ts)

This route calls `detectIntent` with `"map of tokyo"` (or `q`) to debug map-related intent classification, verifying that `mapLocation` is correctly extracted.

---

## 9. Voice / Audio: Deepgram STT & TTS

### 9.1 Client-Side TTS and STT Helpers

**Files:**
- [app/lib/deepgram/tts.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/deepgram/tts.ts)
- [app/lib/deepgram/stt.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/deepgram/stt.ts)
- [app/lib/deepgram/voice.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/deepgram/voice.ts)

TTS helper:

```ts
export async function deepgramSpeakText(text: string): Promise<void> {
  const trimmed = (text || "").trim();
  if (!trimmed) return;
  if (typeof window === "undefined") return;
  if (!("MediaSource" in window)) {
    const res = await fetch("/api/deepgram/tts", { method: "POST", ... });
    // blob -> Audio
    return;
  }

  const res = await fetch("/api/deepgram/tts", { method: "POST", ... });
  // stream via MediaSource / SourceBuffer, log client-side TTFB
}
```

STT helper:

```ts
export async function deepgramTranscribeAudioBlob(audioBlob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append("audio", audioBlob, "audio.webm");

  const res = await fetch("/api/deepgram/stt", { method: "POST", body: formData });
  const data = (await res.json()) as { transcript?: string };
  return (data.transcript || "").trim();
}
```

Voice router:

```ts
export function isVoiceSource(meta?: AIInputSubmitMeta): boolean {
  return meta?.source === "voice";
}

export async function speakAssistantWithDeepgram(text: string): Promise<void> {
  await deepgramSpeakText(text);
}
```

### 9.2 Deepgram API Routes

**Files:**
- [app/api/deepgram/tts/route.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/deepgram/tts/route.ts)
- [app/api/deepgram/stt/route.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/deepgram/stt/route.ts)

TTS route:

```ts
export async function POST(req: NextRequest) {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  const { text } = (await req.json()) as { text?: string };
  const speakUrl = `https://api.deepgram.com/v1/speak?model=${encodeURIComponent(DEEPGRAM_TTS_MODEL)}`;
  const upstream = await fetch(speakUrl, { method: "POST", headers: { Authorization: `Token ${apiKey}` }, body: JSON.stringify({ text: trimmed }) });
  // pipe upstream.body into TransformStream and respond with audio/mpeg
}
```

STT route:

```ts
export async function POST(req: NextRequest) {
  const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY || "");
  const formData = await req.formData();
  const audio = formData.get("audio");
  const { result } = await deepgramClient.listen.prerecorded.transcribeFile(buffer, {
    model: "nova-3",
    smart_format: true,
  });
  const transcript = result.results?.channels?.[0]?.alternatives?.[0]?.transcript || "";
  return NextResponse.json({ transcript });
}
```

---

## 10. UI Integration: Inputs, Chat Shell, and Results

### 10.1 AI Input Component

**File:** [app/components/ui/ai-input.tsx](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/components/ui/ai-input.tsx)

This is a generic text/voice input used by `AIInputFooter` and `HomeSearchInput`.

Key aspects:
- `AIInputSubmitMeta` indicates whether the source is `"text"` or `"voice"`.
- Uses `deepgramTranscribeAudioBlob` to convert recorded audio into text.
- Not directly calling AI, but its `onSubmit` handler is wired to `handleChatSubmit` in the chat shell.

### 10.2 Home Search Input

**File:** [app/(protected)/home/home-search-input.tsx](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/(protected)/home/home-search-input.tsx)

Responsibilities:
- Provides top-level search bar on `/home`.
- Handles:
  - App selection (`web`, `shopping`, `YouTube`) via icons.
  - Voice recording via `MediaRecorder`, posting to `/api/deepgram/stt`.
  - Routing to `/home/search?q=...&chatId=...` (and `&voice=1` for voice).
- Uses `useMutation(api.chat.writePrompt)` to create Convex prompts and `nanoid` for session IDs.

### 10.3 Search Conversation Shell & Footer

**File:** [app/(protected)/home/search/ai-input-footer.tsx](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/(protected)/home/search/ai-input-footer.tsx)

Two main parts:
- `AIInputFooter`: small wrapper that renders `AIInput` in a sticky footer.
- `SearchConversationShell`: the main client-side chat/search UI.

Key points:
- Fetches `chatHistory` via `useQuery(api.chat.listChatMessages, { userId, sessionId })`.
- Rebuilds `ChatMessage[]` from Convex prompts/responses, including search results in `msg.data`.
- Manages:
  - `conversationMemory` (in-chat summaries).
  - `Browser` tabs.
  - Pinned items (web/YouTube).
  - Streaming summary state for `/api/ai/summary-stream`.
  - TTS invocation via `speakAssistantWithDeepgram`.

Submitting messages:

```ts
const handleChatSubmit = async (value: string, meta?: AIInputSubmitMeta) => {
  // build memory window context, merged history, pinned context, mem0 context (via performDynamicSearch)
  const result = await performDynamicSearch(trimmed, {
    context: contextInputs,
    userId: userId ?? undefined,
    sessionId: activeSessionId ?? undefined,
    shoppingLocation: shoppingLocation || undefined,
  });
  // add message to local state, persist via Convex writePrompt/writeResponse,
  // set pendingSpeakTextRef for Deepgram TTS
};
```

Rendering results:

```tsx
<SearchResultsBlock
  searchQuery={msg.data.searchQuery}
  overallSummaryLines={msg.data.overallSummaryLines}
  summary={msg.data.summary}
  summaryIsStreaming={pendingStream?.type === "search" && pendingStream?.messageId === msg.id}
  webItems={msg.data.webItems}
  mediaItems={msg.data.mediaItems}
  weatherItems={msg.data.weatherItems}
  youtubeItems={msg.data.youtubeItems}
  shoppingItems={msg.data.shoppingItems}
  shouldShowTabs={msg.data.shouldShowTabs}
  onLinkClick={handleLinkClick}
  onPinItem={handleTogglePinItem}
  pinnedIds={pinnedIds}
  onMediaLoad={msg.id === pendingMediaLoad.messageId ? handlePendingMediaLoaded : undefined}
/>
```

### 10.4 Search Results Block

**File:** [components/search-results-block.tsx](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/components/search-results-block.tsx)

This client component renders:
- Summary (`Response` component from `ai-elements/response`).
- Web cards (`SearchResultItem`).
- Media grid (images).
- `WeatherWidget`.
- `VideoList` for YouTube results.
- Shopping cards.
- Tabs for switching between result types (if enabled).

It also emits events up to the shell (e.g., `onLinkClick`, `onPinItem`) so that pinned items and browser tabs can be updated.

### 10.5 AI Elements (Conversation, Message, Response, Citations)

**Directory:** `app/components/ai-elements`

Important components:
- `conversation.tsx` – wrapper for conversation layout and scroll controls.
- `message.tsx` – message bubble layout and streaming rendering.
- `response.tsx` – handles streaming AI text, code blocks, and partial chunks.
- `inline-citation.tsx` – UI for linking an assistant answer to web/memory sources, including carousel and source cards.

The assistant messages in `SearchConversationShell` wrap their text in `Message`/`MessageContent` and may append `InlineCitation` to show which web/memory inputs were used.

---

## 11. Search Page Server Component

**File:** [app/(protected)/home/search/page.tsx](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/(protected)/home/search/page.tsx)

This server component:
- Guards access with Clerk `auth()` and redirects unauthenticated users.
- Parses query parameters (`q`, `tab`, `chatId`).
- Calls:
  - `detectIntent` for the current query.
  - `webSearch`, `imageSearch`, `summarizeItems`, `youtubeSearch`, `fetchWeatherForCity`, `shoppingSearch` to pre-populate initial results for the view.
- Logs the request to Supabase via `logUserRequest`.
- Renders the layout (`AppSidebar`, `Header`) and mounts `SearchConversationShell` with initial `webItems`, `mediaItems`, `weatherItems`, `youtubeItems`, and `overallSummaryLines`.

This is the entry point that ties together server-side AI calls and the client-side chat experience.

---

## 12. Summary of AI Functionality Coverage

The implementation includes the following AI-related capabilities:

- Query intent classification and tool routing (`detectIntent` + `system-prompts.ts`).
- Web and image search with Google Custom Search and SerpAPI fallback (`search.ts`).
- LLM-based summarization of search results (`summarizeItems`, `summarizeChatAnswerFromWebItems`).
- YouTube video search (`youtube.ts`) and UI integration in `SearchResultsBlock`.
- Shopping search via SerpAPI Google Shopping (`serpapi/shopping.ts`) and Shopping cards in the UI.
- Weather lookup via OpenWeather (`weather.ts`) and `WeatherWidget`.
- Long-term cross-session memory via Mem0 (`mem0.ts`) and conversation-level memory search/answering (`memory-read.ts`, `performDynamicSearch`).
- Streaming summary endpoint (`api/ai/summary-stream`) and health check endpoint (`api/ai/search-health`).
- Map intent debugging endpoint (`api/test-map`).
- Voice input (Deepgram STT) and voice output (Deepgram TTS) via both client helpers (`deepgram/*`) and API routes.
- A rich chat/search UI that integrates all of the above through `HomeSearchInput`, `AIInputFooter`, `SearchConversationShell`, and `SearchResultsBlock`.

No additional AI modules beyond those listed above are present in the codebase; all AI-related behavior is built on this set of libraries, routes, and components.
