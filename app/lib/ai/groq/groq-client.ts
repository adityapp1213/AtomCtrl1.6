import Groq from "groq-sdk";

type SystemInstruction = {
  parts: Array<{ text: string }>;
};

export type ToolCall = {
  name: string;
  args: unknown;
};

export type GroqTool = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: unknown;
  };
};

export type GroqGenerateContentOptions = {
  tools?: GroqTool[];
  systemInstruction?: SystemInstruction;
};

export type GroqGenerateContentResult = {
  text?: string;
  functionCalls?: ToolCall[];
};

const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 750;

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function inferRetryDelayMs(err: unknown, fallbackMs: number) {
  const anyErr = err as unknown as { message?: string; status?: number; retryAfter?: number };
  if (typeof anyErr?.retryAfter === "number") {
    return Math.max(0, anyErr.retryAfter) * 1000;
  }

  const msg = String(anyErr?.message ?? "");
  const m = msg.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (m?.[1]) {
    const seconds = Number(m[1]);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  }

  return fallbackMs;
}

export class GroqClient {
  private static instance: GroqClient;
  private apiKeys: string[];

  private constructor() {
    const keys = [process.env.GROQ_API_KEY, process.env.OPEN_AI_API_KEY].filter(Boolean) as string[];
    this.apiKeys = [...new Set(keys.map((k) => k.trim()))].filter((k) => k.length > 0);

    if (this.apiKeys.length === 0) {
      console.warn("[GroqClient] Missing GROQ_API_KEY/OPEN_AI_API_KEY");
    }
  }

  public static getInstance(): GroqClient {
    if (!GroqClient.instance) {
      GroqClient.instance = new GroqClient();
    }
    return GroqClient.instance;
  }

  private getClient(apiKey: string) {
    return new Groq({ apiKey });
  }

  public async generateContent(
    model: string,
    userText: string,
    options: GroqGenerateContentOptions = {}
  ): Promise<GroqGenerateContentResult> {
    const systemText = Array.isArray(options.systemInstruction?.parts)
      ? options.systemInstruction!.parts.map((p) => p.text).filter(Boolean).join("\n")
      : "";

    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (systemText) messages.push({ role: "system", content: systemText });
    messages.push({ role: "user", content: userText });

    let lastError: unknown = null;

    for (const key of this.apiKeys) {
      const client = this.getClient(key);

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const completion = await client.chat.completions.create({
            model,
            messages,
            tools: (options.tools as unknown as any) ?? undefined,
            tool_choice: options.tools?.length ? ("auto" as any) : undefined,
            temperature: 0.5,
            top_p: 1,
            max_tokens: 1024,
            stop: null,
          });

          const msg = completion.choices?.[0]?.message;
          const text = msg?.content ?? "";

          const functionCalls: ToolCall[] = [];
          const toolCalls = (msg as unknown as { tool_calls?: Array<{ function?: { name?: string; arguments?: string } }> })
            ?.tool_calls;

          if (Array.isArray(toolCalls)) {
            for (const tc of toolCalls) {
              const name = tc?.function?.name;
              if (!name) continue;
              const argsRaw = tc?.function?.arguments ?? "{}";
              functionCalls.push({ name, args: safeJsonParse(argsRaw) });
            }
          }

          return { text, functionCalls };
        } catch (err) {
          lastError = err;
          const anyErr = err as unknown as { status?: number; message?: string };
          const status = anyErr?.status;
          const message = String(anyErr?.message ?? "");
          const lower = message.toLowerCase();

          const retryable =
            status === 429 ||
            status === 503 ||
            lower.includes("timeout") ||
            lower.includes("temporarily unavailable") ||
            lower.includes("rate limit");

          if (retryable && attempt < MAX_RETRIES) {
            const delay = inferRetryDelayMs(err, INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1));
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          break;
        }
      }
    }

    throw lastError || new Error("[GroqClient] All API keys failed");
  }

  public async *streamContent(
    model: string,
    userText: string,
    options: GroqGenerateContentOptions = {}
  ): AsyncGenerator<string, void, unknown> {
    const systemText = Array.isArray(options.systemInstruction?.parts)
      ? options.systemInstruction!.parts.map((p) => p.text).filter(Boolean).join("\n")
      : "";

    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (systemText) messages.push({ role: "system", content: systemText });
    messages.push({ role: "user", content: userText });

    let lastError: unknown = null;

    for (const key of this.apiKeys) {
      const client = this.getClient(key);
      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const stream = await client.chat.completions.create({
            model,
            messages,
            tools: (options.tools as unknown as any) ?? undefined,
            tool_choice: options.tools?.length ? ("auto" as any) : undefined,
            temperature: 0.5,
            top_p: 1,
            max_tokens: 1024,
            stop: null,
            stream: true,
          });

          for await (const chunk of stream as AsyncIterable<{
            choices?: Array<{ delta?: { content?: string } }>;
          }>) {
            const delta = chunk?.choices?.[0]?.delta?.content ?? "";
            if (delta) yield delta;
          }
          return;
        } catch (err) {
          lastError = err;
          const anyErr = err as unknown as { status?: number; message?: string };
          const status = anyErr?.status;
          const message = String(anyErr?.message ?? "");
          const lower = message.toLowerCase();

          const retryable =
            status === 429 ||
            status === 503 ||
            lower.includes("timeout") ||
            lower.includes("temporarily unavailable") ||
            lower.includes("rate limit");

          if (retryable && attempt < MAX_RETRIES) {
            const delay = inferRetryDelayMs(err, INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1));
            await new Promise((r) => setTimeout(r, delay));
            continue;
          }

          break;
        }
      }
    }

    throw lastError || new Error("[GroqClient] All API keys failed");
  }
}
