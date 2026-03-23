import { GroqClient } from "@/app/lib/ai/groq/groq-client";
import { IDENTITY_GUARD } from "@/app/lib/ai/identity";

function buildSourcePayload(payload: any): string {
  const rawItems = Array.isArray(payload?.webItems) ? payload.webItems : [];
  const rawScraped = Array.isArray(payload?.scrapedItems) ? payload.scrapedItems : [];
  const rawYoutube = Array.isArray(payload?.youtubeItems) ? payload.youtubeItems : [];
  const rawShopping = Array.isArray(payload?.shoppingItems) ? payload.shoppingItems : [];
  const rawWeather = Array.isArray(payload?.weatherItems) ? payload.weatherItems : [];
  
  const trimmedItems = rawItems.slice(0, 8);
  const trimmedScraped = rawScraped.slice(0, 4);
  const trimmedYoutube = rawYoutube.slice(0, 4);
  const trimmedShopping = rawShopping.slice(0, 4);
  const trimmedWeather = rawWeather.slice(0, 2);

  const sourcePayload: string[] = [];

  for (let i = 0; i < trimmedItems.length; i++) {
    const item = trimmedItems[i];
    sourcePayload.push(JSON.stringify({
      index: i + 1,
      title: String(item.title ?? ""),
      link: String(item.link ?? ""),
      notes: (item.summaryLines || []).filter(Boolean).join(" ") || String(item.snippet ?? ""),
      kind: "web",
    }));
  }
  
  for (let i = 0; i < trimmedScraped.length; i++) {
    const item = trimmedScraped[i];
    sourcePayload.push(JSON.stringify({
      index: trimmedItems.length + i + 1,
      title: String(item.title ?? ""),
      link: String(item.url ?? ""),
      notes: String(item.summary ?? ""),
      kind: "scraped",
    }));
  }
  
  for (let i = 0; i < trimmedYoutube.length; i++) {
    const item = trimmedYoutube[i];
    sourcePayload.push(JSON.stringify({
      index: trimmedItems.length + trimmedScraped.length + i + 1,
      title: String(item.title ?? ""),
      link: item.id ? `https://www.youtube.com/watch?v=${String(item.id)}` : "",
      notes: `${String(item.channelTitle ?? "")} ${String(item.description ?? "")}`.trim(),
      kind: "youtube",
    }));
  }
  
  for (let i = 0; i < trimmedShopping.length; i++) {
    const item = trimmedShopping[i];
    sourcePayload.push(JSON.stringify({
      index: trimmedItems.length + trimmedScraped.length + trimmedYoutube.length + i + 1,
      title: String(item.title ?? ""),
      link: String(item.link ?? ""),
      notes: [
        String(item.priceText ?? ""),
        item.rating != null ? `rating ${item.rating}` : "",
        item.reviewCount != null ? `${item.reviewCount} reviews` : "",
      ].filter(Boolean).join(", "),
      kind: "shopping",
    }));
  }
  
  for (let i = 0; i < trimmedWeather.length; i++) {
    const item = trimmedWeather[i];
    sourcePayload.push(JSON.stringify({
      index: trimmedItems.length + trimmedScraped.length + trimmedYoutube.length + trimmedShopping.length + i + 1,
      title: String(item.city ?? ""),
      link: "https://openweathermap.org/",
      notes: item.data
        ? `${item.data.city}: ${item.data.temperature}°C, ${item.data.weatherType} (${item.data.dateTime})`
        : String(item.error ?? ""),
      kind: "weather",
    }));
  }

  return sourcePayload.join("\n");
}

function buildPrompt(query: string, sourcePayload: string): string {
  return `User question: ${JSON.stringify(query)}\n` +
    "Use only the provided sources.\n" +
    "Answer the user's question directly and stay tightly on-topic.\n" +
    "If a specific number/fact is not present in the sources, say that plainly.\n" +
    "Keep it one paragraph and reasonably concise (about 5–8 sentences).\n" +
    "Cite sources inline by embedding the full URL from the source directly in the sentence.\n" +
    "Do not use brackets like [1] or numbered citations.\n" +
    "Do not add headings, bullets, or special characters.\n" +
    `Sources: ${sourcePayload}`;
}

export async function POST(req: Request) {
  let payload: any = null;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }

  const query = String(payload?.searchQuery ?? "").trim();
  const rawItems = Array.isArray(payload?.webItems) ? payload.webItems : [];
  const rawScraped = Array.isArray(payload?.scrapedItems) ? payload.scrapedItems : [];
  const rawYoutube = Array.isArray(payload?.youtubeItems) ? payload.youtubeItems : [];
  const rawShopping = Array.isArray(payload?.shoppingItems) ? payload.shoppingItems : [];
  const rawWeather = Array.isArray(payload?.weatherItems) ? payload.weatherItems : [];

  const hasData = rawItems.length > 0 || rawScraped.length > 0 || 
                  rawYoutube.length > 0 || rawShopping.length > 0 || rawWeather.length > 0;
  
  if (!query || !hasData) {
    return new Response("", { status: 200 });
  }

  const sourcePayload = buildSourcePayload(payload);
  const prompt = buildPrompt(query, sourcePayload);

  const hasGroqKey = Boolean(process.env.GROQ_API_KEY || process.env.OPEN_AI_API_KEY);

  if (!hasGroqKey) {
    return new Response("", { status: 200 });
  }

  const systemPrompt = IDENTITY_GUARD +
    "\n\nUse only the provided sources.\n" +
    "Answer the user's question directly and stay tightly on-topic.\n" +
    "If a specific number/fact is not present in the sources, say that plainly.\n" +
    "Keep it one paragraph and reasonably concise (about 5–8 sentences).\n" +
    "Cite sources inline by embedding the full URL from the source directly in the sentence.\n" +
    "Do not use brackets like [1] or numbered citations.\n" +
    "Do not add headings, bullets, or special characters.";

  const groqStream = GroqClient.getInstance().streamContent("openai/gpt-oss-20b", prompt, {
    systemInstruction: { parts: [{ text: systemPrompt }] },
  });
  return new Response(groqStream as unknown as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
