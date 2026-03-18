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

function safeJsonParse(s: string | Record<string, unknown>): Record<string, unknown> {
  if (typeof s === "object" && s !== null) {
    return s as Record<string, unknown>;
  }
  try {
    return JSON.parse(s as string);
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
  const mWithMinutes = msg.match(/retry in\s+(\d+)m(\d+(?:\.\d+)?)s/i);
  if (mWithMinutes?.[1] && mWithMinutes?.[2]) {
    const minutes = Number(mWithMinutes[1]);
    const seconds = Number(mWithMinutes[2]);
    if (
      Number.isFinite(minutes) &&
      minutes >= 0 &&
      Number.isFinite(seconds) &&
      seconds >= 0
    ) {
      const totalSeconds = minutes * 60 + seconds;
      return Math.ceil(totalSeconds * 1000);
    }
  }

  const mSecondsOnly = msg.match(/retry in\s+(\d+(?:\.\d+)?)s/i);
  if (mSecondsOnly?.[1]) {
    const seconds = Number(mSecondsOnly[1]);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1000);
  }

  return fallbackMs;
}

export class GroqClient {
  private static instance: GroqClient;
  private apiKeys: string[];
  private rateLimitedUntilMs: number | null;

  private constructor() {
    const keys = [process.env.GROQ_API_KEY, process.env.OPEN_AI_API_KEY].filter(Boolean) as string[];
    this.apiKeys = [...new Set(keys.map((k) => k.trim()))].filter((k) => k.length > 0);
    this.rateLimitedUntilMs = null;

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

    if (this.rateLimitedUntilMs && Date.now() < this.rateLimitedUntilMs) {
      const remainingMs = this.rateLimitedUntilMs - Date.now();
      const seconds = Math.max(1, Math.ceil(remainingMs / 1000));
      throw new Error(
        `[GroqClient] Rate limit in effect; please try again in ${seconds}s`
      );
    }

    const hasTools = options.tools && options.tools.length > 0;

    for (const key of this.apiKeys) {
      const client = this.getClient(key);

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const completion = await client.chat.completions.create({
            model,
            messages,
            tools: hasTools ? (options.tools as unknown as any) : undefined,
            temperature: 0.5,
            top_p: 1,
            max_tokens: 2048,
            stop: null,
          });

          const functionCalls: ToolCall[] = [];
          const msg = completion.choices?.[0]?.message;
          const toolCalls = (msg as unknown as { tool_calls?: Array<{ function?: { name?: string; arguments?: string | Record<string, unknown> } }> })
            ?.tool_calls;

          if (Array.isArray(toolCalls)) {
            for (const tc of toolCalls) {
              const name = tc?.function?.name;
              if (!name) continue;
              const argsRaw = tc?.function?.arguments;
              let parsedArgs: unknown = {};
              if (typeof argsRaw === "string") {
                parsedArgs = safeJsonParse(argsRaw);
              } else if (typeof argsRaw === "object" && argsRaw !== null) {
                parsedArgs = argsRaw;
              }
              functionCalls.push({ name, args: parsedArgs });
            }
          }

          const rawContent = (msg as unknown as { content?: unknown })?.content;
          let text = "";
          if (typeof rawContent === "string") {
            text = rawContent;
          } else if (Array.isArray(rawContent)) {
            text = rawContent
              .map((part: any) => {
                if (typeof part?.text === "string") return part.text;
                return "";
              })
              .join("");
          } else if (rawContent != null) {
            text = String(rawContent);
          }

          const hasFunctionCalls = Array.isArray(toolCalls) && toolCalls.length > 0;

          if (!String(text || "").trim() && !hasFunctionCalls) {
            console.error("[GroqClient] Empty completion content", {
              model,
              hasToolCalls: false,
            });
            throw new Error("[GroqClient] Model returned empty content");
          }

          // Check for tool call parsing errors in the response
          const finishReason = (msg as unknown as { finish_reason?: string })?.finish_reason;
          if (finishReason === "invalid_tool_calls" || finishReason === "tool_use_failed") {
            const err = new Error(`[GroqClient] Model failed to generate valid tool calls: ${finishReason}`);
            (err as any).isToolParseError = true;
            throw err;
          }

          return { text, functionCalls };
        } catch (err) {
          lastError = err;
          const anyErr = err as unknown as {
            status?: number;
            message?: string;
            response?: { status?: number; data?: unknown };
          };
          const status = anyErr?.status ?? anyErr?.response?.status;
          const message = String(anyErr?.message ?? "");
          const lower = message.toLowerCase();

          let errorPayload: any =
            (anyErr as any)?.response?.data && typeof (anyErr as any).response?.data === "object"
              ? (anyErr as any).response?.data
              : undefined;
          if (!errorPayload && message.trim().startsWith("{")) {
            errorPayload = safeJsonParse(message);
          }

          const errorCode =
            errorPayload?.error?.code ?? errorPayload?.code ?? null;
          const errorMessage =
            errorPayload?.error?.message ??
            errorPayload?.message ??
            message;

          const isDailyRateLimit =
            errorCode === "rate_limit_exceeded" &&
            /tokens per day/i.test(String(errorMessage || ""));

          let retryable =
            status === 429 ||
            status === 500 ||
            status === 502 ||
            status === 503 ||
            status === 504 ||
            lower.includes("timeout") ||
            lower.includes("fetch failed") ||
            lower.includes("network") ||
            lower.includes("socket hang up") ||
            lower.includes("econnreset") ||
            lower.includes("temporarily unavailable") ||
            lower.includes("rate limit");

          if (isDailyRateLimit) {
            retryable = false;
            const waitMs = inferRetryDelayMs(
              err,
              5 * 60 * 1000
            );
            this.rateLimitedUntilMs = Date.now() + waitMs;
          }

          if (retryable && attempt < MAX_RETRIES) {
            const delay = inferRetryDelayMs(
              err,
              INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1)
            );
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
            max_tokens: 2048,
            stop: null,
            stream: true,
          });

          for await (const chunk of stream as AsyncIterable<{
            choices?: Array<{ delta?: { content?: string | null } }>;
          }>) {
            const delta = chunk?.choices?.[0]?.delta?.content;
            if (delta != null && delta !== "") {
              yield delta;
            }
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
            status === 500 ||
            status === 502 ||
            status === 503 ||
            status === 504 ||
            lower.includes("timeout") ||
            lower.includes("fetch failed") ||
            lower.includes("network") ||
            lower.includes("socket hang up") ||
            lower.includes("econnreset") ||
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
