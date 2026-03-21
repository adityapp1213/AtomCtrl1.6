"use server";

import { GroqClient } from "@/app/lib/ai/groq/groq-client";
import { cookies } from "next/headers";
import {
  webSearch,
  imageSearch,
  summarizeItems,
  summarizeChatAnswerFromWebItems,
  summarizeChatAnswerFromShoppingItems,
} from "@/app/lib/ai/search";
import { youtubeSearch, type YouTubeVideo } from "@/app/lib/ai/youtube";
import {
  shoppingSearch,
  type ShoppingProduct,
} from "@/app/lib/serpapi/shopping";
import {
  fetchWeatherForCity,
  type WeatherItem,
} from "@/app/lib/weather";
import { detectIntent } from "@/app/lib/ai/genai";
import { DETECT_INTENT_SYSTEM_PROMPT, COMPACT_SYSTEM_PROMPT } from "@/app/lib/ai/system-prompts";
import { scrapeUrls, type ScrapedUrlSummary } from "@/app/lib/ai/firecrawl";
import { trimContextToTokenBudget } from "@/app/lib/ai/token-utils";
import type { DynamicSearchResult } from "@/app/actions/search";

export type PlannedTool =
  | "answer"
  | "web_search"
  | "image_search"
  | "youtube_search"
  | "shopping_search"
  | "weather_city"
  | "scrape_urls";

export type GroqTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
};

const PLANNER_TOOLS: GroqTool[] = [
  {
    type: "function",
    function: {
      name: "plan",
      description: "Plan steps to answer the query. Match tools to user's actual request:\n" +
        "- Books, products, prices -> shopping_search + web_search\n" +
        "- Videos, tutorials, recaps -> youtube_search + web_search\n" +
        "- Events, news, briefings -> web_search + youtube_search\n" +
        "- Comparisons, recommendations -> web_search + shopping_search\n" +
        "- URLs, links -> scrape_urls\n" +
        "Set canRunInParallel=true for independent steps.",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["answer", "plan"],
            description: "'plan' for searches, 'answer' for direct response.",
          },
          reasoning: {
            type: "string",
            description: "Brief explanation of why this plan was chosen.",
          },
          steps: {
            type: "array",
            description: "Ordered list of tool steps to execute. For complex queries, include MULTIPLE parallel steps (e.g., web_search + youtube_search for news). Each tool that canRunInParallel should be run simultaneously.",
            items: {
              type: "object",
              properties: {
                id: { type: "string", description: "Unique step identifier like s1, s2, s3" },
                description: { type: "string", description: "What this step accomplishes" },
                tool: {
                  type: "string",
                  enum: ["answer", "web_search", "image_search", "youtube_search", "shopping_search", "weather_city", "scrape_urls"],
                  description: "Tool to execute. Use web_search for news/facts/opinions. Use youtube_search for videos/tutorials/recaps. Use shopping_search for products/prices. Use image_search for visual content. Use weather_city for weather. Use scrape_urls for specific URLs.",
                },
                canRunInParallel: { type: "boolean", description: "TRUE if this step can run at the same time as other steps. Set to FALSE only if this step needs results from another step." },
                query: { type: ["string", "null"], description: "Search query for this tool. Keep it focused: 2-5 high-signal words. E.g., 'best places visit India Taj Mahal' not 'I want to find the best places to visit in India besides the Taj Mahal'. Use null for answer tool." },
              },
              required: ["id", "description", "tool", "canRunInParallel"],
            },
          },
        },
        required: ["mode", "reasoning", "steps"],
      },
    },
  },
];

export type PlannedStep = {
  id: string;
  description: string;
  tool: PlannedTool;
  canRunInParallel: boolean;
  query?: string;
};

export type PlanMode = "answer" | "plan";

export type PlanResult = {
  mode: PlanMode;
  reasoning: string;
  steps: PlannedStep[];
};

export type RunAgentOptions = {
  context?: string[];
  userId?: string | null;
  sessionId?: string | null;
  shoppingLocation?: string | null;
  forceSearch?: boolean;
  planOverride?: PlanResult;
};

