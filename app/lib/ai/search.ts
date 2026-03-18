import { GeminiClient } from "./gemini-client";
import { GroqClient } from "./groq/groq-client";
import { DETECT_INTENT_SYSTEM_PROMPT } from "./system-prompts";

const CLOUDY_SUMMARY_SYSTEM_PROMPT =
  DETECT_INTENT_SYSTEM_PROMPT +
  "\n" +
  "\n" +
  "This request is for generating the assistant's final user-facing answer from provided sources only.\n" +
  "- Do not mention tools, planning, or internal reasoning.\n" +
  "- Do not invent sources or URLs.\n";

type RawItem = { link: string; title: string; snippet?: string; imageUrl?: string };
type SummItem = { index: number; summary_lines: string[] };

type WebSearchOptions = {
  num?: number;
  cx?: string;
  safe?: "active" | "off" | "high" | "medium";
};

type ImageSearchOptions = {
  num?: number;
  cx?: string;
  safe?: "active" | "off" | "high" | "medium";
};

type WebItemSummary = {
  link: string;
  title: string;
  summaryLines?: string[];
  snippet?: string;
};

async function webSearchViaSerpApi(query: string, options: WebSearchOptions = {}): Promise<RawItem[]> {
  const trimmed = (query ?? "").trim();
  if (!trimmed) return [];

  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    console.warn("[ai:webSearch] Missing SERPAPI_API_KEY for SerpAPI fallback");
    return [];
  }

  const requestedNum = typeof options.num === "number" ? options.num : 10;
  const num = Math.min(Math.max(requestedNum, 1), 10);

  const params = new URLSearchParams();
  params.set("engine", "google");
  params.set("q", trimmed);
  params.set("api_key", apiKey);
  params.set("num", String(num));

  const url = `https://serpapi.com/search.json?${params.toString()}`;

  try {
    const res = await fetch(url, { next: { revalidate: 120 } });
    if (!res.ok) {
      console.warn("[ai:webSearch] SerpAPI web error", res.status, res.statusText);
      return [];
    }
    const json: any = await res.json();
    const items: any[] = Array.isArray(json.organic_results) ? json.organic_results : [];
    return items.slice(0, num).map((item: any): RawItem => ({
      link: String(item.link || item.formattedUrl || "").trim(),
      title: String(item.title || item.name || "").trim(),
      snippet:
        typeof item.snippet === "string"
          ? item.snippet
          : Array.isArray(item.snippet_highlighted_words)
          ? item.snippet_highlighted_words.join(" ")
          : "",
      imageUrl:
        (item.thumbnail && String(item.thumbnail).trim()) ||
        (item.rich_snippet && item.rich_snippet.top && item.rich_snippet.top.thumbnail && String(item.rich_snippet.top.thumbnail).trim()) ||
        undefined,
    })).filter((it) => Boolean(it.link) && Boolean(it.title));
  } catch (err) {
    console.warn("[ai:webSearch] SerpAPI web exception", err);
    return [];
  }
}

async function imageSearchViaSerpApi(
  query: string,
  options: ImageSearchOptions = {}
): Promise<{ src: string; alt?: string }[]> {
  const trimmed = (query ?? "").trim();
  if (!trimmed) return [];

  const apiKey = process.env.SERPAPI_API_KEY;
  if (!apiKey) {
    console.warn("[ai:imageSearch] Missing SERPAPI_API_KEY for SerpAPI fallback");
    return [];
  }

  const requestedNum = typeof options.num === "number" ? options.num : 10;
  const num = Math.min(Math.max(requestedNum, 1), 10);

  const params = new URLSearchParams();
  params.set("engine", "google");
  params.set("q", trimmed);
  params.set("tbm", "isch");
  params.set("ijn", "0");
  params.set("api_key", apiKey);

  const url = `https://serpapi.com/search.json?${params.toString()}`;

  try {
    const res = await fetch(url, { next: { revalidate: 120 } });
    if (!res.ok) {
      console.warn("[ai:imageSearch] SerpAPI image error", res.status, res.statusText);
      return [];
    }
    const json: any = await res.json();
    const items: any[] = Array.isArray(json.images_results) ? json.images_results : [];
    return items
      .slice(0, num)
      .map((item: any) => ({
        src: String(item.original || item.thumbnail || item.link || "").trim(),
        alt: item.title || item.alt || "",
      }))
      .filter((i) => Boolean(i.src));
  } catch (err) {
    console.warn("[ai:imageSearch] SerpAPI image exception", err);
    return [];
  }
}

