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
import type { DynamicSearchResult } from "@/app/actions/search";

export type PlannedTool =
  | "answer"
  | "web_search"
  | "image_search"
  | "youtube_search"
  | "shopping_search"
  | "weather_city";

export type PlannedStep = {
  id: string;
  description: string;
  tool: PlannedTool;
  canRunInParallel: boolean;
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

const PLANNER_SYSTEM_PROMPT =
  "You are Cloudy's planning module.\n" +
  "\n" +
  "Goal:\n" +
  "- Given a user query and optional context, first decide whether the user needs only a direct conversational answer\n" +
  '  or a multi-step plan that uses tools. Set \"mode\" to \"answer\" when a direct answer is enough, otherwise set it to \"plan\".\n' +
  "- When the query asks for factual information, comparisons, libraries/SDKs, or tutorials, you SHOULD usually use tools.\n" +
  "  For example, for \"what is ai sdk by vercel\" you should plan to:\n" +
  "    1) search the web for what the AI SDK is and official docs (web_search), and\n" +
  "    2) find a YouTube tutorial that shows how to use it (youtube_search).\n" +
  "\n" +
  "Available tools:\n" +
  "- answer            → answer directly from your own knowledge (no external tools).\n" +
  "- web_search        → call web search to fetch web pages / docs / articles.\n" +
  "- image_search      → call image search for illustrative images.\n" +
  "- youtube_search    → call YouTube API for tutorial / demo / explainer videos.\n" +
  "- shopping_search   → call shopping search for products and deals.\n" +
  "- weather_city      → call weather API when the user asks about weather in a city.\n" +
  "\n" +
  "Planning rules:\n" +
  "- Prefer MULTI-STEP plans when tools add clear value.\n" +
  "- Group tools that can run together (web_search + youtube_search + shopping_search) by setting canRunInParallel = true.\n" +
  "- When you include web_search, you should usually ALSO include image_search in parallel to provide illustrative images.\n" +
  "- Use answer alone only for casual chat or when tools are clearly unnecessary.\n" +
  "\n" +
  "Output:\n" +
  "- First think step by step about what to do.\n" +
  "- Then return ONLY strict JSON:\n" +
  '  {\"mode\": \"answer\" | \"plan\", \"reasoning\": string, \"steps\": [\n' +
  '    {\"id\": string, \"description\": string, \"tool\": string, \"canRunInParallel\": boolean}, ...\n' +
  "  ]}\n";

export async function planQuerySteps(
  query: string,
  contextLines: string[] = []
): Promise<PlanResult> {
  const trimmed = (query || "").trim();
  if (!trimmed) {
    return { mode: "answer", reasoning: "", steps: [] };
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
  const payload = {
    query: trimmed,
    context: contextLines.slice(-40),
  };

  const result = await client.generateContent(
    "openai/gpt-oss-20b",
    JSON.stringify(payload),
    {
      systemInstruction: {
        parts: [{ text: PLANNER_SYSTEM_PROMPT }],
      },
    }
  );

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
      ];
      if (!validTools.includes(tool)) return null;
      return {
        id: String(s.id || `s${index + 1}`),
        description: String(s.description || "").slice(0, 280),
        tool,
        canRunInParallel: Boolean(s.canRunInParallel),
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

  return { mode, reasoning, steps };
}

const ANSWER_SYSTEM_PROMPT =
  "You are Cloudy, a helpful conversational AI assistant. " +
  "Given the user query and optional context, respond directly and conversationally. " +
  "Do not mention tools, planning, or internal reasoning. " +
  "Keep the answer focused on what the user asked for.";

export async function answerQueryDirect(
  query: string,
  contextLines: string[] = []
): Promise<string> {
  const trimmed = (query || "").trim();
  if (!trimmed) return "";

  const hasGroqKey = Boolean(
    process.env.GROQ_API_KEY || process.env.OPEN_AI_API_KEY
  );
  if (!hasGroqKey) {
    return "I cannot answer right now because AI keys are not configured.";
  }

  const client = GroqClient.getInstance();
  const payload = {
    query: trimmed,
    context: contextLines.slice(-40),
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
  let youtubeItems: YouTubeVideo[] = [];
  let shoppingItems: ShoppingProduct[] = [];
  let weatherItems: WeatherItem[] = [];
  let searchQueryForTools = trimmed;

  const looksReferential = /\b(it|this|that|these|those|them|again|same|one)\b/i.test(
    trimmed
  );
  const wantsTutorial = /tutorial|how to|guide|walkthrough|demo|example/i.test(trimmed);
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
      if (t.toLowerCase() === trimmed.toLowerCase()) continue;
      return t;
    }
    return "";
  })();

  const shouldUseContextTopic = looksReferential || wantsTutorial;
  const referentialTopic =
    shouldUseContextTopic && (lastSearchFromContext || lastUserFromContext)
      ? (lastSearchFromContext || lastUserFromContext)
      : "";
  if (referentialTopic) {
    searchQueryForTools = referentialTopic;
  }

  if (!referentialTopic && (needsWeb || needsImages || needsYoutube || needsShopping || needsWeather)) {
    try {
      const intent = await detectIntent(trimmed, contextLines, aiProvider);
      const candidate =
        (intent.searchQuery ?? intent.webSearchQuery ?? "").trim();
      if (candidate) {
        searchQueryForTools = candidate;
      }
    } catch {
    }
  }

  const batches: PlannedStep[][] = [];
  let currentBatch: PlannedStep[] = [];
  for (const step of toolSteps) {
    if (step.canRunInParallel) {
      currentBatch.push(step);
    } else {
      if (currentBatch.length) batches.push(currentBatch);
      currentBatch = [];
      batches.push([step]);
    }
  }
  if (currentBatch.length) batches.push(currentBatch);

  const queryForTool = (tool: PlannedTool) => {
    if (!referentialTopic) return searchQueryForTools;
    if ((tool === "web_search" || tool === "youtube_search") && wantsTutorial) {
      return `${referentialTopic} tutorial`;
    }
    return referentialTopic;
  };

  const runTool = async (tool: PlannedTool) => {
    const toolQuery = queryForTool(tool);
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
      default:
        return { tool, value: null };
    }
  };

  let rawWebItems: any[] = [];
  let rawMedia: any[] = [];
  let yt: any[] = [];
  let shop: any[] = [];
  let weatherItem: any = null;

  for (const batch of batches) {
    const results = await Promise.all(batch.map((s) => runTool(s.tool)));
    for (const r of results) {
      if (r.tool === "web_search" && Array.isArray(r.value)) rawWebItems = r.value;
      if (r.tool === "image_search" && Array.isArray(r.value)) rawMedia = r.value;
      if (r.tool === "youtube_search" && Array.isArray(r.value)) yt = r.value;
      if (r.tool === "shopping_search" && Array.isArray(r.value)) shop = r.value;
      if (r.tool === "weather_city") weatherItem = r.value;
    }
  }

  if (Array.isArray(rawMedia)) {
    mediaItems = rawMedia;
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
    const s = await summarizeItems(rawWebItems, searchQueryForTools, aiProvider);
    if (s.overallSummaryLines.length > 0) {
      overallSummaryLines = s.overallSummaryLines;
    }
    webItems = rawWebItems.map((it: any, idx: number) => {
      const found = s.summaries.find((x) => x.index === idx);
      const lines =
        Array.isArray(found?.summary_lines) && found.summary_lines.length
          ? found.summary_lines.slice(0, 3)
          : [it.snippet || ""].filter(Boolean).slice(0, 1);
      const normalized = [lines[0] ?? "", lines[1] ?? "", lines[2] ?? ""];
      return {
        link: it.link,
        title: it.title,
        summaryLines: normalized,
        imageUrl: it.imageUrl,
      };
    });
    summary = await summarizeChatAnswerFromWebItems(
      webItems,
      searchQueryForTools,
      aiProvider
    );
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
      weatherItems,
      youtubeItems,
      shoppingItems,
      shouldShowTabs: false,
      mapLocation: undefined,
      googleMapsKey: process.env.GOOGLE_MAP_API_KEY,
    },
  };
}
