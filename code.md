## Overview

- Stack: Next.js App Router with TypeScript and React, using Tailwind CSS and shadcn-style Radix UI wrappers.
- Auth: Clerk for authentication and middleware-based route protection.
- Backend: Convex for chat persistence, plus Next.js route handlers for AI, Deepgram, Supabase, and analytics.
- AI: Gemini and Groq providers, Google Custom Search + SerpAPI, YouTube Data API, SerpAPI Shopping, OpenWeather, Deepgram STT/TTS, and mem0 memory.
- UX focus: Voice-first search assistant ("Cloudy") with multi-pane chat UI, map/weather/shopping integrations, and long-term conversation memory via mem0.
- **Agentic Flow**: Cloudy uses a 5-phase planning loop (Filter → Plan → Act → Reflect → Respond) with LLM-driven tool orchestration via `runAgentPlan()`.

Key files:

- [app/layout.tsx](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/layout.tsx)
- [app/page.tsx](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/page.tsx)
- [app/(protected)/home/page.tsx](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/(protected)/home/page.tsx)
- [app/(protected)/home/home-layout.tsx](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/(protected)/home/home-layout.tsx)
- [app/(protected)/home/search/page.tsx](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/(protected)/home/search/page.tsx)
- [app/(protected)/home/search/ai-input-footer.tsx](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/(protected)/home/search/ai-input-footer.tsx)
- [app/actions/search.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/actions/search.ts)
- [app/actions/agent-plan.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/actions/agent-plan.ts)
- [app/lib/ai/genai.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/ai/genai.ts)
- [app/lib/ai/search.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/ai/search.ts)
- [app/lib/ai/system-prompts.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/ai/system-prompts.ts)
- [app/lib/ai/youtube.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/ai/youtube.ts)
- [app/lib/serpapi/shopping.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/serpapi/shopping.ts)
- [app/lib/weather.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/weather.ts)
- [app/lib/chat-store.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/chat-store.ts)
- [convex/schema.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/convex/schema.ts)
- [convex/chat.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/convex/chat.ts)
- [app/api/ai/summary-stream/route.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/ai/summary-stream/route.ts)
- [app/api/ai/search-health/route.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/ai/search-health/route.ts)
- [app/api/deepgram/tts/route.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/deepgram/tts/route.ts)
- [app/api/deepgram/stt/route.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/deepgram/stt/route.ts)

- [proxy.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/proxy.ts)
- [package.json](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/package.json)

## Agentic Flow Architecture

Cloudy implements a **5-phase planning loop** where the LLM plans, calls tools, observes results, and synthesizes responses. This replaces the old `detectIntent`-only flow with a unified agent orchestrator.

### 5-Phase Loop

```
┌──────────────────────────────────────────────────────────────┐
│  PHASE 1 · FILTER     Parse context, detect continuation    │
│  PHASE 2 · PLAN       Classify intent, decide tools         │
│  PHASE 3 · ACT        Execute tools in parallel             │
│  PHASE 4 · REFLECT    Verify quality, coverage, coherence   │
│  PHASE 5 · RESPOND    Write TTS-ready reply                 │
└──────────────────────────────────────────────────────────────┘
```

### Core Components

#### Agent Orchestrator (`app/actions/agent-plan.ts`)

