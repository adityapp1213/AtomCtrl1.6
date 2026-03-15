import { cookies } from "next/headers";
import { GroqClient } from "@/app/lib/ai/groq/groq-client";
import { GeminiClient } from "@/app/lib/ai/gemini-client";

type WebItem = {
  link?: string;
  title?: string;
  summaryLines?: string[];
  snippet?: string;
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

export async function POST(req: Request) {
  let payload: any = null;
  try {
    payload = await req.json();
  } catch {
    payload = null;
  }

  const query = String(payload?.searchQuery ?? "").trim();
  const rawItems = Array.isArray(payload?.webItems) ? (payload.webItems as WebItem[]) : [];
  const trimmedItems = rawItems.slice(0, 3);

  if (!query || trimmedItems.length === 0) {
    return new Response("", { status: 200 });
  }

  const sourcePayload = trimmedItems.map((item, idx) => ({
    index: idx + 1,
    title: String(item.title ?? ""),
    link: String(item.link ?? ""),
    notes: (item.summaryLines || []).filter(Boolean).join(" ") || String(item.snippet ?? ""),
  }));

  const prompt =
    `You are answering the user query: "${query || "N/A"}". ` +
    "Use only the provided sources. Write a short response in 3–4 sentences (one paragraph). " +
    "Cite sources inline by embedding the full URL from the source directly in the sentence. " +
    "Do not use brackets like [1] or numbered citations. " +
    "Do not add headings, bullets, or special characters. " +
    `Sources: ${JSON.stringify(sourcePayload)}`;

  const hasGroqKey = Boolean(process.env.GROQ_API_KEY || process.env.OPEN_AI_API_KEY);
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  const jar = await cookies();
  const aiProvider = jar.get("ai_provider")?.value === "gemini" ? "gemini" : "groq";

  let stream: AsyncIterable<string> | null = null;

  if (aiProvider === "groq" && hasGroqKey) {
    stream = GroqClient.getInstance().streamContent("openai/gpt-oss-20b", prompt);
  } else if (hasGeminiKey) {
    stream = streamGemini(prompt);
  }

  if (!stream) {
    return new Response("", { status: 200 });
  }

  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of stream as AsyncIterable<string>) {
          if (chunk) controller.enqueue(encoder.encode(chunk));
        }
      } catch {
      } finally {
        controller.close();
      }
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
