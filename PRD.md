# Cloudy Agent: Tool-Using AI Orchestrator

This PRD describes how to evolve the current AI stack (see `ai.md`) into a **single agentic loop** where the LLM plans, calls tools (search, shopping, YouTube, weather, etc.) possibly in parallel, and then synthesizes a final response with rich UI blocks.

The key shift is:
- From: `detectIntent` deciding tabs, then imperative code calling tools.
- To: A **planner–executor loop** where the LLM **plans steps**, invokes **tool calls as actions**, observes results, and iterates until it can answer.

DetectIntent becomes an internal capability of the agent’s prompt and tool schema rather than a separate exported function.

---

## 1. Goals and Non‑Goals

### 1.1 Goals

- Replace the current `detectIntent` flow with a **single agent** that:
  - First **understands the user query** and relevant context.
  - **Plans** a sequence of steps, deciding dynamically whether tools are needed.
  - **Executes tools only when they add value** (search, YouTube, Shopping, Weather, etc.), including **parallel calls** where safe.
  - **Synthesizes** a final response that:
    - Contains both **natural language explanation**.
    - And **structured result blocks** that map cleanly to existing UI components (`SearchResultsBlock`, weather widget, video list, shopping cards, etc.).
  - Supports **multiple planning–tool–observation iterations** (“the loop” in the diagram) when a query is complex.
  - Can also **answer directly without calling any tools** when a query is simple or purely conversational.

- Maintain and reuse:
  - Existing **tool implementations**:
    - `webSearch`, `imageSearch`, `summarizeItems` (AI search).
    - `youtubeSearch` (videos).
    - `shoppingSearch` (products).
    - `fetchWeatherForCity` (weather).
  - Existing **UI components**:
    - `HomeSearchInput`, `AIInputFooter`, `SearchConversationShell`.
    - `SearchResultsBlock`, `WeatherWidget`, `VideoList`, shopping cards.

### 1.2 Non‑Goals

- Do **not** change:
  - In‑chat memory UX (conversation history, `conversationMemory` in `SearchConversationShell`).
  - Convex schema for `chats`, `user_prompts`, `responses`, `search_results`.
- Do **not** implement generic “run arbitrary code” tools beyond what exists (web search, shopping, YouTube, weather).
- Do **not** change Deepgram STT/TTS behavior, only how the **assistant decides** what to say.

---

## 2. High‑Level Architecture

### 2.1 Components

1. **Agent Orchestrator (server action)**
   - New server action, e.g. `runAgentPlan(query, options)` in `app/actions/agent.ts`.
   - Responsible for:
     - Building **agent context** (Convex history, pinned items, AskCloudy context).
     - Driving the **plan → tool calls → observation → refine** loop.
     - Producing a **final structured result** compatible with `DynamicSearchResult`.

2. **Agent Prompt / System Specification**
   - Lives in `app/lib/ai/system-prompts.ts`.
   - Describes:
     - Available tools and when to use them.
     - Required step structure (PLAN → ACTIONS → OBSERVATIONS → CONCLUSION).
     - Expectations around **parallelization** and **cost control**.

3. **Tool Layer**
   - Existing functions are wrapped in **schema‑driven tools** exposed to the agent:
     - `tool_web_search(query: string)`
     - `tool_image_search(query: string)`
     - `tool_youtube_search(query: string)`
     - `tool_shopping_search(query: string)`
     - `tool_weather_city(city: string)`
   - Implemented in an internal module, e.g. `app/lib/ai/agent-tools.ts`.

4. **Agent Plan Model**
   - Single LLM call that returns a **JSON plan**:

   ```ts
   type AgentPlanStep = {
     id: string;
     description: string;
     tool?: "web_search" | "image_search" | "youtube_search" | "shopping_search" | "weather_city";
     arguments?: Record<string, any>;
     canRunInParallel?: boolean;
   };

   type AgentPlan = {
     reasoning: string;
     steps: AgentPlanStep[];
   };
   ```