- [runAgentPlan](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/actions/agent-plan.ts#L495-L783): Main server action that drives the complete agentic loop
- [planQuerySteps](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/actions/agent-plan.ts#L226-L419): LLM-driven planning that decides which tools to use
- [answerQueryDirect](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/actions/agent-plan.ts#L423-L493): Direct answer generation for no-tool queries

#### Types and Structures

```ts
type PlannedTool = "answer" | "web_search" | "image_search" | "youtube_search" | "shopping_search" | "weather_city" | "scrape_urls";

type PlannedStep = {
  id: string;
  description: string;
  tool: PlannedTool;
  canRunInParallel: boolean;
  query?: string;
};

type PlanResult = {
  mode: "answer" | "plan";
  reasoning: string;
  steps: PlannedStep[];
};

type RunAgentOptions = {
  context?: string[];
  userId?: string | null;
  sessionId?: string | null;
  shoppingLocation?: string | null;
  forceSearch?: boolean;
  planOverride?: PlanResult;
};
```

### Planning Flow

1. **URL Detection**: Explicit URLs in query route to `scrape_urls` tool
2. **Small Talk Filter**: Recognizes greetings, thanks, and emotional expressions
3. **LLM Planning**: Uses Groq with `COMPACT_SYSTEM_PROMPT` to generate structured plans
4. **Tool Augmentation**: Automatically adds `image_search` and `scrape_urls` based on query patterns
5. **Parallel Execution**: Groups tools with `canRunInParallel: true` into batches

### Tool Execution Strategy

```ts
// Tools are batched by dependency analysis
const needsWeb = toolSteps.some((s) => s.tool === "web_search");
const needsImages = toolSteps.some((s) => s.tool === "image_search");
const needsYoutube = toolSteps.some((s) => s.tool === "youtube_search");
const needsShopping = toolSteps.some((s) => s.tool === "shopping_search");
const needsWeather = toolSteps.some((s) => s.tool === "weather_city");
const needsScrape = toolSteps.some((s) => s.tool === "scrape_urls");

// Scrape depends on web results if no explicit URLs provided
const scrapeDependsOnWebItems = hasScrapeStep && explicitUrls.length === 0;
```

### Query Classification Modes

From `system-prompts.ts`, queries are classified into modes that determine tool usage:

| Mode | Tools | Description |
|------|-------|-------------|
| LOOKUP | web_search | Factual, time-sensitive queries |
| UNDERSTAND | web_search | Explanations and learning |
| DECIDE | web_search + shopping | Comparisons and recommendations |
| BUILD | no tools | Design and architecture |
| EXPLORE | web_search | Open curiosity |
| CHAT | no tools | Greetings, small talk |
| SHOPPING | shopping_search + web_search | Buy/browse intent |
| BRIEFING | web_search + youtube_search | Daily digest |
| IDENTITY | no tools | Questions about Cloudy/AtomTech |

### System Prompts (`app/lib/ai/system-prompts.ts`)

- [DETECT_INTENT_SYSTEM_PROMPT](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/ai/system-prompts.ts#L1-L1600+): Comprehensive master prompt (~1600+ lines) defining:
  - 5-phase core loop with detailed phase specifications
  - Intent classification rules (Step 2A-2D)
  - Tool decision matrix (Rules 1-13)
  - Source summarization protocol
  - Response quality standards
  - TTS formatting rules
  - Query playbook directory (20+ categories, 200+ patterns)
  - AtomTech internal knowledge base
  - Personality and voice guidelines

### Intent Detection (`app/lib/ai/genai.ts`)

- [detectIntent](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/ai/genai.ts#L149-L183): Used by search page for pre-populating results
- Integrates with `DETECT_INTENT_SYSTEM_PROMPT` for tool-style JSON responses
- Returns `DetectResult` with `shouldShowTabs`, `searchQuery`, `webSearchQuery`, `youtubeQuery`, `shoppingQuery`, `mapLocation`

### Firecrawl Integration (`app/lib/ai/firecrawl.ts`)

- [scrapeUrls](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/ai/firecrawl.ts): Web scraping for deep page content
- Modes: "summary" (URL summarization) or "answer" (direct question answering)
- Used by `scrape_urls` tool in agent plan

## App Shell, Routing, and Auth

- Root layout wraps the entire app with Clerk and Convex:
  - [RootLayout](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/layout.tsx#L22-L38) uses `ClerkProvider` and a `ConvexClientProvider` to provide auth and Convex React context.
  - Uses `Geist` fonts and global Tailwind styles from `app/globals.css`.
- Landing page:
  - [app/page.tsx](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/page.tsx#L1-L6) renders `Hero3` from the onboarding folder as the public hero/marketing screen.
  - [Hero3](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/(onboarding)/hero3.tsx#L34-L73) is a rich client component that:
    - Uses Clerk (`useAuth`, `useClerk`) and `useRouter` for handling sign-in/sign-up flows.
    - Sends analytics events via `/api/analytics` and uses visual eye/cursor animation for the mascot.
- Clerk middleware:
  - [proxy.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/proxy.ts#L1-L12) exports `clerkMiddleware`, protecting both regular pages and API routes via `matcher` rules.
- Protected home:
  - [HomePage](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/(protected)/home/page.tsx#L5-L18) is an async server component that:
    - Uses `auth()` and `currentUser()` from `@clerk/nextjs/server`.
    - Redirects to `/` if the user is not authenticated.
    - Derives a friendly `displayName` from Clerk user fields and constructs a greeting message.
    - Delegates rendering to `HomeLayout`.
- Home layout and responsive behavior:
  - [HomeLayout](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/(protected)/home/home-layout.tsx#L15-L93) is a client component that:
    - Tracks viewport aspect ratio to toggle between `"desktop"` and `"mobile"` modes.
    - Uses `AppSidebar` for navigation and `HomeCloud` as a central visual element.
    - Shows `TextShimmer` greeting with the personalized message.
    - Embeds `HomeSearchInput` with different layout/spacing for mobile vs desktop.

## Search and Conversation UX

- High-level search page:
  - [Search page](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/(protected)/home/search/page.tsx#L1-L28) is a server component that:
    - Uses `auth()` for protection and `redirect` to enforce login.
    - Calls `detectIntent` to classify the query and decide whether to show tabs and which modalities (web, YouTube, shopping, map).
    - Calls `webSearch`, `imageSearch`, `summarizeItems`, `youtubeSearch`, `fetchWeatherForCity`, and `shoppingSearch` to assemble `DynamicSearchResult`-like data.
    - Logs user requests via a Supabase helper (`logUserRequest` from `@/lib/supabase-server`).
    - Renders `SearchConversationShell` (from `ai-input-footer.tsx`) with data needed for the client-side conversation interface.
- Main chat+search shell:
  - [AIInputFooter and SearchConversationShell](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/(protected)/home/search/ai-input-footer.tsx#L157-L211) live together in a large client component file.
  - `AIInputFooter`:
    - Wraps `AIInput` with a sticky bottom bar on the search page.
    - Normalizes input and uses `router.push` to update `/home/search?q=...&tab=chat` when no custom `onSubmit` is provided.
    - Integrates voice input states via `onSpeechProcessingChange` and shows an overlay when interacting with quoted text (“AskCloudy” overlay).
  - `SearchConversationShell`:
    - Reads `chatId` and `voice` from search params; tracks `activeSessionId` internally.
    - Uses Clerk’s `useUser` to identify the user and Convex `useQuery` with `api.chat.listChatMessages` to fetch messages for the session from Convex.
    - Uses `getChatSession` / `saveChatSession` from [chat-store.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/chat-store.ts#L26-L49) to sync a local client-side representation (browser tabs, pinned items, summary, etc.) with `localStorage`.
    - Manages a large amount of UI state: browser tabs, input, streaming state, media loading counters, pinned items, conversation memory, and map/weather/shopping views.
    - Uses `performDynamicSearch` and `extractMemoryFromWindow` (server actions) to trigger new searches and maintain long-term memory windows with mem0, including `Mem0Operation` metadata.
    - Integrates Deepgram voice responses via `speakAssistantWithDeepgram` and uses `isVoiceSource` to conditionally speak answers when the original source was voice.
    - Uses `SearchResultsBlock`, `InlineCitation` components, `MapBlock`, and a `Browser` view to render web cards, citations, shopping cards, videos, and maps.
- HomeSearchInput:
  - [home-search-input.tsx](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/(protected)/home/home-search-input.tsx#L1-L40) powers search input for the home screen:
    - Client component using Clerk `useUser`, Convex `useMutation`, and `nanoid` session IDs.
    - Integrates with `PromptInputProvider` and attachments (e.g., links, files) via `ai-elements/prompt-input`.
    - Provides voice controls (`Mic`, `Pause`), query type selectors (web, shopping, YouTube), and attaches metadata for AI input.
    - When submitting, coordinates with Convex `writePrompt`/`writeResponse` plus server actions to maintain a unified chat history.

## Server Actions and AI Orchestration

### Dynamic Search Orchestration (Legacy)

- [app/actions/search.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/actions/search.ts#L1-L18) is a `"use server"` module containing:
  - `performDynamicSearch`: orchestrates `detectIntent`, `webSearch`, `imageSearch`, `summarizeItems`, `summarizeChatAnswerFromWebItems`, `summarizeChatAnswerFromShoppingItems`, `youtubeSearch`, `fetchWeatherForCity`, `shoppingSearch`, and mem0 context to produce a `DynamicSearchResult`.
  - Helpers like `looksLikeRefersToPreviousResults`, `extractLocationsFromQuery`, `extractShoppingQuery`, `extractExplicitSearchQuery` to interpret user queries and disambiguate search vs follow-up.
  - Memory extraction and persistence via mem0:
    - `extractMemoryFromWindow` uses `GroqClient` to summarize a conversation window and writes "permanent facts" back to mem0 with `mem0AddTurn`.
  - Uses Next `cookies()` to select the AI provider (Groq vs Gemini) via `ai_provider` cookie.

### Agentic Plan Orchestration (New)

- [app/actions/agent-plan.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/actions/agent-plan.ts#L1-L783) is a `"use server"` module containing the new agentic flow:
  - `runAgentPlan`: Main orchestrator that drives the 5-phase loop (Filter → Plan → Act → Reflect → Respond)
  - `planQuerySteps`: LLM-driven planning using `COMPACT_SYSTEM_PROMPT` to generate structured plans
  - `answerQueryDirect`: Direct answer generation for no-tool queries
  - `looksLikeSmallTalkQuery`: Quick filter for greetings/thanks/emotional expressions
  - `extractUrlsFromText`: Parses explicit URLs from user input for `scrape_urls` tool
  - `extractFollowupTopic`: Detects edit/summarize/explain follow-ups from conversation context
  - `extractConversationContextObject`: Parses `ConversationContext` JSON blocks

### Intent Detection
  - [detectIntent](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/ai/genai.ts#L149-L183) in `genai.ts`:
    - Performs early exits for small talk (thanks/hi/etc.), returning a simple text line and disabling tabs.
    - Recognizes app-specific prefixes like `"YouTube "` to route directly to a video search experience.
    - Builds a `systemInstruction` using `DETECT_INTENT_SYSTEM_PROMPT` and optionally appends user memories / conversation history into a bullet list.
    - Uses Groq or Gemini depending on environment keys and `AI_PROVIDER`.
    - Requests tool-style JSON responses (`shouldShowTabs`, `response`, `searchQuery`, `web_search_query`, `map_location`, `shopping_query`, etc.) and normalizes them into `DetectResult`.
    - Has safety gates like `shouldAllowMapLocation` to avoid treating arbitrary text as a location.
- Web and image search abstraction:
  - [webSearch / imageSearch](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/ai/search.ts#L134-L176):
    - Prefer Google Custom Search when `GOOGLE_API_KEY` and `GOOGLE_CX`/`GOOGLE_CSE_ID` are configured.
    - Fallback to SerpAPI (`webSearchViaSerpApi` and `imageSearchViaSerpApi`) with `SERPAPI_API_KEY` when Google configuration is missing or errors occur.
    - Use `next: { revalidate: ... }` to cache responses at the edge.
  - `summarizeItems`:
    - Chooses Groq or Gemini based on env keys and provider settings.
    - Prompts the model to return strict JSON with `overall_summary_lines` and per-item summaries, then uses `extractJson` + defensive parsing to map to `{ overallSummaryLines, summaries }`.
  - `summarizeChatAnswerFromWebItems` and `summarizeChatAnswerFromShoppingItems` (further down in `search.ts`):
    - Build more chat-oriented answer strings from search result items and shopping products.
- YouTube integration:
  - [youtubeSearch](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/ai/youtube.ts#L15-L55):
    - Uses YouTube Data API v3 with `YOUTUBE_API_KEY`.
    - Requests `snippet` field and normalizes `id`, `title`, `description`, `thumbnail`, `channelTitle`, `publishedAt`.
    - Limits results and handles errors with logging.
- Shopping integration:
  - [shoppingSearch](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/serpapi/shopping.ts#L46-L91):
    - Uses SerpAPI’s `google_shopping_light` engine with `SERPAPI_API_KEY`.
    - Applies language/geo defaults (`SHOPPING_DEFAULT_HL`, `SHOPPING_DEFAULT_GL`, `SHOPPING_DEFAULT_LOCATION`) with optional overrides from `ShoppingSearchOptions`.
    - Normalizes `ShoppingProduct` objects: `id`, `title`, `link`, `thumbnailUrl`, `price`, `rating`, `reviewCount`, `source`, `descriptionSnippet`, `additionalImageUrls`.
    - Caps to `maxResults` (default 4).

## AI Provider Clients

- Basic structure:
  - [app/lib/ai/gemini-client.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/ai/gemini-client.ts) and [app/lib/ai/groq/groq-client.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/ai/groq/groq-client.ts) implement singleton-style client wrappers.
  - They hide provider-specific initialization and expose unified methods like `generateContent` and `streamContent`.
- Usage:
  - `detectIntent`, `summarizeItems`, `summary-stream`, and memory extraction all call these wrappers rather than talking to the SDKs directly.
  - Provider selection is mostly driven by env flags and cookies:
    - `GROQ_API_KEY` / `OPEN_AI_API_KEY`
    - `GEMINI_API_KEY` / `GOOGLE_API_KEY`
    - `AI_PROVIDER` env and `ai_provider` cookie.

## Voice and Audio (Deepgram)

- Client-side TTS:
  - [deepgramSpeakText](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/deepgram/tts.ts#L3-L23):
    - If `MediaSource` is not available (older browsers), falls back to a simple fetch of `/api/deepgram/tts` and plays the returned blob as a single audio file.
  - Streaming mode:
    - When `MediaSource` exists, requests `/api/deepgram/tts` and:
      - Uses `ReadableStreamDefaultReader` to read chunks.
      - Feeds them into a `MediaSource` + `SourceBuffer` with a small queue, logging TTFB.
      - Plays audio via a shared `currentAudio` element.
  - [stopDeepgramAudio](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/deepgram/tts.ts#L113-L119) stops playback and resets the shared audio.
- Voice routing helpers:
  - [voice.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/deepgram/voice.ts#L4-L9) has:
    - `isVoiceSource`: checks `AIInputSubmitMeta.source` for `"voice"`.
    - `speakAssistantWithDeepgram`: delegates to `deepgramSpeakText`.
- Server-side TTS:
  - [api/deepgram/tts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/deepgram/tts/route.ts#L1-L37):
    - Validates `DEEPGRAM_API_KEY` and required text, then calls Deepgram’s `/v1/speak` with selected `DEEPGRAM_TTS_MODEL`.
    - Streams bytes into a `TransformStream` and pipes through to the client with basic logging hooks.
- STT:
  - [api/deepgram/stt](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/deepgram/stt/route.ts#L6-L55):
    - Uses `@deepgram/sdk`’s `createClient` with `DEEPGRAM_API_KEY`.
    - Accepts multipart-form audio; transcribes via `listen.prerecorded.transcribeFile` using the `nova-3` model.
    - Returns a simple JSON `{ transcript }`, handling common errors.

## Convex Data Model and Chat Persistence

- Schema:
  - [convex/schema.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/convex/schema.ts#L4-L13) defines `chats` with `userId`, `sessionId`, `title`, `name`, `count`, timestamps, and indexes by `(userId, sessionId)`.
  - `user_prompts` table stores prompts with metadata:
    - `content`, `source`, `is_SST`, `searchQuery`, `countNo`, `createdAt`.
    - Indexed by `(userId, sessionId)` and `chatId`.
  - `responses` table stores AI responses:
    - `responseType` (`"text"` / `"search"`), raw `content`, structured `data`, `countNo`, timestamps, plus `promptId`.
    - Indexed by `(userId, sessionId)` and `chatId`.
  - `search_results` table:
    - Captures rich search response metadata including `webItems`, `mediaItems`, `weatherItems`, `youtubeItems`, `shoppingItems`, `mapLocation`, `googleMapsKey`, and `shouldShowTabs`.
- Chat mutations/queries:
  - [convex/chat.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/convex/chat.ts#L4-L48) `initChat`:
    - Either reuses an existing `(userId, sessionId)` chat, upgrades a draft (count=0), or inserts a new row.
  - `listUserChats`:
    - Fetches all chats for a user, filters out `count < 1`, sorts by `updatedAt`, and returns a clean list for the Memory page and sidebar.
  - `writePrompt`:
    - Ensures there is a corresponding chat row for the `(userId, sessionId)` pair.
    - Uses the prompt text or search query as the chat title and name for the first message, maintains `count` with `countNo`.
    - Inserts a `user_prompts` row with metadata like `is_SST` and `searchQuery`.
  - `writeResponse`:
    - Ensures chat exists and updates `updatedAt`.
    - Inserts a `responses` row and, for `responseType === "search"`, also inserts a `search_results` row using normalized content (`overallSummaryLines`, `summary`, `webItems`, etc.).
  - `listChatMessages` (file truncated in view) returns chat, prompts, and responses for the given user/session to the frontend.

## Streaming Summaries and Health Checks

- Summary streaming:
  - [summary-stream route](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/ai/summary-stream/route.ts#L36-L104):
    - Accepts POST payload containing `searchQuery` and `webItems` (top N web results).
    - Builds a compact prompt explaining the rules for citation (inline URLs, no bracketed references) and summary format.
    - Selects Groq vs Gemini using the same cookie/env scheme as elsewhere.
    - Streams plain-text summary to the client via a `ReadableStream`, chunking and encoding with `TextEncoder`.
- Search health:
  - [search-health route](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/ai/search-health/route.ts#L1-L22):
    - Simple GET endpoint to probe AI search stack:
      - Calls `detectIntent`, `webSearch`, `imageSearch`, and `summarizeItems`.
      - Returns metrics like `webCount`, `imageCount`, and `summaryLines`.
- Map test:
  - [test-map route](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/test-map/route.ts#L3-L14):
    - Lightweight endpoint that calls `detectIntent` on a default `"map of tokyo"` or `q` query for debugging map-related intent classification.

## Environment and Configuration Expectations

- Env keys used across the codebase:
  - AI and search:
    - `GROQ_API_KEY`, `OPEN_AI_API_KEY`, `GEMINI_API_KEY`, `GOOGLE_API_KEY`, `GOOGLE_CX` / `GOOGLE_CSE_ID`, `AI_PROVIDER`.
  - Shopping:
    - `SERPAPI_API_KEY`, `SHOPPING_DEFAULT_HL`, `SHOPPING_DEFAULT_GL`, `SHOPPING_DEFAULT_LOCATION`.
  - YouTube:
    - `YOUTUBE_API_KEY`.
  - Weather:
    - `OPENWEATHER_API_KEY` or `NEXT_PUBLIC_OPENWEATHER_API_KEY`.
  - Deepgram:
    - `DEEPGRAM_API_KEY`, `DEEPGRAM_TTS_MODEL`.
  - Clerk and Supabase:
    - Clerk keys (from Next.js + Clerk integration) and Supabase env vars (for `logUserRequest` in the search page).
- Runtime settings:
  - Some routes set `export const runtime = "nodejs";` when they require Node APIs (e.g., `sharp` in memory image generation).

## UI Components and Design System

- UI primitives:
  - `app/components/ui` contains Tailwind-based shadcn-like wrappers: `button`, `card`, `dialog`, `dropdown-menu`, `hover-card`, `tabs`, `scroll-area`, `tooltip`, `badge`, `input`, `textarea`, skeletons, etc.
  - Many components are marked `use client` and rely on Radix UI primitives and `lucide-react` icons.
- AI element components:
  - `app/components/ai-elements` holds reusable pieces for the AI UX:
    - Conversation and message rendering (`conversation.tsx`, `message.tsx`, `response.tsx`).
    - Inline citations and previews (`inline-citation.tsx`, `web-preview.tsx`).
    - Prompt input, toolbar, queue, plan, task, model selector, artifacts, etc.
  - These are wired into `AIInputFooter`, `SearchConversationShell`, and other high-level experiences.
- Layout and visuals:
  - There are additional layout components under `components/layout` (e.g., hero section, header) and graphic elements (`logo-cloud`, `orb`, `safari`, `map-block`, etc.) that are mixed between top-level `components` and `app/components/ui`.
  - [components.json](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/components.json#L1-L20) is configured for shadcn-style generation pointing `components` to `@/components` and `ui` to `@/components/ui`, with Tailwind v4 and lucide icons.

## Local Chat Session Storage

- [chat-store.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/lib/chat-store.ts#L26-L49):
  - Defines `ChatSession` shape containing both chat metadata and associated search context (web items, media, weather, YouTube, shopping, map, etc.).
  - `getChatHistory`:
    - Reads from `localStorage` under the key `atom_chat_history:{userId}`.
  - `getChatSession`:
    - Finds a specific session by ID within the history.
  - `saveChatSession`:
    - Upserts a session in the history, writes back to `localStorage`, and dispatches a `chat-history-updated` event for reactive UI updates (e.g., sidebar).
  - `deleteChatSession`:
    - Removes a session from the history and broadcasts the same event.
- This local persistence is used in tandem with Convex to provide a fast, UI-specific representation of sessions while Convex serves as the canonical backend.

## Analytics and Misc APIs

- Analytics endpoint:
  - [app/api/analytics/route.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/analytics/route.ts#L1-L18):
    - Uses `auth()` to attach a Clerk `userId` when available.
    - Parses arbitrary JSON payload and logs it to the server console under `[analytics]`.
    - Used heavily by `Hero3` to track impressions and CTA clicks.
- Auth verification:
  - [app/api/auth/verify/route.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/auth/verify/route.ts) (not fully shown) likely validates Clerk sessions for client-side scripts.
- Supabase health:
  - [app/api/supabase/health/route.ts](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/app/api/supabase/health/route.ts) provides basic diagnostics for Supabase connectivity.

## Testing and Tooling

- package.json scripts:
  - `"dev": "next dev --webpack"` - uses Next dev server with the legacy webpack option enabled.
  - `"build": "next build"` / `"start": "next start"` - standard production build.
  - `"lint": "eslint"` - uses `eslint` with `eslint-config-next`.
  - `"test": "node --test"` - uses the Node test runner.
- Tests:
  - `tests/ai-search-page.test.mjs` and `tests/supabase-clerk.test.mjs` (not expanded here) appear to validate AI search flows and Clerk/Supabase integration.
  - Testing is currently minimal and targeted at integration-level behavior.

## PRD and Design Specifications

- [PRD.md](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/PRD.md): Detailed Product Requirements Document for the Cloudy Agent, including:
  - Complete 5-phase architecture (Filter → Plan → Act → Reflect → Respond)
  - Tool definitions and planning rules
  - Example flows for 20+ query types
  - Multi-step execution over tools with parallelization
  - UI integration specifications
  - Phased implementation plan
  - Success metrics

- [ai.md](file:///c:/Users/adity/OneDrive/Desktop/AtomCtrlvo1/ai.md): AI architecture documentation covering:
  - Intent detection (`detectIntent`)
  - Web/image search and summarization
  - YouTube search, shopping search, weather integration
  - Mem0 long-term memory
  - Dynamic search orchestration
  - Voice/audio integration (Deepgram STT/TTS)
  - UI integration patterns

## Observations and Potential Follow-Ups (Non-Destructive)

- Overall architecture:
  - Clear separation between:
    - Server actions (app/actions), server-side lib modules (AI, weather, search, shopping).
    - UI components (app/components/ui, ai-elements, top-level components).
    - Convex schema and backend logic.
  - Strong emphasis on composability and provider abstraction, especially for AI and search.
  - **Agentic flow**: The new 5-phase planning loop in `agent-plan.ts` represents a significant architectural shift from imperative tool calling to LLM-driven planning.
  - **Dual orchestration paths**: The codebase now supports both `performDynamicSearch` (legacy) and `runAgentPlan` (new agentic flow).

- System prompts evolution:
  - `system-prompts.ts` has grown to ~1600+ lines with a comprehensive query playbook covering 20+ categories (Small Talk, Knowledge, Finance, Shopping, Travel, Technology, etc.)
  - Each playbook entry specifies Filter, Plan, Act, Reflect, and Respond phases for consistent behavior.
  - The `COMPACT_SYSTEM_PROMPT` is used for lightweight LLM planning calls.

- Tool orchestration:
  - Tools are now planned dynamically rather than selected imperatively
  - `canRunInParallel` flag enables efficient batch execution
  - Automatic tool augmentation (image_search added to web_search, scrape_urls for job/career queries)
  - URL-based routing to scrape_urls tool for explicit user-provided links

- Error handling:
  - External API wrappers (search, YouTube, weather, Deepgram, SerpAPI) consistently:
    - Validate inputs and env keys.
    - Log warnings/errors and return empty results or simple JSON instead of throwing.
  - Some console logs (e.g., Deepgram TTS TTFB) are explicitly performance-focused.
  - Planning failures fall back to direct answer mode gracefully.

- Security posture:
  - API keys are always read from `process.env`; no secrets are hard-coded.
  - Clerk middleware protects both app and API routes by default, reducing risk of unauthenticated access to sensitive endpoints.
  - Shopping, YouTube, and search APIs do not expose raw env values back to the client.
  - Firecrawl integration provides controlled web scraping with query-based extraction.

- UX considerations:
  - Voice-first design with clear separation between text and voice flows, plus visual feedback for STT/TTS.
  - Rich but complex state in `SearchConversationShell`—well-suited for the current scope but could be a candidate for refactoring into smaller hooks or modules if the feature set grows.
  - Memory visualizations and `mem0` integration indicate focus on long-term user experience and personalization.
  - Thinking blocks (phases) are surfaced in the UI to show the agent's reasoning process.
  - Small talk and identity questions are handled efficiently with early exits.