function extractJson(s: string) {
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(s.slice(start, end + 1));
    } catch {
      return null;
    }
  }
  return null;
}

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

  const requestedNum = typeof options.num === "number" ? options.num : 10;
  const num = Math.min(Math.max(requestedNum, 1), 10);
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("num", String(num));
  if (options.safe) url.searchParams.set("safe", options.safe);

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 120 } });
    if (!res.ok) {
      console.warn("[ai:webSearch] Non-OK response", res.status, res.statusText, "– using SerpAPI fallback if available");
      return webSearchViaSerpApi(trimmed, options);
    }
    const json = await res.json();
    const items = Array.isArray(json.items) ? json.items : [];
    const rawItems: RawItem[] = items.slice(0, num).map((item: any) => ({
      link: item.link,
      title: item.title,
      snippet: item.snippet,
      imageUrl: item.pagemap?.cse_image?.[0]?.src || item.pagemap?.cse_thumbnail?.[0]?.src,
    }));
    return rawItems;
  } catch (err) {
    console.warn("[ai:webSearch] Error calling Custom Search API", err, "– using SerpAPI fallback if available");
    return webSearchViaSerpApi(trimmed, options);
  }
}

export async function imageSearch(
  query: string,
  options: ImageSearchOptions = {}
): Promise<{ src: string; alt?: string }[]> {
  const trimmed = (query ?? "").trim();
  if (!trimmed) return [];

  const apiKey = process.env.GOOGLE_API_KEY;
  const cxEnv = process.env.GOOGLE_CX || process.env.GOOGLE_CSE_ID;
  const cx = options.cx || cxEnv;
  if (!apiKey || !cx) {
    console.warn("[ai:imageSearch] Missing GOOGLE_API_KEY or GOOGLE_CX, using SerpAPI fallback if available");
    return imageSearchViaSerpApi(trimmed, options);
  }

  const requestedNum = typeof options.num === "number" ? options.num : 10;
  const num = Math.min(Math.max(requestedNum, 1), 10);
  const url = new URL("https://www.googleapis.com/customsearch/v1");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("cx", cx);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("searchType", "image");
  url.searchParams.set("num", String(num));
  url.searchParams.set("imgSize", "large");
  url.searchParams.set("fields", "items(link,title,image/thumbnailLink,image/contextLink)");
  if (options.safe) url.searchParams.set("safe", options.safe);

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 120 } });
    if (!res.ok) {
      console.warn("[ai:imageSearch] Non-OK response", res.status, res.statusText, "– using SerpAPI fallback if available");
      return imageSearchViaSerpApi(trimmed, options);
    }
    const json = await res.json();
    const items = Array.isArray(json.items) ? json.items : [];
    const mapped = (
      items as Array<{
        link?: string;
        title?: string;
        image?: { thumbnailLink?: string; contextLink?: string };
      }>
    )
      .slice(0, num)
      .map((i) => ({
        src: i.link || i.image?.thumbnailLink || i.image?.contextLink || "",
        alt: i.title,
      }))
      .filter((i) => Boolean(i.src));
    return mapped;
  } catch (err) {
    console.warn("[ai:imageSearch] Error calling Custom Search API", err, "– using SerpAPI fallback if available");
    return imageSearchViaSerpApi(trimmed, options);
  }
}

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

  if (!(hasGroqKey || hasGeminiKey)) {
    return { overallSummaryLines: [], summaries: [] };
  }

  const trimmedItems = items.slice(0, 10);
  const trimmedQuery = (query ?? "").toString().trim();

  try {
    const prompt =
      `You are answering the user query: "${trimmedQuery || "N/A"}" using web search results. ` +
      "Return strictly valid compact JSON with keys overall_summary_lines and items. " +
      "overall_summary_lines must be an array of at most two very short plain-text lines " +
      "that directly answer the user's query using only the information implied by the results. " +
      "Write the answer as if you are responding directly to the user, not describing \"results\" in general. " +
      "When possible, briefly mention which result supports the answer, such as a site name or article title. " +
      "items must be an array of objects {index, summary_lines}, where index is the zero-based " +
      "index into the original results array, and summary_lines is an array of up to three very short " +
      "plain-text lines summarizing that specific result. " +
      `Use this data: ${JSON.stringify(trimmedItems)}`;

    const resp =
      provider === "groq" && hasGroqKey
        ? await GroqClient.getInstance().generateContent("openai/gpt-oss-20b", prompt, {
            systemInstruction: { parts: [{ text: CLOUDY_SUMMARY_SYSTEM_PROMPT }] },
          })
        : await GeminiClient.getInstance().generateContent("gemini-2.5-flash", prompt);

    const parsed = extractJson(resp?.text || "");
    const overallSummaryLines: string[] = Array.isArray(parsed?.overall_summary_lines)
      ? parsed.overall_summary_lines.slice(0, 2)
      : [];
    const summaries: SummItem[] = Array.isArray(parsed?.items) ? parsed.items : [];
    return { overallSummaryLines, summaries };
  } catch (err) {
    const errMsg = String((err as Error)?.message || err);
    if (errMsg.includes("image input") || errMsg.includes("clipboard")) {
      console.warn("[ai:summarizeItems] Model doesn't support image input, returning raw summaries");
      // Return raw summaries without AI processing
      const rawSummaries: SummItem[] = trimmedItems.map((item, idx) => ({
        index: idx,
        summary_lines: [(item.title || "").slice(0, 200)],
      }));
      return {
        overallSummaryLines: ["Unable to generate AI summary."],
        summaries: rawSummaries,
      };
    }
    console.error("[ai:summarizeItems] Error summarizing items", err);
    return { overallSummaryLines: [], summaries: [] };
  }
}