5. **Execution Engine**
   - Deterministic TS/JS code (inside `runAgentPlan`) that:
     - Groups steps that `canRunInParallel`.
     - Executes tools.
     - Collects and annotates results.
     - Feeds a summarized view back to the model for final answer synthesis.

6. **UI Integration**
   - `SearchConversationShell` switches from `performDynamicSearch` to `runAgentPlan`.
   - The final output **still conforms** to `DynamicSearchResult` so that `SearchResultsBlock` and existing UI remain unchanged.

### 2.2 Loop Structure and Forced Thinking

For each user query, the agent must always go through a **multi‑step thinking loop**. Thinking is not optional; every answer comes from at least one full loop of:

1. **Context & Preference Check (Filter Phase)**
   - Orchestrator gathers:
     - Recent chat turns and any attached JSON “memory” blobs that encode per‑turn metadata (for example, user preferences, prior stock symbols, risk level).
     - AskCloudy selection context and conversation summaries.
   - A lightweight server‑side filter selects **relevant snippets** for the current query (for example, if the query mentions “stock market”, filter for past portfolio preferences or “always show NIFTY and S&P 500”).
   - These snippets are injected into the model context as a short bullet list so the agent can reason about them explicitly.
   - A user‑visible “Thinking” block is added to the chat, such as “Checking your previous preferences and recent context…”.

2. **Planning Phase (First Thinking Step)**
   - `runAgentPlan` calls the LLM with:
     - System prompt (tools, expectations, loop contract).
     - User query.
     - Filtered context from step 1.
   - The model must return:
     - A natural‑language **planning thought** (1–3 sentences) describing what it intends to do.
     - A structured `AgentPlan` (steps with tools and arguments).
   - The planning thought is surfaced in the UI as the first **Thinking block** so users can see what Cloudy intends to do before any tools run.

3. **Action Phase (Tool Execution)**
   - Orchestrator groups plan steps:
     - Steps with `canRunInParallel === true` are batched (for example, web_search + shopping_search + youtube_search).
     - Others run sequentially when they depend on earlier results.
   - For each tool step:
     - Call the corresponding tool wrapper (web, YouTube, shopping, weather).
     - Capture results, metrics (counts, top titles), and any errors.
   - As batches complete, the orchestrator emits **Thinking blocks** like:
     - “Fetched 3 news headlines about global indices.”
     - “Found 4 shopping results for ‘MacBook Air M3’.”
     - “Queued 5 YouTube videos on today’s market recap.”

4. **Reflection Phase (Second Thinking Step, Forced)**
   - After at least one batch of tools has executed, the orchestrator always calls the LLM again in **reflection mode**:
     - Inputs:
       - Original query.
       - Plan.
       - Tool observations (summaries, not raw payloads).
     - Required outputs:
       - A **reflection thought** (“Did I gather enough? What’s missing?”).
       - An optional list of **follow‑up actions**, which can be:
         - Additional tool steps (for example, “also fetch YouTube updates about today’s market”).
         - Or a signal that the agent is ready to answer.
   - If follow‑up actions exist and pass safety/latency checks, the orchestrator executes a **second, smaller Action Phase**, again logging what it is doing as Thinking blocks.
   - This enforces a minimum of:
     - Plan → Act → Reflect,
     - with **at most one additional Act round** in v1 to bound latency.

5. **Response Phase (Explain + Offer Next Steps)**
   - Orchestrator builds a **tool results summary**:

   ```ts
   type ToolObservation = {
     stepId: string;
     tool: string;
     arguments: Record<string, any>;
     resultSummary: string; // short natural language summary
     raw: any;              // full data for UI rendering
   };
   ```

   - Calls LLM again in **answer mode** with:
     - Original user query.
     - Plan.
     - Observations (summarized).
   - LLM must return:
     - Final **assistant message text** for the chat bubble.
     - A short **“what I did” summary**, enumerating steps taken (for example, “1) Checked your past preferences… 2) Searched latest news… 3) Pulled recap videos…”).
     - Optional layout hints (e.g. “show videos + shopping + map”).
   - The answer‑mode thought is surfaced in the UI as the final Thinking block, immediately before the main chat response.

