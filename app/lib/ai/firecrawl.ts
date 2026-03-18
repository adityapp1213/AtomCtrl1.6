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

async function firecrawlScrapeMarkdown(
  url: string,
  mode: "summary" | "answer" = "summary",
  query?: string
): Promise<{ markdown: string; title?: string; summary?: string; answer?: string } | null> {
  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    // Fallback: try to fetch the page directly and extract basic text
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; WebScraper/1.0)',
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) return null;
      const html = await response.text();
      // Extract title
      const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
      const title = titleMatch ? titleMatch[1].trim() : undefined;
      // Extract basic text content (very basic fallback)
      const textContent = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 2000);
      const content = textContent || "Unable to extract content from this page.";
      return {
        markdown: content,
        title,
        summary: mode === "summary" ? `Basic text extracted from ${url}` : undefined,
        answer: mode === "answer" && query ? `Based on the page content: ${content}` : undefined
      };
    } catch {
      return null;
    }
  }

  const normalized = normalizeHttpUrl(url);
  if (!normalized) return null;

  const u = new URL(normalized);
  if (isBlockedHostname(u.hostname)) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    let body: object;

    if (mode === "answer" && query) {
      body = {
        url: normalized,
        formats: [
          "markdown",
          { type: "json", prompt: `Answer this question using the page content: ${query}` }
        ]
      };
    } else {
      body = { url: normalized, formats: ["markdown", "summary"] };
    }

    const res = await fetch("https://api.firecrawl.dev/v2/scrape", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      // If Firecrawl fails, try basic fetch fallback
      try {
        const response = await fetch(normalized, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; WebScraper/1.0)',
          },
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) return null;
        const html = await response.text();
        const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        const title = titleMatch ? titleMatch[1].trim() : undefined;
        const textContent = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
          .replace(/<[^>]+>/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 2000);
        const content = textContent || "Unable to extract content from this page.";
        return {
          markdown: content,
          title,
          summary: mode === "summary" ? `Basic text extracted from ${url}` : undefined,
          answer: mode === "answer" && query ? `Based on the page content: ${content}` : undefined
        };
      } catch {
        return null;
      }
    }

    const json: any = await res.json();
    if (!json || json.success !== true || !json.data) return null;

    // Handle different response formats from Firecrawl
    let markdown = "";
    let summary = "";
    let answer = "";
    
    // Case 1: Standard markdown response
    if (typeof json.data.markdown === "string" && json.data.markdown.trim()) {
      markdown = json.data.markdown;
      summary = typeof json.data.summary === "string" ? json.data.summary : "";
    }
    
    // Case 2: JSON response - check both data.json and data.content
    const jsonData = json.data.json || json.data.content;
    if (jsonData && typeof jsonData === "object") {
      const parts: string[] = [];
      
      // Extract title from metadata if available
      const title = json.data.metadata?.title || jsonData.title;
      if (title) parts.push(`# ${title}`);
      
      // Handle description
      const description = jsonData.description || jsonData.summary;
      if (description) parts.push(description);
      
      // Handle keyPoints
      if (jsonData.keyPoints && Array.isArray(jsonData.keyPoints)) {
        parts.push("## Key Points");
        jsonData.keyPoints.forEach((point: string) => parts.push(`- ${point}`));
      }
      
      // Handle other content
      for (const [key, value] of Object.entries(jsonData)) {
        if (["title", "description", "summary", "keyPoints", "relatedLinks"].includes(key)) continue;
        if (typeof value === "string" && value.trim()) {
          parts.push(`**${key}**: ${value}`);
        } else if (Array.isArray(value) && value.length > 0) {
          parts.push(`**${key}**: ${value.join(", ")}`);
        }
      }
      
      // Handle related links
      if (jsonData.relatedLinks && Array.isArray(jsonData.relatedLinks)) {
        parts.push("## Related Links");
        jsonData.relatedLinks.forEach((link: string) => parts.push(`- ${link}`));
      }
      
      markdown = parts.join("\n\n") || markdown;
      summary = description || summary;
      answer = description || parts.join(" ");
    }
    
    // Case 3: Raw content field
    else if (typeof json.data.content === "string" && json.data.content.trim()) {
      markdown = json.data.content;
      summary = "";
    }

    const title = typeof json.data.metadata?.title === "string" ? json.data.metadata.title : undefined;

    if (mode === "answer" && query && answer) {
      return { markdown, title, summary, answer };
    }

    if (!markdown.trim()) return null;
    return { markdown, title, summary };
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
  const baseUrls = Array.isArray(params.urls) ? params.urls : [];

  let normalizedUrls = baseUrls
    .map((u) => normalizeHttpUrl(u))
    .filter(Boolean) as string[];

  if (!normalizedUrls.length && params.query) {
    const fromQuery = extractUrlsFromText(params.query);
    normalizedUrls = fromQuery
      .map((u) => normalizeHttpUrl(u))
      .filter(Boolean) as string[];
  }

  const unique = Array.from(new Set(normalizedUrls)).slice(0, 2);
  if (!unique.length) return { items: [] };

  const pages = await Promise.all(
    unique.map(async (url) => {
      const doc = await firecrawlScrapeMarkdown(url, params.mode, params.query);
      if (!doc) return null;
      return { url, title: doc.title, markdown: doc.markdown, summary: doc.summary, answer: doc.answer };
    })
  );

  const validPages = pages.filter(Boolean) as {
    url: string;
    title?: string;
    markdown: string;
    summary?: string;
    answer?: string;
  }[];

  let items: ScrapedUrlSummary[] = [];

  if (validPages.length > 0) {
    if (params.mode === "answer") {
      // For answer mode, if we got direct answers from Firecrawl, use them
      const directAnswers = validPages.filter(p => p.answer).map(p => p.answer!);
      if (directAnswers.length > 0) {
        return { items: [], answer: directAnswers.join("\n\n") };
      }
    }

    items = (
      await Promise.all(
        validPages.map(async (p) => {
          const summaryText = (p.summary || "").toString().trim();
          if (summaryText) {
            return { url: p.url, title: p.title, summary: summaryText } satisfies ScrapedUrlSummary;
          }
          const llmSummary = await summarizeScrapedMarkdown({
            url: p.url,
            title: p.title,
            markdown: p.markdown,
            query: params.query,
            providerOverride: params.providerOverride,
          });
          return { url: p.url, title: p.title, summary: llmSummary } satisfies ScrapedUrlSummary;
        })
      )
    ).filter(Boolean) as ScrapedUrlSummary[];
  } else if (unique.length > 0) {
    // If we had URLs to scrape but all failed, return an error message
    items = [{
      url: unique[0],
      title: "Scraping Error",
      summary: "Unable to scrape the requested URLs. The scraping service may be unavailable or the URLs may not be accessible."
    }];
  }

  if (params.mode === "answer") {
    const answer = validPages.length > 0 ? await answerFromScrapedPages({
      pages: validPages,
      query: params.query,
      providerOverride: params.providerOverride,
    }) : "I was unable to scrape the requested URLs to provide a detailed answer.";
    return { items, answer: answer || undefined };
  }

  return { items };
}
