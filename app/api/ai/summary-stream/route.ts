import { cookies } from "next/headers";
import { GroqClient } from "@/app/lib/ai/groq/groq-client";
import { GeminiClient } from "@/app/lib/ai/gemini-client";

type WebItem = {
  link?: string;
  title?: string;
  summaryLines?: string[];
  snippet?: string;
};

type ScrapedItem = {
  url?: string;
  title?: string;
  summary?: string;
};

type YouTubeItem = {
  id?: string;
  title?: string;
  description?: string;
  channelTitle?: string;
};

type ShoppingItem = {
  title?: string;
  link?: string;
  priceText?: string;
  rating?: number | null;
  reviewCount?: number | null;
};

type WeatherItem = {
  city?: string;
  data?: {
    city: string;
    temperature: number;
    weatherType: string;
    dateTime: string;
    isDay: boolean;
  } | null;
  error?: string | null;
};

async function* chunkText(text: string) {
  const parts = text.split(/(\s+)/);
  for (const part of parts) {
    if (!part) continue;
    yield part;
  }
}

async function* streamGemini(prompt: string) {
  try {
    const stream = GeminiClient.getInstance().streamContent("gemini-2.5-flash", prompt);
    for await (const chunk of stream) {
      if (chunk) yield chunk;
    }
    return;
  } catch {
    const resp = await GeminiClient.getInstance().generateContent("gemini-2.5-flash", prompt);
    const text = (resp as any)?.text ?? "";
    for await (const chunk of chunkText(String(text || ""))) {
      if (chunk) yield chunk;
    }
  }
}

async function* streamGroq(prompt: string) {
  try {
    const stream = GroqClient.getInstance().streamContent("openai/gpt-oss-20b", prompt);
    for await (const chunk of stream) {
      if (chunk) yield chunk;
    }
    return;
  } catch {
    const resp = await GroqClient.getInstance().generateContent("openai/gpt-oss-20b", prompt);
    const text = (resp as any)?.text ?? "";
    for await (const chunk of chunkText(String(text || ""))) {
      if (chunk) yield chunk;
    }
  }
}

async function* coerceToAsyncIterable(value: unknown) {
  const anyValue = value as any;
  if (anyValue && typeof anyValue[Symbol.asyncIterator] === "function") {
    for await (const chunk of anyValue as AsyncIterable<any>) {
      yield chunk;
    }
    return;
  }

  if (anyValue && typeof anyValue.getReader === "function") {
    const reader = anyValue.getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) yield value;
      }
    } finally {
      try {
        reader.releaseLock?.();
      } catch {
      }
    }
  }
}

