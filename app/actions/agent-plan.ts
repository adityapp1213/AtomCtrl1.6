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
      description: "Plan the steps to answer the user's query. ALWAYS call this tool to return structured JSON. The model SHOULD call multiple tools in parallel when needed (e.g., web_search + youtube_search for news briefings, shopping_search + web_search for shopping decisions).",
      parameters: {
        type: "object",
        properties: {
          mode: {
            type: "string",
            enum: ["answer", "plan"],
            description: "Whether to answer directly (answer) or use tools (plan). Use 'plan' when search/web/youtube/shopping/tools are needed.",
          },
          reasoning: {
            type: "string",
            description: "Brief explanation of WHY this plan was chosen, including which Rule from the Tool Matrix was applied and what the user is trying to accomplish.",
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
                query: { type: "string", description: "Search query for this tool. Keep it focused: 2-5 high-signal words. E.g., 'best places visit India Taj Mahal' not 'I want to find the best places to visit in India besides the Taj Mahal'" },
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
  // Catch emotional expressions and complaints: "ugh", "oof", "meh", "sucks", "bad day", "not feeling", etc.
  if (/\b(ugh|oof|meh|darn|argh|yikes|yikes)\b/.test(raw)) return true;
  if (/\b(bad day|rough day|terrible day|awful day|sucks|sucks?|feeling.*bad|not.*feeling|no.*good)\b/.test(raw)) return true;
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
  // For planning, use minimal context to stay within token limits.
  // The planner only needs the most recent context, not the entire history.
  const minimalContext = contextLines.slice(-10).filter((line) => {
    const trimmed = line.trim();
    return trimmed.length > 0 && trimmed.length < 500; // Skip extremely long lines
  });
  const payload = {
    query: trimmed,
    context: minimalContext,
  };

  let result: Awaited<ReturnType<typeof client.generateContent>>;
  try {
    result = await client.generateContent(
      "openai/gpt-oss-20b",
      JSON.stringify(payload),
      {
        tools: PLANNER_TOOLS,
        systemInstruction: {
          parts: [{ text: PLANNER_SYSTEM_PROMPT }],
        },
      }
    );
  } catch (err) {
    const errorMsg = String((err as Error)?.message || err);
    const isToolParseError = (err as any)?.isToolParseError;
    // If Groq fails to parse tool call arguments, fall back to simple search
    if (isToolParseError || errorMsg.includes("Failed to parse tool call arguments")) {
      console.warn("[planQuerySteps] Tool call parsing failed, falling back to text parsing");
      return {
        mode: "plan" as PlanMode,
        reasoning: "Using fallback planning due to tool parsing issue.",
        steps: [
          {
            id: "s1",
            description: `Search the web for: ${stripCodeForSearchTopic(trimmed)}`,
            tool: "web_search",
            canRunInParallel: false,
            query: stripCodeForSearchTopic(trimmed),
          },
        ],
      };
    }
    throw err;
  }

  // Handle tool call response
  if (result.functionCalls && result.functionCalls.length > 0) {
    const fc = result.functionCalls[0];
    if (fc.name === "plan" && fc.args) {
      const args = fc.args as { mode?: string; reasoning?: string; steps?: PlannedStep[] };
      let steps: PlannedStep[] = args.steps || [];
      const mode: PlanMode = (args.mode as "answer" | "plan") || "plan";
      const reasoning = args.reasoning || "";

      // Apply tool augmentation
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

      if (
        mode === "plan" &&
        steps.some((s) => s.tool === "web_search") &&
        !steps.some((s) => s.tool === "image_search")
      ) {
        const insertAt = Math.max(0, steps.findIndex((s) => s.tool === "web_search") + 1);
        steps.splice(insertAt, 0, {
          id: `s${steps.length + 1}`,
          description: "Search images to provide an illustrative carousel.",
          tool: "image_search",
          canRunInParallel: true,
        });
      }

      if (
        mode === "plan" &&
        steps.some((s) => s.tool === "web_search") &&
        !steps.some((s) => s.tool === "scrape_urls") &&
        /\b(read|scrape|deep dive|full page|from the page|from the site|from the link|jobs?|career|careers|hiring|apply|openings?|roles?|positions?|people|person|team|staff|contact|email|linkedin)\b/i.test(trimmed)
      ) {
        const insertAt = Math.max(0, steps.findIndex((s) => s.tool === "web_search") + 1);
        steps.splice(insertAt, 0, {
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
  let json: any;
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    json = JSON.parse(text.slice(start, end + 1));
  } catch {
    return {
      mode: "answer",
      reasoning: "Planning failed; defaulting to a direct answer plan.",
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

  const reasoning =
    typeof json.reasoning === "string" ? json.reasoning.trim() : "";
  const rawMode = typeof json.mode === "string" ? json.mode.trim() : "";
  const mode: PlanMode =
    rawMode === "plan" || rawMode === "PLAN" ? "plan" : "answer";
  const rawSteps = Array.isArray(json.steps) ? json.steps : [];
  const steps: PlannedStep[] = rawSteps
    .map((s: any, index: number): PlannedStep | null => {
      const tool = String(s.tool || "answer").toLowerCase() as PlannedTool;
      const validTools: PlannedTool[] = [
        "answer",
        "web_search",
        "image_search",
        "youtube_search",
        "shopping_search",
        "weather_city",
        "scrape_urls",
      ];
      if (!validTools.includes(tool)) return null;
      const query =
        typeof s.query === "string"
          ? s.query.trim()
          : typeof s.searchQuery === "string"
            ? s.searchQuery.trim()
            : "";
      return {
        id: String(s.id || `s${index + 1}`),
        description: String(s.description || "").slice(0, 280),
        tool,
        canRunInParallel: tool === "scrape_urls" ? false : Boolean(s.canRunInParallel),
        query: query ? query.slice(0, 180) : undefined,
      };
    })
    .filter(Boolean) as PlannedStep[];

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

  if (
    mode === "plan" &&
    steps.some((s) => s.tool === "web_search") &&
    !steps.some((s) => s.tool === "image_search")
  ) {
    const insertAt = Math.max(
      0,
      steps.findIndex((s) => s.tool === "web_search") + 1
    );
    steps.splice(insertAt, 0, {
      id: `s${steps.length + 1}`,
      description: "Search images to provide an illustrative carousel.",
      tool: "image_search",
      canRunInParallel: true,
    });
  }

  if (
    mode === "plan" &&
    steps.some((s) => s.tool === "web_search") &&
    !steps.some((s) => s.tool === "scrape_urls") &&
    /\b(read|scrape|deep dive|full page|from the page|from the site|from the link|jobs?|career|careers|hiring|apply|openings?|roles?|positions?|people|person|team|staff|contact|email|linkedin)\b/i.test(trimmed)
  ) {
    const insertAt = Math.max(
      0,
      steps.findIndex((s) => s.tool === "web_search") + 1
    );
    steps.splice(insertAt, 0, {
      id: `s${steps.length + 1}`,
      description: "Scrape the top links for deeper page-level detail.",
      tool: "scrape_urls",
      canRunInParallel: false,
    });
  }

  return { mode, reasoning, steps };
}

const ANSWER_SYSTEM_PROMPT = COMPACT_SYSTEM_PROMPT;

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
  // Keep context minimal to avoid token limit errors.
  const minimalContext = contextLines.slice(-8).filter((line) => {
    const trimmed2 = line.trim();
    return trimmed2.length > 0 && trimmed2.length < 500;
  });
  const payload = {
    query: trimmed,
    context: minimalContext,
    topic,
  };

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
  if (!raw) {
    return "I am not able to generate a useful answer right now.";
  }
  const normalized = raw
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");
  return normalized;
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

  const plan =
    options.planOverride ?? (await planQuerySteps(trimmed, contextLines));

  const toolSteps = plan.steps.filter((s) => s.tool !== "answer");
  const hasTools = toolSteps.length > 0;
  if (!hasTools) {
    const answer = await answerQueryDirect(trimmed, contextLines);
    return { type: "text", content: answer };
  }

  const jar = await cookies();
  const aiProvider =
    jar.get("ai_provider")?.value === "gemini" ? "gemini" : "groq";

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
          providerOverride: aiProvider,
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
    const results = await Promise.all(batch.map((s) => runTool(s)));
    for (const r of results) {
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
      mapLocation: undefined,
      googleMapsKey: process.env.GOOGLE_MAP_API_KEY,
    },
  };
}
