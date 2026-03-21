import { DETECT_INTENT_SYSTEM_PROMPT } from "./system-prompts";
import { GroqClient, GroqTool } from "./groq/groq-client";

export async function generateSmallTalkReply(query: string): Promise<string> {
  const client = GroqClient.getInstance();
  const result = await client.generateContent(
    "openai/gpt-oss-20b",
    query,
    {
      systemInstruction: {
        parts: [{
          text:
            "You are Cloudy, a helpful AI assistant. " +
            "Respond naturally and warmly to greetings and small talk in 1-2 sentences. " +
            "Never mention search tools, APIs, or your own capabilities.",
        }],
      },
    }
  );
  return result?.text?.trim() ?? "Hey! How can I help you today?";
}

export type DetectResult = {
  shouldShowTabs: boolean;
  searchQuery: string | null;
  overallSummaryLines: string[];
  youtubeQuery?: string;
  webSearchQuery?: string;
  shoppingQuery?: string;
};

function tryAnswerFromContext(query: string, context?: string[]): string | null {
  const raw = (query ?? "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();
  if (!Array.isArray(context) || !context.length) return null;
  const memories = context
    .filter((c) => typeof c === "string" && c.trim().length > 0)
    .map((c) => c.trim())
    .filter((c) => c.toLowerCase().startsWith("memory:"))
    .map((c) => c.slice(7).trim())
    .filter((c) => c.length > 0);
  
  // If we have memories but they aren't about names or what we know, 
  // we still return null so the LLM can integrate them naturally into its response.
  if (!memories.length) return null;
  const asksName =
    /(\bmy name\b|\bwhat is my name\b|\bwhat'?s my name\b|\bwhats my name\b|\bwho am i\b|\bdo you remember my name\b|\bremember my name\b|\bdo you know my name\b)/i.test(lower);
  const asksWhatYouKnow =
    /\bwhat do you remember\b/.test(lower) ||
    /\bwhat do you know about me\b/.test(lower) ||
    /\bwhat do you know\b/.test(lower) ||
    /\bwhat have i told you\b/.test(lower);
  if (asksName) {
    // Look for anything containing "name" first
    const nameMemory = memories.find((m) => /name is/i.test(m)) || 
                       memories.find((m) => /\bname\b/i.test(m)) || 
                       memories[0];
    
    if (nameMemory) {
      return `From what you've told me before: ${nameMemory}`;
    }
  }
  if (asksWhatYouKnow) {
    const sample = memories.slice(0, 3).join(" ");
    return `Here’s what I remember so far: ${sample}`;
  }
  return null;
}

export function looksLikeSmallTalk(query: string): boolean {
  const raw = (query ?? "").trim().toLowerCase();
  if (!raw) return false;
  if (raw.length > 80) return false;

  const politePhrases = [
    "thanks",
    "thank you",
    "thx",
    "tysm",
    "appreciate it",
    "appreciate that",
    "you rock",
    "you are awesome",
    "you're awesome",
    "good bot",
    "nice",
    "cool",
    "great",
    "awesome",
    "ok thanks",
    "okay thanks",
    "ok thank you",
    "okay thank you",
    "hi",
    "hello",
    "hey",
    "good morning",
    "good afternoon",
    "good evening",
  ];

  for (const phrase of politePhrases) {
    if (raw === phrase || raw.startsWith(phrase + " ") || raw.endsWith(" " + phrase)) {
      return true;
    }
  }

  const simpleReplies = ["ok", "okay", "k", "sure", "got it", "makes sense", "ya", "yeah", "yep", "nope"];
  if (simpleReplies.includes(raw)) return true;

  return false;
}

export async function detectIntent(
  query: string,
  context?: string[]
): Promise<DetectResult> {
  const trimmed = (query ?? "").trim();
  // We no longer use tryAnswerFromContext to allow the LLM to naturally 
  // use the full context window (memories + history) for its response.
  
  if (looksLikeSmallTalk(trimmed)) {
    const lower = trimmed.toLowerCase();
    const asksName =
      /\b(your name|who are you|what are you|who r u)\b/.test(lower);
    const asksBuilder =
      /\b(who built you|who made you|who created you|who developed you)\b/.test(
        lower
      ) || /\b(atom\s*tech|atom\s*technologies|atom\s*ctrl)\b/.test(lower);

    const line =
      lower.includes("thank") ||
      lower.includes("thx") ||
      lower.includes("tysm") ||
      lower.includes("appreciate")
        ? "You're welcome! Anything else you want to do?"
        : asksBuilder
        ? "I'm Cloudy from Atom Ctrl by Atom Technologies. What do you want to build or learn today?"
        : asksName
        ? "I'm Cloudy from Atom Ctrl by Atom Technologies. What can I help you with?"
        : lower === "hi" ||
          lower === "hello" ||
          lower === "hey" ||
          lower.startsWith("good ")
        ? "Hi! What can I help you with?"
        : "Hi! What can I help you with?";

    return {
      shouldShowTabs: false,
      searchQuery: null,
      overallSummaryLines: [line, ""],
    };
  }
  
  // Explicit overrides for app-specific prefixes
  if (trimmed.startsWith("YouTube ")) {
    const q = trimmed.slice(8).trim();
    return {
      shouldShowTabs: true,
      searchQuery: q,
      youtubeQuery: q,
      overallSummaryLines: [`Found videos for: ${q}`, ""],
    };
  }

  const safeQuery = trimmed.slice(0, 512);
  if (!safeQuery) {
    return { shouldShowTabs: false, searchQuery: null, overallSummaryLines: [] };
  }

  const hasGroqKey = Boolean(process.env.GROQ_API_KEY || process.env.OPEN_AI_API_KEY);

  if (!hasGroqKey) {
    console.warn("[ai:detectIntent] Missing AI keys; AI disabled");
    return {
      shouldShowTabs: false,
      searchQuery: safeQuery,
      overallSummaryLines: [
        "AI is disabled because API keys are not set on the server.",
        "",
      ],
    };
  }

  let shouldShowTabs = false;
  let searchQuery: string | null = null;
  let overallSummaryLines: string[] = [];
  let youtubeQuery: string | undefined;
  let webSearchQuery: string | null = null;
  let shoppingQuery: string | null = null;

  try {
    const systemInstruction = {
      parts: [
        { text: DETECT_INTENT_SYSTEM_PROMPT },
        ...(Array.isArray(context) && context.length
          ? [
              {
                text:
                  "\n\nBelow is the user's complete profile, relevant memories, and recent conversation history to provide context for the current query:\n" +
                  context
                    .slice(-100) // Increased to 100 to accommodate more memories and history
                    .map((line) => `- ${line}`)
                    .join("\n"),
              },
            ]
          : []),
      ],
    };

    const toolDeclarations = [
      {
        name: "json",
        description:
          "Return a structured intent result for the current query. Use this for most queries instead of plain text.",
        parameters: {
          type: "object",
          properties: {
            shouldShowTabs: {
              type: "string",
              description:
                "Whether search tabs should be shown. Use \"true\" or \"false\" (string).",
            },
            response: {
              type: "string",
              description:
                "Very short plain-text summary or reply for the user (1–2 short sentences).",
            },
            searchQuery: {
              type: ["string", "null"],
              description:
                "Optional refined web search query if search tabs should be shown. This MUST be a clean search phrase without helper verbs or instructions. For example, for \"search for dogs\" use just \"dogs\"; for \"look up the best dog food\" use \"best dog food\". Empty string if not needed.",
            },
            youtubeQuery: {
              type: ["string", "null"],
              description:
                "Optional YouTube search query when the user mainly wants videos. Empty string if not needed.",
            },
            shoppingQuery: {
              type: ["string", "null"],
              description:
                "Optional shopping query string when the user is mainly looking for products to buy.",
            },
          },
          required: ["shouldShowTabs", "response"],
        },
      },
      {
        name: "intent",
        description:
          "Return a structured intent result for the current query. Use this for most queries instead of plain text.",
        parameters: {
          type: "object",
          properties: {
            shouldShowTabs: {
              type: "string",
              description:
                "Whether search tabs should be shown. Use \"true\" or \"false\" (string).",
            },
            response: {
              type: "string",
              description:
                "Very short plain-text summary or reply for the user (1–2 short sentences).",
            },
            searchQuery: {
              type: ["string", "null"],
              description:
                "Optional refined web search query if search tabs should be shown. This MUST be a clean search phrase without helper verbs or instructions. For example, for \"search for dogs\" use just \"dogs\"; for \"look up the best dog food\" use \"best dog food\". Empty string if not needed.",
            },
            youtubeQuery: {
              type: ["string", "null"],
              description:
                "Optional YouTube search query when the user mainly wants videos. Empty string if not needed.",
            },
            shoppingQuery: {
              type: ["string", "null"],
              description:
                "Optional shopping query string when the user is mainly looking for products to buy.",
            },
          },
          required: ["shouldShowTabs", "response"],
        },
      },
      {
        name: "shopping_search",
        description: "Search for products using Google Shopping for the given query.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "Product search query, for example: \"macbook air m3 laptop\".",
            },
          },
          required: ["query"],
        },
      },
      {
        name: "web_search",
        description: "Runs Google web search for the query",
        parameters: {
          type: "object",
          properties: { query: { type: "string", description: "Search query" } },
          required: ["query"],
        },
      },
      {
        name: "youtube_search",
        description: "Search YouTube for videos matching the query",
        parameters: {
          type: "object",
          properties: { query: { type: "string" } },
          required: ["query"],
        },
      },
      {
        name: "get_current_fx_rate",
        description: "Get FX rate between currencies",
        parameters: {
          type: "object",
          properties: {
            base: { type: "string" },
            symbol: { type: "string" },
          },
          required: ["base", "symbol"],
        },
      },
    ];

    const pre = await GroqClient.getInstance().generateContent("openai/gpt-oss-20b", safeQuery, {
      tools: toolDeclarations.map(
        (d): GroqTool => ({
          type: "function",
          function: { name: d.name, description: d.description, parameters: d.parameters },
        })
      ),
      systemInstruction,
    });

    if (pre && pre.functionCalls && pre.functionCalls.length > 0) {
      for (const fc of pre.functionCalls) {
        const args = (fc.args ?? {}) as Record<string, unknown>;
        if (fc.name === "json" || fc.name === "intent") {
          const rawTabs = String(args.shouldShowTabs ?? "").toLowerCase().trim();
          if (rawTabs === "true" || rawTabs === "false") {
            shouldShowTabs = rawTabs === "true";
          }
          const resp = String(args.response ?? "").trim();
          if (resp) {
            overallSummaryLines = [resp, ""];
          }
          const sq = String(args.searchQuery ?? "").trim();
          if (sq) {
            shouldShowTabs = true;
            if (!searchQuery) searchQuery = sq;
            webSearchQuery = sq;
          }
          const yq = String(args.youtubeQuery ?? "").trim();
          if (yq) {
            shouldShowTabs = true;
            youtubeQuery = yq;
            if (!searchQuery) searchQuery = yq;
            if (overallSummaryLines.length === 0) {
              overallSummaryLines = [`Found videos for: ${yq}`, ""];
            }
          }
          const shop = String(args.shoppingQuery ?? "").trim();
          if (shop) {
            shouldShowTabs = true;
            shoppingQuery = shop;
            if (!searchQuery) {
              searchQuery = shop;
            }
            if (overallSummaryLines.length === 0) {
              overallSummaryLines = [`Found products for: ${shop}`, ""];
            }
          }
        } else if (fc.name === "web_search") {
          shouldShowTabs = true;
          // Prefer keeping existing searchQuery if already set by another tool (unlikely but safe)
          const q = String(args.query ?? safeQuery).trim();
          if (q) {
            webSearchQuery = q;
            if (!searchQuery) {
              searchQuery = q;
            }
          }
        } else if (fc.name === "youtube_search") {
          shouldShowTabs = true;
          youtubeQuery = String(args.query ?? safeQuery);
          // Also set search query so other components can use it if needed
          if (!searchQuery) {
             searchQuery = youtubeQuery;
          }
          if (overallSummaryLines.length === 0) {
             overallSummaryLines = [`Found videos for: ${youtubeQuery}`, ""];
          }
        } else if (fc.name === "get_current_fx_rate") {
          try {
            const base = String(args.base || "USD").toUpperCase();
            const symbol = String(args.symbol || "INR").toUpperCase();
            const r = await fetch(
              `https://api.frankfurter.app/latest?from=${base}&to=${symbol}`,
              { next: { revalidate: 3600 } }
            );
            if (!r.ok) throw new Error(`FX API error: ${r.status}`);
            const j = await r.json();
            const rate = j?.rates?.[symbol];
            if (rate) {
              overallSummaryLines = [`${base}→${symbol}: ${rate}`, ""];
            } else {
              overallSummaryLines = [`Could not retrieve exchange rate for ${base} to ${symbol}. Please try again.`, ""];
            }
          } catch (err) {
            console.warn("[ai:detectIntent] FX service error", err);
            overallSummaryLines = [`Could not retrieve exchange rate. Please try again.`, ""];
          }
        } else if (fc.name === "shopping_search") {
          const q = String(args.query ?? safeQuery).trim();
          if (q) {
            shouldShowTabs = true;
            shoppingQuery = q;
            if (!searchQuery) {
              searchQuery = q;
            }
            if (overallSummaryLines.length === 0) {
              overallSummaryLines = [`Found products for: ${q}`, ""];
            }
          }
        }
      }
      
      // Fallback summary if tools were used but no summary set
      if (overallSummaryLines.length === 0) {
         overallSummaryLines = [pre.text || safeQuery.slice(0, 120), ""];
      }
    } else {
      overallSummaryLines = [pre?.text || safeQuery.slice(0, 120), ""];
    }

    if (shouldShowTabs && !webSearchQuery && !youtubeQuery && !shoppingQuery) {
      shouldShowTabs = false;
    }

    return {
      shouldShowTabs,
      searchQuery,
      overallSummaryLines,
      youtubeQuery,
      webSearchQuery: webSearchQuery || undefined,
      shoppingQuery: shoppingQuery || undefined,
    };
  } catch (err) {
    const message = String((err as unknown as { message?: string })?.message ?? err ?? "");
    const lower = message.toLowerCase();
    if (message.includes("RESOURCE_EXHAUSTED") || lower.includes("quota exceeded") || lower.includes("rate limit")) {
      console.warn("[ai:detectIntent] AI quota exceeded (final)");
      overallSummaryLines = ["AI quota exceeded. Please retry shortly.", ""];
    } else if (message.includes("UNAVAILABLE") || lower.includes("overloaded")) {
      console.warn("[ai:detectIntent] AI model overloaded (final)");
      overallSummaryLines = ["Cloudy is overloaded right now. Please try again shortly.", ""];
    } else if (lower.includes("fetch failed") || lower.includes("network")) {
      console.warn("[ai:detectIntent] Network error talking to AI", err);
      overallSummaryLines = ["Network error talking to AI. Please check connection or API key.", ""];
    } else {
      console.warn("[ai:detectIntent] AI processing error", err);
      overallSummaryLines = [`AI processing error: ${String(err)}`, ""];
    }
  }

  return {
    shouldShowTabs,
    searchQuery,
    overallSummaryLines,
    youtubeQuery,
    webSearchQuery: webSearchQuery || undefined,
    shoppingQuery: shoppingQuery || undefined,
  };
}