export async function POST(req: Request) {
  let payload: any = null;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }

  const query = String(payload?.searchQuery ?? "").trim();
  const rawItems = Array.isArray(payload?.webItems) ? (payload.webItems as WebItem[]) : [];
  const rawScraped = Array.isArray(payload?.scrapedItems)
    ? (payload.scrapedItems as ScrapedItem[])
    : [];
  const rawYoutube = Array.isArray(payload?.youtubeItems)
    ? (payload.youtubeItems as YouTubeItem[])
    : [];
  const rawShopping = Array.isArray(payload?.shoppingItems)
    ? (payload.shoppingItems as ShoppingItem[])
    : [];
  const rawWeather = Array.isArray(payload?.weatherItems)
    ? (payload.weatherItems as WeatherItem[])
    : [];
  const trimmedItems = rawItems.slice(0, 8);
  const trimmedScraped = rawScraped.slice(0, 4);
  const trimmedYoutube = rawYoutube.slice(0, 4);
  const trimmedShopping = rawShopping.slice(0, 4);
  const trimmedWeather = rawWeather.slice(0, 2);

  if (
    !query ||
    (trimmedItems.length === 0 &&
      trimmedScraped.length === 0 &&
      trimmedYoutube.length === 0 &&
      trimmedShopping.length === 0 &&
      trimmedWeather.length === 0)
  ) {
    return new Response("", { status: 200 });
  }

  const sourcePayload = [
    ...trimmedItems.map((item, idx) => ({
      index: idx + 1,
      title: String(item.title ?? ""),
      link: String(item.link ?? ""),
      notes:
        (item.summaryLines || []).filter(Boolean).join(" ") ||
        String(item.snippet ?? ""),
      kind: "web",
    })),
    ...trimmedScraped.map((item, idx) => ({
      index: trimmedItems.length + idx + 1,
      title: String(item.title ?? ""),
      link: String(item.url ?? ""),
      notes: String(item.summary ?? ""),
      kind: "scraped",
    })),
    ...trimmedYoutube.map((item, idx) => ({
      index: trimmedItems.length + trimmedScraped.length + idx + 1,
      title: String(item.title ?? ""),
      link: item.id ? `https://www.youtube.com/watch?v=${String(item.id)}` : "",
      notes: `${String(item.channelTitle ?? "")} ${String(item.description ?? "")}`.trim(),
      kind: "youtube",
    })),
    ...trimmedShopping.map((item, idx) => ({
      index: trimmedItems.length + trimmedScraped.length + trimmedYoutube.length + idx + 1,
      title: String(item.title ?? ""),
      link: String(item.link ?? ""),
      notes: [
        String(item.priceText ?? ""),
        item.rating != null ? `rating ${item.rating}` : "",
        item.reviewCount != null ? `${item.reviewCount} reviews` : "",
      ]
        .filter(Boolean)
        .join(", "),
      kind: "shopping",
    })),
    ...trimmedWeather.map((item, idx) => ({
      index:
        trimmedItems.length +
        trimmedScraped.length +
        trimmedYoutube.length +
        trimmedShopping.length +
        idx +
        1,
      title: String(item.city ?? ""),
      link: "https://openweathermap.org/",
      notes: item.data
        ? `${item.data.city}: ${item.data.temperature}°C, ${item.data.weatherType} (${item.data.dateTime})`
        : String(item.error ?? ""),
      kind: "weather",
    })),
  ].filter((s) => Boolean(s.link));

  const prompt =
    `User question: ${JSON.stringify(query)}\n` +
    "Use only the provided sources.\n" +
    "Answer the user's question directly and stay tightly on-topic.\n" +
    "If a specific number/fact is not present in the sources, say that plainly.\n" +
    "Keep it one paragraph and reasonably concise (about 5–8 sentences).\n" +
    "Cite sources inline by embedding the full URL from the source directly in the sentence.\n" +
    "Do not use brackets like [1] or numbered citations.\n" +
    "Do not add headings, bullets, or special characters.\n" +
    `Sources: ${JSON.stringify(sourcePayload)}`;

  const hasGroqKey = Boolean(process.env.GROQ_API_KEY || process.env.OPEN_AI_API_KEY);
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  const jar = await cookies();
  const aiProvider = jar.get("ai_provider")?.value === "gemini" ? "gemini" : "groq";

  let stream: AsyncIterable<string> | null = null;

  if (aiProvider === "groq" && hasGroqKey) {
    stream = streamGroq(prompt);
  } else if (hasGeminiKey) {
    stream = streamGemini(prompt);
  }

  if (!stream) {
    return new Response("", { status: 200 });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      let closed = false;
      const decoder = new TextDecoder();
      const closeOnce = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
        }
      };

      (async () => {
        try {
          for await (const rawChunk of coerceToAsyncIterable(stream)) {
            if (req.signal.aborted) break;
            const chunk =
              typeof rawChunk === "string"
                ? rawChunk
                : rawChunk instanceof Uint8Array
                ? decoder.decode(rawChunk, { stream: true })
                : String(rawChunk ?? "");
            if (!chunk) continue;
            controller.enqueue(encoder.encode(chunk));
          }
        } catch {
        } finally {
          closeOnce();
        }
      })();
    },
    cancel() {
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