export async function summarizeChatAnswerFromWebItems(
  items: WebItemSummary[],
  query?: string,
  providerOverride?: "gemini" | "groq"
): Promise<string> {
  const trimmedItems = Array.isArray(items) ? items.slice(0, 4) : [];
  if (!trimmedItems.length) return "";

  const hasGroqKey = Boolean(process.env.GROQ_API_KEY || process.env.OPEN_AI_API_KEY);
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  const provider = (providerOverride || process.env.AI_PROVIDER || (hasGroqKey ? "groq" : "gemini")).toLowerCase();

  if (!(hasGroqKey || hasGeminiKey)) {
    return "";
  }

  const trimmedQuery = (query ?? "").toString().trim();
  const isShortEntityQuery =
    trimmedQuery.length > 0 &&
    trimmedQuery.split(/\s+/).length <= 3 &&
    !/[?.!]/.test(trimmedQuery);
  const sourcePayload = trimmedItems.map((item, idx) => ({
    index: idx + 1,
    title: item.title,
    link: item.link,
    notes: (item.summaryLines || []).filter(Boolean).join(" ") || item.snippet || "",
  }));

  try {
    const basePrompt =
      `You are answering the user query: "${trimmedQuery || "N/A"}". ` +
      "Use only the provided sources. Respond in a way that directly satisfies the user's request. " +
      "Write a relatively rich answer: aim for 2–3 short paragraphs (roughly 6–10 sentences total). ";

    const stylePrompt = isShortEntityQuery
      ? "Treat this as a request for an encyclopedic-style explanation of the main concept. " +
        "Focus on what it is, key properties, and how it is usually understood. " +
        "Avoid centering one-off news stories, legal cases, or narrow edge examples unless the user explicitly asked for them. "
      : "Adapt the tone and structure to the user's request, but still favor clear, factual explanations over sensational examples. ";

    const linkPrompt =
      "When you reference a source, use standard Markdown link syntax with a human label, " +
      'for example [Atom Ctrl](https://example.com) "Atom Ctrl". ' +
      "Prefer the source title as the label. Do not paste bare URLs. " +
      "Try to use at least four distinct sources when that many are available. " +
      "Weave links naturally into sentences instead of listing them separately, and do not use [1]-style numeric citations. ";

    const prompt =
      basePrompt + stylePrompt + linkPrompt + `Sources: ${JSON.stringify(sourcePayload)}`;

    const resp =
      provider === "groq" && hasGroqKey
        ? await GroqClient.getInstance().generateContent("openai/gpt-oss-20b", prompt, {
            systemInstruction: { parts: [{ text: CLOUDY_SUMMARY_SYSTEM_PROMPT }] },
          })
        : await GeminiClient.getInstance().generateContent("gemini-2.5-flash", prompt);

    return (resp?.text || "").trim();
  } catch (err) {
    const errMsg = String((err as Error)?.message || err);
    if (errMsg.includes("image input") || errMsg.includes("clipboard")) {
      console.warn("[ai:summarizeChatAnswerFromWebItems] Model doesn't support image input");
      return "I couldn't generate a summary for these results. The search results are displayed below.";
    }
    console.error("[ai:summarizeChatAnswerFromWebItems] Error summarizing chat answer", err);
    return "";
  }
}