6. **Result Formatting**
   - Orchestrator maps tool results into the existing `DynamicSearchResult` shape:
     - `webItems`, `mediaItems`, `youtubeItems`, `shoppingItems`, `weatherItems`.
     - `overallSummaryLines`, `summary`.
   - Returns `type: "search"` so the UI can:
     - Render `SearchResultsBlock`.
     - Speak the summary via Deepgram.

7. **Optional Subsequent Loop**
   - For especially complex queries, we may allow:
     - The LLM to request one more **plan–act–reflect** cycle if results are insufficient or the user explicitly asks for deeper analysis.
   - For v1, this is disabled by default; the prompt and orchestrator should be designed so we can enable it later without breaking the contract.

---

## 3. Detailed Behavior

### 3.1 Tools Definition (Model View)

From the model’s perspective, we provide structured tools (similar to current `detectIntent` tools, but with **richer arguments** and explicit return schemas):

- `web_search`
  - Inputs: `{ query: string; max_results?: number }`
  - Returns: top articles (title, link, snippet, imageUrl).
- `image_search`
  - Inputs: `{ query: string; max_results?: number }`
  - Returns: image URLs + alt text.
- `youtube_search`
  - Inputs: `{ query: string; max_results?: number }`
  - Returns: `YouTubeVideo[]`.
- `shopping_search`
  - Inputs: `{ query: string; max_results?: number; location?: string }`
  - Returns: `ShoppingProduct[]`.
- `weather_city`
  - Inputs: `{ city: string }`
  - Returns: `WeatherItem`.

The system prompt explicitly states:
- When to use each tool.
- That **multiple tools can be called** within the same plan (e.g. web + YouTube + shopping for “best laptops with reviews and deals”) when the query demands fresh or external information.
- That some queries may require **only one tool** or **no tools at all** (for example, simple explanations or small clarifications).
- That the agent must keep overall latency/usage in mind (no unnecessary tools).

### 3.2 Planning Rules

The agent must:

- Always produce an `AgentPlan` with:
  - At least one step, even if that step is “answer directly from existing knowledge”.
  - Each step labelled with a clear **purpose** (e.g. “answer directly”, “get latest web info about query”, “find relevant YouTube videos”, “fetch shopping products”, “check weather for mentioned city”).
- Prefer **parallel**:
  - If steps are independent (e.g. web search + YouTube + shopping).
  - Mark `canRunInParallel = true` for those.
- Use **sequential** steps when:
  - Later steps depend on previous tool results (e.g. refine search query based on first results).

Example plan (for “find me MacBook Air M3 deals and reviews, in London, and show me videos”):

```json
{
  "reasoning": "User wants products, reviews, and videos, location London.",
  "steps": [
    {
      "id": "s1",
      "description": "Search web for reviews of MacBook Air M3.",
      "tool": "web_search",
      "arguments": { "query": "MacBook Air M3 reviews", "max_results": 8 },
      "canRunInParallel": true
    },
    {
      "id": "s2",
      "description": "Search shopping results for MacBook Air M3 in London.",
      "tool": "shopping_search",
      "arguments": { "query": "MacBook Air M3", "max_results": 4, "location": "London, UK" },
      "canRunInParallel": true
    },
    {
      "id": "s3",
      "description": "Find top YouTube videos about MacBook Air M3.",
      "tool": "youtube_search",
      "arguments": { "query": "MacBook Air M3 review", "max_results": 5 },
      "canRunInParallel": true
    }
  ]
}
```

### 3.3 Multi‑Step Agentic Execution over Tools

Once a plan is produced, the orchestrator treats it as a **queue of steps** that must be filled before the answer is considered complete:

