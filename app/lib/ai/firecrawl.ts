import { GroqClient } from "@/app/lib/ai/groq/groq-client";
import { GeminiClient } from "@/app/lib/ai/gemini-client";
import { DETECT_INTENT_SYSTEM_PROMPT } from "@/app/lib/ai/system-prompts";

export type ScrapedUrlSummary = {
  url: string;
  title?: string;
  summary: string;
};

export type ScrapeUrlsResult = {
  items: ScrapedUrlSummary[];
  answer?: string;
};

function normalizeHttpUrl(value: string): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return null;

  const withProto = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(withProto);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function isBlockedHostname(hostname: string) {
  const h = hostname.toLowerCase();
  if (!h) return true;
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (h === "127.0.0.1" || h === "0.0.0.0") return true;
  if (h === "::1") return true;
  return false;
}

function truncateText(value: string, maxChars: number) {
  const raw = String(value ?? "");
  if (raw.length <= maxChars) return raw;
  return raw.slice(0, maxChars);
}

async function firecrawlScrapeMarkdown(url: string): Promise<{ markdown: string; title?: string } | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) return null;

  const normalized = normalizeHttpUrl(url);
  if (!normalized) return null;

  const u = new URL(normalized);
  if (isBlockedHostname(u.hostname)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url: normalized,
        formats: ["markdown"],
      }),
      signal: controller.signal,
    });

    if (!res.ok) return null;
    const json: any = await res.json();
    if (!json || json.success !== true || !json.data) return null;

    const markdown = typeof json.data.markdown === "string" ? json.data.markdown : "";
    const title =
      typeof json.data.metadata?.title === "string" ? json.data.metadata.title : undefined;

    if (!markdown.trim()) return null;
    return { markdown, title };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function summarizeScrapedMarkdown(params: {
  url: string;
  title?: string;
  markdown: string;
  query: string;
  providerOverride?: "gemini" | "groq";
}): Promise<string> {
  const hasGroqKey = Boolean(process.env.GROQ_API_KEY || process.env.OPEN_AI_API_KEY);
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  const provider = (params.providerOverride || process.env.AI_PROVIDER || (hasGroqKey ? "groq" : "gemini")).toLowerCase();

  const excerpt = truncateText(params.markdown.replace(/\s+/g, " ").trim(), 8000);
  if (!excerpt) {
    return "I couldn’t extract enough readable content from this page.";
  }

  const prompt =
    "You are summarizing one scraped web page for the user's query.\n" +
    `User query: ${JSON.stringify(params.query)}\n` +
    `URL: ${JSON.stringify(params.url)}\n` +
    `Title: ${JSON.stringify(params.title ?? "")}\n` +
    "\n" +
    "Rules:\n" +
    "- Use only the provided page content.\n" +
    "- If the page content does not contain what the user needs, say that plainly.\n" +
    "- Output 2–4 short sentences. Keep it direct.\n" +
    "\n" +
    `Page content (excerpt): ${JSON.stringify(excerpt)}\n`;

  const systemInstruction = {
    parts: [
      {
        text:
          DETECT_INTENT_SYSTEM_PROMPT +
          "\n\nThis request is for summarizing scraped page content. Do not invent facts.",
      },
    ],
  };

  try {
    const resp =
      provider === "groq" && hasGroqKey
        ? await GroqClient.getInstance().generateContent("openai/gpt-oss-20b", prompt, { systemInstruction })
        : hasGeminiKey
          ? await GeminiClient.getInstance().generateContent("gemini-2.5-flash", prompt)
          : null;
    const text = (resp?.text || "").trim();
    return text || "I couldn’t extract enough readable content from this page.";
  } catch {
    return "I couldn’t extract enough readable content from this page.";
  }
}

async function answerFromScrapedPages(params: {
  pages: { url: string; title?: string; markdown: string }[];
  query: string;
  providerOverride?: "gemini" | "groq";
}): Promise<string> {
  const hasGroqKey = Boolean(process.env.GROQ_API_KEY || process.env.OPEN_AI_API_KEY);
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  const provider = (
    params.providerOverride ||
    process.env.AI_PROVIDER ||
    (hasGroqKey ? "groq" : "gemini")
  ).toLowerCase();

  const packedPages = params.pages
    .map((p, idx) => {
      const excerpt = truncateText(p.markdown.replace(/\s+/g, " ").trim(), 12000);
      return (
        `SOURCE ${idx + 1}\n` +
        `URL: ${p.url}\n` +
        `TITLE: ${p.title ?? ""}\n` +
        `CONTENT: ${excerpt}\n`
      );
    })
    .join("\n---\n");

  const prompt =
    "You are answering the user's request using ONLY the scraped page content below.\n" +
    `User request: ${JSON.stringify(params.query)}\n` +
    "\n" +
    "Rules:\n" +
    "- Use only the provided sources.\n" +
    "- If the sources do not contain the needed information, say what is missing and ask for clarification.\n" +
    "- Be complete and helpful (not a tiny summary).\n" +
    "- Keep formatting clean, minimal, and readable.\n" +
    "\n" +
    `${packedPages}\n`;

  const systemInstruction = {
    parts: [
      {
        text:
          DETECT_INTENT_SYSTEM_PROMPT +
          "\n\nThis request is for answering from scraped page content. Do not invent facts.",
      },
    ],
  };

  try {
    const resp =
      provider === "groq" && hasGroqKey
        ? await GroqClient.getInstance().generateContent("openai/gpt-oss-20b", prompt, {
            systemInstruction,
          })
        : hasGeminiKey
          ? await GeminiClient.getInstance().generateContent("gemini-2.5-flash", prompt)
          : null;
    return (resp?.text || "").trim();
  } catch {
    return "";
  }
}

export async function scrapeUrls(params: {
  urls: string[];
  query: string;
  mode: "summary" | "answer";
  providerOverride?: "gemini" | "groq";
}): Promise<ScrapeUrlsResult> {
  const normalizedUrls = (Array.isArray(params.urls) ? params.urls : [])
    .map((u) => normalizeHttpUrl(u))
    .filter(Boolean) as string[];

  const unique = Array.from(new Set(normalizedUrls)).slice(0, 2);
  if (!unique.length) return { items: [] };

  const pages = await Promise.all(
    unique.map(async (url) => {
      const doc = await firecrawlScrapeMarkdown(url);
      if (!doc) return null;
      return { url, title: doc.title, markdown: doc.markdown };
    })
  );

  const validPages = pages.filter(Boolean) as { url: string; title?: string; markdown: string }[];

  const items = (
    await Promise.all(
      validPages.map(async (p) => {
        const summary = await summarizeScrapedMarkdown({
          url: p.url,
          title: p.title,
          markdown: p.markdown,
          query: params.query,
          providerOverride: params.providerOverride,
        });
        return { url: p.url, title: p.title, summary } satisfies ScrapedUrlSummary;
      })
    )
  ).filter(Boolean) as ScrapedUrlSummary[];

  if (params.mode === "answer") {
    const answer = await answerFromScrapedPages({
      pages: validPages,
      query: params.query,
      providerOverride: params.providerOverride,
    });
    return { items, answer: answer || undefined };
  }

  return { items };
}