function extractConversationContextObject(contextLines: string[]) {
  for (let i = contextLines.length - 1; i >= 0; i -= 1) {
    const line = String(contextLines[i] || "");
    const prefix = "ConversationContext:";
    if (!line.startsWith(prefix)) continue;
    const jsonText = line.slice(prefix.length).trim();
    if (!jsonText) continue;
    try {
      const parsed = JSON.parse(jsonText);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return null;
}

function stripCodeForSearchTopic(value: string) {
  const raw = String(value || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return "";
  return raw.length > 160 ? raw.slice(0, 160) : raw;
}

function extractUrlsFromText(value: string) {
  const raw = String(value || "");
  const httpMatches = raw.match(/https?:\/\/[^\s)<>"']+/gi) || [];
  const bareMatches =
    raw.match(/\b(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)<>"']*)?/gi) || [];

  const candidates = [...httpMatches, ...bareMatches]
    .map((m) => m.replace(/[),.;]+$/g, "").trim())
    .filter(Boolean)
    .filter((m) => !m.includes("@"));

  const normalized = candidates
    .map((m) => (/^https?:\/\//i.test(m) ? m : `https://${m}`))
    .map((m) => {
      try {
        const u = new URL(m);
        if (u.protocol !== "http:" && u.protocol !== "https:") return null;
        return u.toString();
      } catch {
        return null;
      }
    })
    .filter(Boolean) as string[];

  return Array.from(new Set(normalized));
}

function looksLikeSmallTalkQuery(query: string) {
  const raw = (query ?? "").trim().toLowerCase();
  if (!raw) return false;
  if (raw.length > 150) return false;
  const oneWord = raw.replace(/[!?.,]/g, "").trim();
  const allowed = new Set([
    "hi",
    "hello",
    "hey",
    "yo",
    "sup",
    "thanks",
    "thank",
    "thx",
    "ty",
    "ok",
    "okay",
    "yes",
    "no",
    "cool",
    "nice",
    "great",
    "awesome",
    "lol",
  ]);
  if (allowed.has(oneWord)) return true;
  if (/\b(thank you|thanks a lot|appreciate it)\b/.test(raw)) return true;
  if (/\b(ugh|oof|meh|darn|argh|yikes)\b/.test(raw)) return true;
  if (/\b(bad day|rough day|terrible day|awful day|sucks|sucks?|feeling.*bad|not.*feeling|no.*good)\b/.test(raw)) return true;
  if (/\b(how are you|how('?s| is) (it|things|life) (going|doing))\b/i.test(raw)) return true;
  if (/\b(howdy|what'?s up|wassup|whassup|sup\?)\b/i.test(raw)) return true;
  if (/\b(good (morning|afternoon|evening|day|night))\b/i.test(raw)) return true;
  if (/\b(nice to (meet|see) you)\b/i.test(raw)) return true;
  return false;
}

function isUrlSummaryOnlyRequest(query: string) {
  const raw = String(query || "");
  const withoutUrls = raw
    .replace(/https?:\/\/[^\s)<>"']+/gi, " ")
    .replace(/\b(?:www\.)?[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s)<>"']*)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!withoutUrls) return true;
  if (/^(analyze|analyse|summarize|summary|overview|read|scrape)\b/i.test(withoutUrls)) {
    return withoutUrls.split(/\s+/).length <= 8;
  }
  return false;
}

function extractFollowupTopic(contextLines: string[], query: string) {
  const ctx = extractConversationContextObject(contextLines);
  const lowerQuery = String(query || "").toLowerCase();

  const isEditingRequest =
    /\b(shorter|shorten|summarize|summarise|summary|condense|simpler|more concise|rewrite|rephrase|clean up|format|structure|tidy up)\b/.test(
      lowerQuery
    ) || /\b(make it|make this)\s+(short|shorter|simpler|clearer)\b/.test(lowerQuery);

  const isExplainFollowup =
    /\b(explain|elaborate|break\s+down|walk\s+me\s+through|step\s+by\s+step|block[-\s]*by[-\s]*block|in\s+blocks)\b/.test(
      lowerQuery
    ) &&
    /\b(it|this|that|code|solution|answer)\b/.test(lowerQuery);

  let lastAssistantFromContext = "";
  if (ctx && Array.isArray((ctx as any).turns)) {
    const turns = (ctx as any).turns as Array<{ role?: string; text?: string }>;
    for (let i = turns.length - 1; i >= 0; i -= 1) {
      const t = turns[i];
      if ((t?.role || "").toLowerCase() !== "assistant") continue;
      const text = (t?.text || "").toString().trim();
      if (!text) continue;
      lastAssistantFromContext = text;
      break;
    }
  }

  const latestSearchQuery =
    typeof (ctx as any)?.latest_search?.searchQuery === "string"
      ? (ctx as any).latest_search.searchQuery.trim()
      : "";

  const lastSearchFromContext = (() => {
    for (let i = contextLines.length - 1; i >= 0; i -= 1) {
      const line = String(contextLines[i] || "");
      const m = line.match(/\(Search for "([^"]+)"\)/i);
      if (m && m[1]) return m[1].trim();
    }
    return "";
  })();

  const lastUserFromContext = (() => {
    for (let i = contextLines.length - 1; i >= 0; i -= 1) {
      const line = String(contextLines[i] || "");
      if (!line.startsWith("User:")) continue;
      const t = line.replace(/^User:\s*/i, "").trim();
      if (!t) continue;
      if (t.toLowerCase() === String(query || "").toLowerCase()) continue;
      return t;
    }
    return "";
  })();

  if ((isEditingRequest || isExplainFollowup) && lastAssistantFromContext) {
    return { topic: stripCodeForSearchTopic(lastAssistantFromContext) };
  }

  const best =
    latestSearchQuery || lastSearchFromContext || stripCodeForSearchTopic(lastUserFromContext);
  return { topic: stripCodeForSearchTopic(best) };
}

const PLANNER_SYSTEM_PROMPT = COMPACT_SYSTEM_PROMPT;

export async function planQuerySteps(
  query: string,
  contextLines: string[] = []
): Promise<PlanResult> {
  const trimmed = (query || "").trim();
  if (!trimmed) {
    return { mode: "answer", reasoning: "", steps: [] };
  }

  const explicitUrls = extractUrlsFromText(trimmed);
  if (explicitUrls.length > 0) {
    const summaryOnly = isUrlSummaryOnlyRequest(trimmed);
    return {
      mode: "plan",
      reasoning:
        summaryOnly
          ? "The user provided explicit URLs, so the best next step is to scrape and summarize them directly."
          : "The user provided explicit URLs and a concrete task, so the best next step is to scrape the page(s) and answer using their content.",
      steps: [
        {
          id: "s1",
          description: summaryOnly
            ? "Scrape and summarize the provided URLs."
            : "Scrape the provided URLs and answer using their contents.",
          tool: "scrape_urls",
          canRunInParallel: false,
        },
      ],
    };
  }

  if (looksLikeSmallTalkQuery(trimmed)) {
    return { mode: "answer", reasoning: "The user input is small talk.", steps: [] };
  }

  const hasGroqKey = Boolean(
    process.env.GROQ_API_KEY || process.env.OPEN_AI_API_KEY
  );
  if (!hasGroqKey) {
    return {
      mode: "answer",
      reasoning:
        "AI keys are not configured, so I will plan to answer directly without tools.",
      steps: [
        {
          id: "s1",
          description: "Answer directly from existing knowledge.",
          tool: "answer",
          canRunInParallel: false,
        },
      ],
    };
  }

  const client = GroqClient.getInstance();
  const minimalContext = trimContextToTokenBudget(contextLines, 1500);
  const payload = {
    query: trimmed,
    context: minimalContext,
  };

  let result: Awaited<ReturnType<typeof client.generateContent>> | null = null;
  let caughtError: Error | null = null;
  let isRecoverableError = false;
  
  try {
    result = await client.generateContent(
      "openai/gpt-oss-20b",
      JSON.stringify(payload),
      {
        tools: PLANNER_TOOLS,
        tool_choice: { type: "function", function: { name: "plan" } },
        systemInstruction: {
          parts: [{ text: PLANNER_SYSTEM_PROMPT }],
        },
      }
    );
  } catch (err) {
    caughtError = err as Error;
    const errorMsg = String(caughtError.message || err);
    const isToolParseError = (err as any)?.isToolParseError;
    const isJsonError = errorMsg.includes("Failed to parse tool call arguments") ||
                        errorMsg.includes("invalid JSON");
    const isOutputParseError = errorMsg.includes("output_parse_failed") ||
                               errorMsg.includes("Parsing failed");
    
    if (isToolParseError || isJsonError || isOutputParseError) {
      console.warn("[planQuerySteps] Tool/JSON/output parse error:", errorMsg.slice(0, 100));
      isRecoverableError = true;
    } else {
      throw caughtError;
    }
  }

  // Handle tool call response if result was successful
  if (result && result.functionCalls && result.functionCalls.length > 0) {
    const fc = result.functionCalls[0];
    if (fc.name === "plan" && fc.args) {
      const args = fc.args as { mode?: string; reasoning?: string; steps?: PlannedStep[] };
      const steps: PlannedStep[] = args.steps ? [...args.steps] : [];
      const mode: PlanMode = (args.mode as "answer" | "plan") || "plan";
      const reasoning = args.reasoning || "";

      if (!steps.length) {
        steps.push({
          id: "s1",
          description: "Answer directly from existing knowledge.",
          tool: "answer",
          canRunInParallel: false,
        });
      }

      const fallbackToolQuery = stripCodeForSearchTopic(trimmed);
      for (const step of steps) {
        if (step.tool === "answer") continue;
        if (!step.query && fallbackToolQuery) {
          step.query = fallbackToolQuery.slice(0, 180);
        }
      }

      for (const step of steps) {
        if (step.tool === "answer") continue;
        if (!step.query) continue;
        if (step.description.includes("§")) continue;
        const next = `${step.description} § ${step.query}`.trim();
        step.description = next.length > 280 ? next.slice(0, 280) : next;
      }

      const nonAnswerSteps = steps.filter(s => s.tool !== "answer");
      if (nonAnswerSteps.length === 0 || nonAnswerSteps.every(s => !s.query)) {
        return { mode: "answer", reasoning: "No valid search steps from planner, answering directly.", steps: [] };
      }

      if (mode === "plan" && steps.some((s) => s.tool === "web_search") && !steps.some((s) => s.tool === "image_search")) {
        steps.splice(steps.findIndex((s) => s.tool === "web_search") + 1, 0, {
          id: `s${steps.length + 1}`,
          description: "Search images to provide an illustrative carousel.",
          tool: "image_search",
          canRunInParallel: true,
        });
      }

      if (mode === "plan" && steps.some((s) => s.tool === "web_search") && !steps.some((s) => s.tool === "scrape_urls") &&
          /\b(read|scrape|deep dive|full page|from the page|from the site|from the link|jobs?|career|careers|hiring|apply|openings?|roles?|positions?|people|person|team|staff|contact|email|linkedin)\b/i.test(trimmed)) {
        steps.splice(steps.findIndex((s) => s.tool === "web_search") + 1, 0, {
          id: `s${steps.length + 1}`,
          description: "Scrape the top links for deeper page-level detail.",
          tool: "scrape_urls",
          canRunInParallel: false,
        });
      }

      return { mode, reasoning, steps };
    }
  }

  const text = (result?.text || "").trim();
  let plan: PlanResult | null = null;
  let json: any;
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    json = null;
  }

  if (json) {
    const reasoning = typeof json.reasoning === "string" ? json.reasoning.trim() : "";
    const rawMode = typeof json.mode === "string" ? json.mode.trim() : "";
    const mode: PlanMode = rawMode === "plan" || rawMode === "PLAN" ? "plan" : "answer";
    const rawSteps = Array.isArray(json.steps) ? json.steps : [];
    const steps: PlannedStep[] = rawSteps
      .map((s: any, index: number): PlannedStep | null => {
        const tool = String(s.tool || "answer").toLowerCase() as PlannedTool;
        const validTools: PlannedTool[] = ["answer", "web_search", "image_search", "youtube_search", "shopping_search", "weather_city", "scrape_urls"];
        if (!validTools.includes(tool)) return null;
        const query = typeof s.query === "string" ? s.query.trim() : typeof s.searchQuery === "string" ? s.searchQuery.trim() : "";
        return { id: String(s.id || `s${index + 1}`), description: String(s.description || "").slice(0, 280), tool, canRunInParallel: tool === "scrape_urls" ? false : Boolean(s.canRunInParallel), query: query ? query.slice(0, 180) : undefined };
      })
      .filter(Boolean) as PlannedStep[];

    if (steps.length) plan = { mode, reasoning, steps };
  }

  // Intent-aware text fallback
  if (!plan && text) {
    const textLower = text.toLowerCase();
    const searchQuery = stripCodeForSearchTopic(trimmed);

    if (/\b(order|buy|shop|purchase|price|deals|get me|find me)\b/i.test(textLower)) {
      console.warn("[planQuerySteps] Text fallback: shopping intent detected");
      plan = { mode: "plan", reasoning: "Shopping intent detected from text response fallback", steps: [{ id: "s1", tool: "shopping_search", description: `Search for product: ${searchQuery}`, query: searchQuery, canRunInParallel: false }, { id: "s2", tool: "web_search", description: `Web search for context: ${searchQuery}`, query: searchQuery, canRunInParallel: true }] };
    } else if (/\b(trip|travel|visit|itinerary|places|tour|vlog)\b/i.test(textLower)) {
      console.warn("[planQuerySteps] Text fallback: travel intent detected");
      plan = { mode: "plan", reasoning: "Travel intent detected from text response fallback", steps: [{ id: "s1", tool: "web_search", description: `Travel guide: ${searchQuery}`, query: `${searchQuery} travel guide`, canRunInParallel: true }, { id: "s2", tool: "youtube_search", description: `Travel vlog: ${searchQuery}`, query: `${searchQuery} travel vlog`, canRunInParallel: true }] };
    } else if (/\b(video|tutorial|youtube|watch|show me|how-to)\b/i.test(textLower)) {
      console.warn("[planQuerySteps] Text fallback: video intent detected");
      plan = { mode: "plan", reasoning: "Video intent detected from text response fallback", steps: [{ id: "s1", tool: "youtube_search", description: `Video search: ${searchQuery}`, query: searchQuery, canRunInParallel: true }, { id: "s2", tool: "web_search", description: `Supporting search: ${searchQuery}`, query: searchQuery, canRunInParallel: true }] };
    } else {
      console.warn("[planQuerySteps] Text fallback: default web_search");
      plan = { mode: "plan", reasoning: "Default fallback: web search", steps: [{ id: "s1", tool: "web_search", description: `Search for: ${searchQuery}`, query: searchQuery, canRunInParallel: false }] };
    }
  }

  if (plan) return plan;

  return { mode: "answer", reasoning: "Planning failed; defaulting to a direct answer plan.", steps: [{ id: "s1", description: "Answer directly from existing knowledge.", tool: "answer", canRunInParallel: false }] };
}

const ANSWER_SYSTEM_PROMPT = 
  "You are Cloudy, the voice-first AI assistant of Atom Technologies.\n" +
  "Answer the user's question directly and conversationally.\n" +
  "Keep responses concise and natural.\n" +
  "If you don't know something, say so honestly.\n" +
  "Never mention tools, search, or AI internals.\n" +
  "Today's date: March 18, 2026.\n";

export async function answerQueryDirect(
  query: string,
  contextLines: string[] = []
): Promise<string> {
  const trimmed = (query || "").trim();
  if (!trimmed) return "";

  const lower = trimmed.toLowerCase();
  const isIdentityQuestion =
    /\b(who\s+built\s+you|who\s+made\s+you|who\s+created\s+you|who\s+developed\s+you|who\s+is\s+your\s+creator)\b/.test(
      lower
    ) ||
    /\b(who\s+are\s+you|what\s+are\s+you|your\s+name)\b/.test(lower);
  const isAtomQuestion =
    /\b(atom\s*tech|atom\s*technologies|atom\s*ctrl|g[öo]del\s+ai)\b/.test(
      lower
    );

  if (isIdentityQuestion || isAtomQuestion) {
    const includeLogo = isAtomQuestion || /atom/.test(lower);
    return (
      `${includeLogo ? "![Atom](/atommmmmmm.png)\n\n" : ""}` +
      "I'm Cloudy from Atom Ctrl by Atom Technologies (AtomTech).\n\n" +
      "AtomTech builds practical AI systems that can operate real-world software, starting with Atom Ctrl (a voice-first search assistant integrated into chat) and the longer-term Gödel AI architecture (a fast general brain + specialist domain experts).\n\n" +
      "Atom Technologies was founded by Aditya Panigarhi."
    );
  }

  const hasGroqKey = Boolean(
    process.env.GROQ_API_KEY || process.env.OPEN_AI_API_KEY
  );
  if (!hasGroqKey) {
    return "I cannot answer right now because AI keys are not configured.";
  }

  const client = GroqClient.getInstance();
  const topic = extractFollowupTopic(contextLines, trimmed).topic;
  const minimalContext = trimContextToTokenBudget(contextLines, 1200);
  const payload = {
    query: trimmed,
    context: minimalContext,
    topic,
  };

  try {
    const result = await client.generateContent(
      "openai/gpt-oss-20b",
      JSON.stringify(payload),
      {
        systemInstruction: {
          parts: [{ text: ANSWER_SYSTEM_PROMPT }],
        },
      }
    );
    const raw = String(result?.text || "").trim();
    if (raw) {
      return raw.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    }
  } catch (err) {
    console.warn("[answerQueryDirect] Error:", String(err).slice(0, 150));
  }
  
  return "I don't have enough information to answer that. Try searching for it.";
}

export async function runAgentPlan(
  query: string,
  options: RunAgentOptions = {}
): Promise<DynamicSearchResult> {
  const trimmed = (query || "").trim();
  if (!trimmed) return { type: "text", content: "" };

  const contextLines = options.context ?? [];
  if (looksLikeSmallTalkQuery(trimmed)) {
    const answer = await answerQueryDirect(trimmed, contextLines);
    return { type: "text", content: answer };
  }
  const lower = trimmed.toLowerCase();
  const isIdentityQuestion =
    /\b(who\s+built\s+you|who\s+made\s+you|who\s+created\s+you|who\s+developed\s+you|who\s+is\s+your\s+creator)\b/.test(
      lower
    ) ||
    /\b(who\s+are\s+you|what\s+are\s+you|your\s+name)\b/.test(lower);
  const isAtomQuestion =
    /\b(atom\s*tech|atom\s*technologies|atom\s*ctrl|g[öo]del\s+ai)\b/.test(
      lower
    );
  if (isIdentityQuestion || isAtomQuestion) {
    const answer = await answerQueryDirect(trimmed, contextLines);
    return { type: "text", content: answer };
  }

  // FAST PATH: Skip planning for simple direct search queries
  // If it looks like a clear search query, skip the planning LLM call entirely
  const lowerQuery = trimmed.toLowerCase();
  const isObviousSearch =
    /^what(is|are|was|were|who|where|when|why|how)\b/i.test(lowerQuery) ||
    /^(search|find|look up|google)\s+/i.test(lowerQuery) ||
    /^(latest|new|top|best|cheap|price)\s+/i.test(lowerQuery) ||
    /\b(tutorial|review|price|news|current)\b/i.test(lowerQuery);

  let plan: PlanResult;
  if (isObviousSearch && contextLines.length === 0) {
    // Fast path: skip planning entirely for simple searches without context
    const searchQuery = stripCodeForSearchTopic(trimmed);
    plan = {
      mode: "plan",
      reasoning: "Simple search query detected, using fast path.",
      steps: [
        { id: "s1", description: `Web search for: ${searchQuery}`, tool: "web_search", canRunInParallel: false },
        { id: "s2", description: "Image search for illustration", tool: "image_search", canRunInParallel: true },
      ],
    };
  } else {
    plan = options.planOverride ?? (await planQuerySteps(trimmed, contextLines));
  }

  const toolSteps = plan.steps.filter((s) => s.tool !== "answer");
  const hasTools = toolSteps.length > 0;
  if (!hasTools) {
    const answer = await answerQueryDirect(trimmed, contextLines);
    return { type: "text", content: answer };
  }

  const aiProvider = "groq";

  const needsWeb = toolSteps.some((s) => s.tool === "web_search");
  const needsImages = toolSteps.some((s) => s.tool === "image_search");
  const needsYoutube = toolSteps.some((s) => s.tool === "youtube_search");
  const needsShopping = toolSteps.some((s) => s.tool === "shopping_search");
  const needsWeather = toolSteps.some((s) => s.tool === "weather_city");
  const needsScrape = toolSteps.some((s) => s.tool === "scrape_urls");
  const hasNonYoutubeTools = toolSteps.some((s) => s.tool !== "youtube_search");
  const youtubeMaxResults = hasNonYoutubeTools ? 1 : 4;

  let overallSummaryLines: string[] = [];
  let summary: string | null = null;
  let webItems: {
    link: string;
    title: string;
    summaryLines: string[];
    imageUrl?: string;
  }[] = [];
  let mediaItems: { src: string; alt?: string }[] = [];
  let scrapedItems: ScrapedUrlSummary[] = [];
  let youtubeItems: YouTubeVideo[] = [];
  let shoppingItems: ShoppingProduct[] = [];
  let weatherItems: WeatherItem[] = [];
  const plannerChosenQuery =
    toolSteps.find((s) => s.tool === "web_search" && s.query)?.query ||
    toolSteps.find((s) => s.tool === "image_search" && s.query)?.query ||
    toolSteps.find((s) => s.tool === "youtube_search" && s.query)?.query ||
    toolSteps.find((s) => s.tool === "shopping_search" && s.query)?.query ||
    toolSteps.find((s) => s.tool === "weather_city" && s.query)?.query ||
    "";
  let searchQueryForTools = plannerChosenQuery || stripCodeForSearchTopic(trimmed);
  const explicitUrls = extractUrlsFromText(trimmed);

  const looksReferential = /\b(it|this|that|these|those|them|again|same|one)\b/i.test(
    trimmed
  );
  const wantsTutorial = /tutorial|how to|guide|walkthrough|demo|example/i.test(trimmed);
  const wantsFollowup =
    looksReferential ||
    wantsTutorial ||
    /^\s*(explain|elaborate|break\s+down|walk\s+me\s+through|step\s+by\s+step)\b/i.test(
      trimmed
    );
  const followupTopic = wantsFollowup
    ? extractFollowupTopic(contextLines, trimmed).topic
    : "";
  if (followupTopic) {
    searchQueryForTools = followupTopic;
  }

  if (!followupTopic && plannerChosenQuery) {
    searchQueryForTools = plannerChosenQuery;
  }

  const hasScrapeStep = toolSteps.some((s) => s.tool === "scrape_urls");
  const scrapeDependsOnWebItems = hasScrapeStep && explicitUrls.length === 0;
  const phase1 = scrapeDependsOnWebItems
    ? toolSteps.filter((s) => s.tool !== "scrape_urls")
    : toolSteps;
  const phase2 = scrapeDependsOnWebItems
    ? toolSteps.filter((s) => s.tool === "scrape_urls")
    : [];
  const batches: PlannedStep[][] = [];
  if (phase1.length) batches.push(phase1);
  for (const s of phase2) batches.push([s]);

  const queryForTool = (tool: PlannedTool) => {
    if (!followupTopic) return searchQueryForTools;
    if ((tool === "web_search" || tool === "youtube_search") && wantsTutorial) {
      return `${followupTopic} tutorial`;
    }
    return followupTopic;
  };

  const runTool = async (step: PlannedStep) => {
    const tool = step.tool;
    const toolQuery = step.query?.trim() ? step.query.trim() : queryForTool(tool);
    switch (tool) {
      case "web_search":
        return { tool, value: await webSearch(toolQuery) };
      case "image_search":
        return {
          tool,
          value: await imageSearch(toolQuery, { num: 10, safe: "active" }),
        };
      case "youtube_search":
        return {
          tool,
          value: await youtubeSearch(toolQuery, {
            maxResults: youtubeMaxResults,
          }),
        };
      case "shopping_search":
        return {
          tool,
          value: await shoppingSearch(toolQuery, {
            maxResults: 4,
            location: options.shoppingLocation || undefined,
          }),
        };
      case "weather_city":
        return { tool, value: await fetchWeatherForCity(toolQuery) };
      case "scrape_urls": {
        const urls =
          explicitUrls.length > 0
            ? explicitUrls
            : Array.isArray(rawWebItems) && rawWebItems.length > 0
              ? rawWebItems
                  .map((it: any) => String(it?.link || "").trim())
                  .filter(Boolean)
                  .slice(0, 2)
              : [];
        const mode =
          explicitUrls.length > 0 && !isUrlSummaryOnlyRequest(trimmed)
            ? "answer"
            : "summary";
        const scraped = await scrapeUrls({
          urls,
          query: trimmed,
          mode,
        });
        return { tool, value: scraped };
      }
      default:
        return { tool, value: null };
    }
  };

  let rawWebItems: any[] = [];
  let rawMedia: any[] = [];
  let rawScraped: any[] = [];
  let rawScrapeAnswer = "";
  let yt: any[] = [];
  let shop: any[] = [];
  let weatherItem: any = null;

  for (const batch of batches) {
    const settled = await Promise.allSettled(batch.map((s) => runTool(s)));

    settled
      .filter((r) => r.status === "rejected")
      .forEach((r) =>
        console.warn("[agent-plan] Tool failed silently:", (r as PromiseRejectedResult).reason)
      );

    for (const settledResult of settled) {
      if (settledResult.status !== "fulfilled") continue;
      const r = settledResult.value;
      if (r.tool === "web_search" && Array.isArray(r.value)) rawWebItems = r.value;
      if (r.tool === "image_search" && Array.isArray(r.value)) rawMedia = r.value;
      if (r.tool === "youtube_search" && Array.isArray(r.value)) yt = r.value;
      if (r.tool === "shopping_search" && Array.isArray(r.value)) shop = r.value;
      if (r.tool === "scrape_urls" && r.value && typeof r.value === "object") {
        const items = (r.value as any).items;
        const answer = (r.value as any).answer;
        if (Array.isArray(items)) rawScraped = items;
        if (typeof answer === "string") rawScrapeAnswer = answer;
      }
      if (r.tool === "weather_city") weatherItem = r.value;
    }
  }

  if (Array.isArray(rawMedia)) {
    mediaItems = rawMedia;
  }

  if (Array.isArray(rawScraped)) {
    scrapedItems = rawScraped;
  }

  const explicitScrapeAnswerMode =
    explicitUrls.length > 0 && !isUrlSummaryOnlyRequest(trimmed);
  if (explicitScrapeAnswerMode && rawScrapeAnswer.trim()) {
    const sources = (scrapedItems.length ? scrapedItems.map((s) => s.url) : explicitUrls).slice(
      0,
      2
    );
    const header = sources.map((u) => `- ${u}`).join("\n");
    return {
      type: "text",
      content: `Sources:\n${header}\n\n${rawScrapeAnswer.trim()}`,
    };
  }

  if (Array.isArray(yt)) {
    youtubeItems = yt;
  }

  if (Array.isArray(shop)) {
    shoppingItems = shop.slice(0, 4);
  }

  if (weatherItem) {
    weatherItems = [weatherItem];
  }

  const hasShopping = shoppingItems.length > 0;

  if (Array.isArray(rawWebItems) && rawWebItems.length > 0) {
    overallSummaryLines = [];
    webItems = rawWebItems.map((it: any) => {
      const snippet = String(it?.snippet || "").trim();
      const normalized = [snippet, "", ""];
      return {
        link: it.link,
        title: it.title,
        summaryLines: normalized,
        imageUrl: it.imageUrl,
      };
    });
    summary = null;
  } else if (scrapedItems.length > 0) {
    if (rawScrapeAnswer.trim()) {
      summary = rawScrapeAnswer.trim();
      overallSummaryLines = ["Read the link and answered using its contents.", ""];
    } else {
      overallSummaryLines = ["Details from the sites below.", ""];
    }
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
      searchQueryForTools,
      aiProvider
    );
    if (shoppingSummary) {
      summary = shoppingSummary;
      overallSummaryLines = [shoppingSummary, ""];
    } else if (!overallSummaryLines.length) {
      overallSummaryLines = ["Found products for your request.", ""];
    }
  }

  return {
    type: "search",
    data: {
      searchQuery: searchQueryForTools,
      overallSummaryLines,
      summary,
      webItems,
      mediaItems,
      scrapedItems,
      weatherItems,
      youtubeItems,
      shoppingItems,
      shouldShowTabs: true,
    },
  };
}