- Each `AgentPlanStep` corresponds to one of:
  - `answer` (direct response, no tools).
  - `web_search`, `image_search`, `youtube_search`, `shopping_search`, `weather_city`.
- The orchestrator maintains in memory:
  - The ordered list of steps.
  - A running index of **which steps are completed** and which remain pending.

Execution rules:

- For plans with a **single step**:
  - If `tool` is omitted or `"answer"`, the agent answers directly using only the LLM.
  - If a tool is specified, orchestrator executes that one tool, summarizes, then answers.
- For plans with **multiple steps**:
  - Orchestrator groups all steps with `canRunInParallel === true` into **batches**.
  - For each batch:
    - Executes all tools in the batch concurrently:
      - e.g. `web_search` + `shopping_search` + `youtube_search` for the same query.
    - Marks all those steps as **completed** when their tool calls succeed (or are gracefully failed).
    - Emits a Thinking block summarizing what was done in that batch.
  - After each batch, orchestrator checks:
    - If any remaining steps require updated arguments (for example refining a search query using web results).
    - If so, it calls the LLM in reflection mode to update or append steps (within the loop budget described in §2.2).
  - The loop continues **until all planned steps are filled** or the reflection stage decides that remaining steps are unnecessary or redundant.

Tool usage expectations:

- For rich, research‑like queries (e.g. “compare laptops and show deals with videos”):
  - The planning phase should typically produce **3+ steps** spanning:
    - `web_search` for background and reviews.
    - `shopping_search` for current products/deals.
    - `youtube_search` for explainer/review videos.
  - All three tools are expected to be called in the **first execution batch** where possible.
- For lighter queries:
  - Plans may include only one tool (for example, only `web_search` or only `youtube_search`), or even just an `answer` step.
  - The orchestrator still treats this as a one‑step queue that is executed and then marked complete.

The orchestrator must never “skip” a planned tool step silently. If a step is not executed due to safety, rate limits, or errors, its status is recorded as **failed** and the reflection stage is informed so the model can either:

- Revise the plan (alternate tools or fewer steps).
- Or answer with an explanation that some tools were unavailable.

### 3.4 Synthesis Rules

The synthesis prompt should instruct the model to:

- Read:
  - User query.
  - Plan (steps).
  - Tool observations (summaries).
- Produce:
  - A **longer, explanatory answer** for `summary` (1–2 paragraphs) that can be split into:
    - A top section (high‑level explanation).
    - A bottom section (details, caveats, next steps).
  - Optional `overallSummaryLines` for very short, headline‑style summaries.
  - Clear structure in text with natural sentence flow (no list of bare URLs).
- Inline citation markers:
  - When using web sources, the model should annotate sentences with in‑line URL markers using backticks and optional counts, e.g.:
    - `https://ai-sdk.dev/docs/introduction`
    - `https://ai-sdk.dev/docs/introduction` +3
  - These markers do **not** appear to the user directly; the UI converts them automatically into:
    - Human‑readable hostnames in parentheses in the answer text, e.g. `(ai-sdk.dev)`, `(github.com)`.
    - A compact inline citation pill that, when clicked, opens a popover listing up to 4 sources.
- UI mapping:
  - The final answer is rendered as:
    - Top answer text with inline citation pill(s).
    - A central media strip (single large image carousel) when `mediaItems` exist.
    - A YouTube section inside the same answer bubble when `youtubeItems` exist.
    - Optional shopping grid and weather widgets below.
  - Tabs (chat/results/media) are not used in the inline search experience; everything flows as a single chat‑style message.

### 3.5 User‑Visible Thinking Blocks

To match the desired “agent with its own loop” experience, users must see the agent’s thinking as it progresses:

- The orchestrator exposes a stream of **Thinking events** that the UI renders as a dedicated “Thinking” block above the assistant’s final response.
- Each phase contributes events:
  - Filter Phase: “Checking your recent conversations and preferences…”.
  - Planning Phase: “Plan: read your preferences, fetch today’s market moves, then pull recap videos.”
  - Action Phase: “Fetching news for NIFTY 50 and S&P 500…”, “Found 3 major headlines about today’s sell‑off.”
  - Reflection Phase: “I have enough news; I should also add 2 short recap videos.”
  - Response Phase: “Summarizing and structuring the answer.”