type ShoppingItemSummary = {
  title: string;
  priceText?: string;
  price?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  source?: string;
};

export async function summarizeChatAnswerFromShoppingItems(
  items: ShoppingItemSummary[],
  query?: string,
  providerOverride?: "gemini" | "groq"
): Promise<string> {
  const trimmedItems = Array.isArray(items) ? items.slice(0, 4) : [];
  if (!trimmedItems.length) return "";

  const hasGroqKey = Boolean(process.env.GROQ_API_KEY || process.env.OPEN_AI_API_KEY);
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  const provider = (providerOverride || process.env.AI_PROVIDER || (hasGroqKey ? "groq" : "gemini")).toLowerCase();

  if (!(hasGroqKey || hasGeminiKey)) {
    return "";
  }

  const trimmedQuery = (query ?? "").toString().trim();
  const sourcePayload = trimmedItems.map((item, idx) => ({
    index: idx + 1,
    title: item.title,
    priceText: item.priceText,
    price: item.price,
    rating: item.rating,
    reviewCount: item.reviewCount,
    source: item.source,
  }));

  try {
    const prompt =
      `You are answering the user's shopping request: "${trimmedQuery || "N/A"}". ` +
      "You are given up to 4 products with titles, prices, ratings, review counts, and sources. " +
      "Use ONLY these products to answer. " +
      "Assume the product cards are already visible to the user. " +
      "Your job is to recommend which of these specific products are best for the user and why, " +
      "and to directly answer their question or goal. " +
      "Write your answer in Markdown as a short bullet list, one bullet per product you actually recommend. " +
      "For each bullet, use this structure exactly: - **Product name** – price; rating★ from reviewCount reviews; one very short plain-English comment. " +
      "Always include clear spaces between numbers and words (for example: 4.7★ from 22,000 reviews; comfy, stretchy black trousers for everyday wear). " +
      "Do not remove spaces between words, do not jam numbers and words together, and do not emit any JSON. " +
      "After the bullets, you may add one short sentence explaining which option is best overall. " +
      `Products: ${JSON.stringify(sourcePayload)}`;

    const resp =
      provider === "groq" && hasGroqKey
        ? await GroqClient.getInstance().generateContent("openai/gpt-oss-20b", prompt)
        : await GeminiClient.getInstance().generateContent("gemini-2.5-flash", prompt);

    return (resp?.text || "").trim();
  } catch (err) {
    const errMsg = String((err as Error)?.message || err);
    if (errMsg.includes("image input") || errMsg.includes("clipboard")) {
      console.warn("[ai:summarizeChatAnswerFromShoppingItems] Model doesn't support image input");
      return "";
    }
    console.error("[ai:summarizeChatAnswerFromShoppingItems] Error summarizing shopping answer", err);
    return "";
  }
}