- Implementation sketch:
  - Extend the server action result with a `thinkingSteps` array:

    ```ts
    type ThinkingStep = {
      id: string;
      phase: "filter" | "plan" | "act" | "reflect" | "respond";
      message: string;
      createdAt: number;
    };
    ```

  - `SearchConversationShell` renders `thinkingSteps` in a compact timeline or expandable panel tied to each assistant response.
  - For voice users, the final response includes a short natural language recap (“Here’s what I did…”) so the loop is understandable even without reading the thinking panel.

---

## 4. Integration with Existing Code

### 4.1 Example Flows (From Simple Chat to Multi‑Tool)

The following examples illustrate how Cloudy should behave for different types of queries. Each example assumes the full **filter → plan → act → reflect → respond** loop and surfaces Thinking blocks to the user. The **number and type of tools** are always chosen dynamically:

- Some queries are answered with **no tools** (pure reasoning / explanation).
- Some queries require **a single tool**.
- More demanding queries combine **multiple tools in parallel**.

0. **Simple chat / small talk**
   - Query: “How are you?” or “Tell me something interesting about black holes.”
   - Filter:
     - Read recent chat turns for mood, style, or previously mentioned interests.
   - Plan:
     - Step 0: Decide that no external information is required; a direct answer is sufficient.
     - Step 1: “answer directly from knowledge, no external tools”.
   - Act:
     - No tool calls; Action phase is a no‑op.
   - Reflect:
     - Check that the planned answer is engaging and consistent with the user’s mood/preferences.
   - Respond:
     - Produce a friendly, conversational reply.
     - Thinking blocks still show the steps (“Checked recent messages”, “Decided to answer directly”) but no UI result blocks (no search, videos, or products).

1. **Stock market daily update**
   - Query: “Give me a stock market update for today.”
   - Filter:
     - Read JSON chat memory for past indices (e.g. NIFTY 50, S&P 500, NASDAQ) and risk preferences.
   - Plan:
     - If the user explicitly asks for “just a quick high‑level update” and recent context already exists:
       - Step 1: Answer directly from cached context and recent chat state (no tools).
     - Otherwise:
       - Step 1: `web_search` latest news for the user’s preferred indices and “global markets today”.
       - Step 2: `web_search` for “today’s market summary video” or “daily market recap”.
       - Step 3: `youtube_search` for “today’s stock market update”.
   - Act:
     - Run steps 1–3 in parallel.
   - Reflect:
     - Ensure at least a few headlines and 1–2 videos were found; if not, adjust queries (e.g. add “today” or country).
   - Respond:
     - Build a summary section (“Indices moved X%…”) using web items.
     - Show a **News** block (web cards) and a **Videos** block (YouTube list).
     - End with a clear “what I did” list and ask if the user wants specific tickers or sectors next.

2. **Chemistry concept explanation**
   - Query: “Explain the concept of hybridization in organic chemistry.”
   - Filter:
     - Look for prior study preferences in JSON memory (e.g. “I’m in grade 11”, “prefer visual explanations”).
   - Plan:
     - Step 0: Decide whether the model’s built‑in knowledge is sufficient for a direct explanation (no tools).
     - If direct knowledge is enough and the user only wants a quick refresher:
       - Step 1: “answer directly from knowledge, no external tools”.
     - If the user asks for visuals or “latest resources”:
       - Step 1: `web_search` for “hybridization sp sp2 sp3 simple explanation high school”.
       - Step 2: `image_search` for diagrams of orbital shapes / hybridization.
       - Step 3: `youtube_search` for short animations on hybridization.
   - Act:
     - Run steps 1–3 in parallel.
   - Reflect:
     - Check whether results cover all main cases (sp, sp2, sp3); if not, run a narrow `web_search` for the missing one.
   - Respond:
     - Generate a top‑level explanation tailored to the level detected in the filter phase.
     - Attach **Images** block (orbital diagrams) and **Videos** block (explainer videos).
     - Offer follow‑ups like “Do you want practice questions or more visuals?”.

3. **Gadget buying decision**
   - Query: “Should I buy the iPad Air or iPad Pro for note taking and light video editing?”
   - Filter:
     - Check for previous device mentions or budget notes in JSON memory.
   - Plan:
     - If the user says “just give me your opinion, I don’t need links”:
       - Step 1: Answer from model knowledge about typical trade‑offs (no tools).
     - Else (default rich flow):
       - Step 1: `web_search` for comparison articles “iPad Air vs iPad Pro note taking video editing”.
       - Step 2: `shopping_search` for both products with approximate location for pricing.
       - Step 3: `youtube_search` for comparison review videos.
   - Act:
     - Run all steps in parallel.
   - Reflect:
     - Verify that at least one article, a few products, and 1–2 videos were found.
   - Respond:
     - Write an **Opinionated Summary** (“Given how you use tablets, iPad Air is usually enough, unless…”).
     - Show **Products** (shopping) and **Videos** blocks underneath.

4. **Travel planning with weather**
   - Query: “I’m going to Tokyo next week, what should I pack?”
   - Filter:
     - Look for user’s travel style or comfort notes (e.g. “I run cold”, “hate rain”).
   - Plan:
     - If the travel date is far in the future or weather is not critical:
       - Step 1: Answer with general seasonal guidance (no tools or just `web_search`).
     - Otherwise:
       - Step 1: `weather_city` for Tokyo to get upcoming temperatures and conditions.
       - Step 2: `web_search` for “what to pack for Tokyo in <month>”.
       - Step 3: `image_search` for outfits or packing list visuals.
   - Act:
     - Run weather + web + image searches in parallel.
   - Reflect:
     - If weather API fails, adjust answer strategy to generic seasonal advice.
   - Respond:
     - Build a packing checklist that references temperature ranges and rain probability.
     - Show **Weather** and **Images** blocks below the explanation.

5. **Product research plus market context**
   - Query: “Find me budget mechanical keyboards under $100 with good reviews.”
   - Filter:
     - Detect if the user has mentioned preferred switches or brands in prior chats.
   - Plan:
     - For a very rough high‑level answer (“just give me a few examples”):
       - Step 1: Answer directly from knowledge, maybe backed by a single `web_search` if needed.
     - For a more serious shopping flow:
       - Step 1: `shopping_search` for “budget mechanical keyboard under 100 USD”.
       - Step 2: `web_search` for “best budget mechanical keyboards review”.
   - Act:
     - Run shopping + web in parallel.
   - Reflect:
     - If most products exceed the budget or there are very few, broaden search slightly (e.g. “under 120” but highlight the difference).
   - Respond:
     - Present 4–6 candidate keyboards with pros/cons.
     - Show **Products** block, plus a **News/Reviews** block from web search results.

6. **Learning a new programming concept**
   - Query: “Teach me how async/await works in JavaScript with examples.”
   - Filter:
     - Check prior chats for user’s experience level (beginner vs advanced).
   - Plan:
     - Step 0: Evaluate if the concept is stable and well‑known (usually true for core JS).
     - If yes and the user wants a concise explanation:
       - Step 1: Answer from knowledge only (no tools).
     - If the user asks for visuals or “best resources”:
       - Step 1: `web_search` for “async await JavaScript beginner friendly explanation”.
       - Step 2: `youtube_search` for “async await tutorial JS”.
       - Step 3: `image_search` for diagrams that show the event loop / promise resolution.
   - Act:
     - Run steps 1–3 in parallel.
   - Reflect:
     - Confirm that examples cover both basic and common pitfalls (e.g. error handling).
   - Respond:
     - Generate a progressive explanation (analogy → simple example → more real‑world example).
     - Attach **Videos** and **Images** blocks for deeper study.

7. **Local events and plans**
   - Query: “What can I do in Bangalore this weekend that’s not too expensive?”
   - Filter:
     - Use previous preferences (e.g. “likes live music”, “prefers outdoors”) from JSON chat memory.
   - Plan:
     - If the user only wants general ideas (“types of things to do in Bangalore”):
       - Step 1: Answer from knowledge using generic categories (no tools).
     - If the user wants actual events for a specific weekend:
       - Step 1: `web_search` for “Bangalore events this weekend cheap or free”.
       - Step 2: `image_search` for key venues / attractions mentioned.
   - Act:
     - Run both searches in parallel.
   - Reflect:
     - If results are sparse, broaden to “this month” and label suggestions accordingly.
   - Respond:
     - Compose a list of 3–7 suggestions grouped by category (music, outdoors, food).
     - Show **Web results** cards and relevant **Images** for each attraction.

8. **News deep‑dive with follow‑up material**
   - Query: “Explain what’s happening with inflation in the US right now.”
   - Filter:
     - Look for the user’s finance familiarity (“beginner”, “intermediate”) in prior chats.
   - Plan:
     - For a timeless conceptual explanation (“what is inflation in general?”):
       - Step 1: Answer from knowledge only (no tools).
     - For “what’s happening right now”:
       - Step 1: `web_search` for “US inflation latest data explanation”.
       - Step 2: `web_search` for “Federal Reserve inflation outlook summary”.
       - Step 3: `youtube_search` for “US inflation explained recent”.
   - Act:
     - Run the two web searches and YouTube search in parallel.
   - Reflect:
     - Verify that articles are recent (based on date snippets) and that at least one explainer video is available.
   - Respond:
     - Provide a narrative explanation referencing the most recent data points.
     - Show **News** and **Videos** blocks, and invite the user to ask about specific sectors (housing, jobs, etc.).

9. **Daily personal briefing**
   - Query: “Give me a quick morning briefing.”
   - Filter:
     - Use JSON memory to determine:
       - Preferred indices, sports teams, or topics (tech, politics, crypto).
   - Plan:
     - If the user is offline or explicitly says “no external data, just summarize what you already know”:
       - Step 1: Provide a generic briefing based on recent in‑chat topics only (no tools).
     - Normal case:
       - Step 1: `web_search` for “latest news” scoped to the user’s topics.
       - Step 2: `web_search` / `image_search` for weather if no city is in context but a default location is known from past chats.
       - Step 3: `youtube_search` for a short general news recap video.
   - Act:
     - Run all steps in parallel.
   - Reflect:
     - Ensure at least one item per category (markets, major headlines, weather, optional sports).
   - Respond:
     - Create a top section “Here’s your morning briefing” with bullet points.
     - Show **News**, **Weather**, and **Videos** blocks underneath.

10. **Entertainment discovery**
    - Query: “Recommend me some sci‑fi movies like Interstellar and where I can watch them.”
    - Filter:
      - Pull previous mentions of platforms (e.g. “I use Netflix and Prime”) and movie tastes from JSON memory.
    - Plan:
      - If the user just wants a few names without links:
        - Step 1: Answer from knowledge (no tools).
      - If the user wants where to watch and trailers:
        - Step 1: `web_search` for “movies like Interstellar hard sci‑fi list”.
        - Step 2: `shopping_search` or equivalent streaming availability search (if wired later) for rental/purchase info.
        - Step 3: `youtube_search` for trailers and explainer videos for top picks.
    - Act:
      - Run all steps in parallel.
    - Reflect:
      - Narrow to 5–7 movies that match the user’s platform preferences if possible.
    - Respond:
      - Provide a ranked list with short justifications.
      - Show **Products/Streaming availability** and **Trailers** (YouTube) blocks below.

### 4.1 Server Action Layer

- New file: `app/actions/agent.ts`
  - `runAgentPlan(query: string, options: PerformSearchOptions & { askCloudyContext?: any }): Promise<DynamicSearchResult>`
  - Internals:
    - Build context (same sources currently used by `performDynamicSearch`).
    - Call **planner model** (could reuse `GroqClient`/`GeminiClient`).
    - Validate and sanitize `AgentPlan` (fallback to simple `web_search` if invalid).
    - Execute tools using existing functions (`webSearch`, `youtubeSearch`, etc.).
    - Call **synthesis model** for final answer.
    - Return `DynamicSearchResult`.

- Existing `performDynamicSearch`:
  - v1: wrap/forward to `runAgentPlan` for compatibility.
  - v2: deprecate in favor of agent API.

### 4.2 LLM Client Reuse

- Continue to use:
  - `GeminiClient.getInstance().generateContent` for planning & synthesis.
  - Or `GroqClient` if configured as `AI_PROVIDER`.
- Create a small helper in `genai.ts` for “raw agent call” (no `DetectResult`, just general JSON).

### 4.3 UI

- `SearchConversationShell`:
  - Replace call to `performDynamicSearch(trimmed, options)` with `runAgentPlan(trimmed, options)`.
  - Keep everything downstream the same (`DynamicSearchResult` contract preserved).

- No changes to:
  - `SearchResultsBlock`, `WeatherWidget`, `VideoList`, shopping cards, etc.

### 4.4 Telemetry / Logging

- Log (server side):
  - AgentPlan (redacted for privacy) – step IDs, tools, arguments (without PII).
  - Tool success/failure, timings.
  - Synthesis outcome (which arrays populated).
- Helps debug:
  - Overuse of tools.
  - Latency issues.

---

## 5. Edge Cases and Error Handling

- **No tools available** (missing API keys):
  - Planner should know from environment flags exposed in the prompt (e.g. “shopping tool unavailable”).
  - Orchestrator falls back to a simple text‑only response.

- **Tool errors**:
  - Each tool wrapper returns empty arrays and logs errors rather than throwing.
  - Observations include error summaries so the synthesizer can say “I couldn’t load videos right now.”

- **Invalid plan JSON**:
  - Fallback to a default plan: web search + summarization only.

- **Timeouts / Latency**:
  - Orchestrator should cap total tool time (e.g. 5–7 seconds) and skip late tools.

---

## 6. Phased Implementation Plan

### Phase 0 – Design and Prompting

- Finalize:
  - Tool schemas.
  - Planner prompt.
  - Synthesis prompt.
- Add examples in `system-prompts.ts`.

### Phase 1 – Backend Agent Orchestrator

- Implement `agent-tools.ts` wrappers.
- Implement `runAgentPlan` in `app/actions/agent.ts`.
- Implement minimal planner & synthesis calls with a single iteration.

### Phase 2 – UI Integration

- Wire `SearchConversationShell` to use `runAgentPlan`.
- Keep `DynamicSearchResult` unchanged.
- Validate:
  - Web only.
  - Web + YouTube.
  - Web + Shopping.
  - Web + Shopping + YouTube + Weather.

### Phase 3 – AskCloudy and Conversation Context Integration

- Feed:
  - Conversation context (`ConversationContext`) and AskCloudy context into planner.

### Phase 4 – Multi‑Iteration Loop (Optional)

- Allow planner to request additional loops if:
  - Initial tools return little information.
  - The user asks for verification or follow‑up.

---

## 7. Success Metrics

- **Functional**
  - Agent can successfully use **multiple tools in one query** (e.g. web + YouTube + shopping).
  - No regressions in existing UX (tabs, cards, Deepgram).

- **UX**
  - Responses feel **intentional and structured** (clear plan, clear result sections).
  - Higher coverage of “complex” queries that require more than one source.

- **Technical**
  - Latency stays acceptable (e.g. < 3–5s in typical cases).
  - Error cases degrade gracefully to text‑only responses.

