import { Type } from "@google/genai";
import { DETECT_INTENT_SYSTEM_PROMPT } from "./system-prompts";
import { GeminiClient } from "./gemini-client";
import { GroqClient, GroqTool } from "./groq/groq-client";

export type DetectResult = {
  shouldShowTabs: boolean;
  searchQuery: string | null;
  overallSummaryLines: string[];
  mapLocation?: string;
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

function looksLikeSmallTalk(query: string): boolean {
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

function shouldAllowMapLocation(location: string, userQuery: string): boolean {
  const loc = (location ?? "").trim().replace(/^['"`]+|['"`]+$/g, "");
  const q = (userQuery ?? "").trim();
  if (!loc || !q) return false;
  if (looksLikeSmallTalk(loc) || looksLikeSmallTalk(q)) return false;

  const words = loc.split(/\s+/).filter(Boolean);
  // Hard guard against long paragraphs or big sentences being treated as locations
  if (loc.length > 80 || words.length > 8) return false;

  const qLower = q.toLowerCase();
  const hasExplicitMapIntent =
    /\b(map|maps|directions|direction|route|navigate|navigation|location|address|where is|nearest|closest)\b/i.test(
      qLower
    );

  const hasMediaIntent = /\b(youtube|yt|video|videos)\b/i.test(qLower);
  if (hasMediaIntent && !hasExplicitMapIntent) return false;

  const hasDigits = /\d/.test(loc);
  const hasComma = loc.includes(",");
  const hasTwoOrMoreWords = words.length >= 2;

  const hasPlaceKeyword =
    /\b(city|country|state|province|county|street|st|road|rd|avenue|ave|boulevard|blvd|drive|dr|lane|ln|place|pl|square|sq|mall|market|park|museum|airport|station|university|college|hospital|hotel|restaurant|cafe|bar|shop|store|beach|trail|temple|church|mosque)\b/i.test(
      qLower
    );

  if (hasExplicitMapIntent) return true;
  if ((hasDigits || hasComma) && (hasExplicitMapIntent || hasPlaceKeyword)) return true;

  const hasGeoPreposition = /\b(in|near|around|at)\b/i.test(qLower);
  if (hasTwoOrMoreWords && (hasGeoPreposition || hasPlaceKeyword)) return true;

  if (words.length === 1) {
    const single = words[0];
    if (!single) return false;
    const hasUpper = /[A-Z]/.test(location) || /[A-Z]/.test(q);
    if (!hasUpper) return false;
    const blockedSingle =
      /\b(dog|dogs|cat|cats|animal|animals|song|songs|lyrics|video|videos|youtube|yt|joke|jokes|meme|memes|recipe|recipes|code|api|error)\b/i.test(
        qLower
      );
    if (blockedSingle) return false;
    return true;
  }

  return false;
}

export async function detectIntent(
  query: string,
  context?: string[],
  providerOverride?: "gemini" | "groq"
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
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  const provider = (providerOverride || process.env.AI_PROVIDER || (hasGroqKey ? "groq" : "gemini")).toLowerCase();

  if (!(hasGroqKey || hasGeminiKey)) {
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
  let mapLocation: string | undefined;
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
            mapLocation: {
              type: ["string", "null"],
              description:
                "Optional city, place name, or address for maps when the query is about a location.",
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
            mapLocation: {
              type: ["string", "null"],
              description:
                "Optional city, place name, or address for maps when the query is about a location.",
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
        name: "google_maps",
        description: "Show a map, directions, or location for the query",
        parameters: {
          type: "object",
          properties: { location: { type: "string", description: "Location name or address" } },
          required: ["location"],
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

    const pre =
      provider === "groq" && hasGroqKey
        ? await GroqClient.getInstance().generateContent("openai/gpt-oss-20b", safeQuery, {
            tools: toolDeclarations.map(
              (d): GroqTool => ({
                type: "function",
                function: { name: d.name, description: d.description, parameters: d.parameters },
              })
            ),
            systemInstruction,
          })
        : await GeminiClient.getInstance().generateContent("gemini-2.5-flash", safeQuery, {
            tools: [
              {
                functionDeclarations: toolDeclarations.map((d) => ({
                  name: d.name,
                  description: d.description,
                  parameters: {
                    type: Type.OBJECT,
                    properties: Object.fromEntries(
                      Object.entries(d.parameters.properties).map(([k, v]) => [
                        k,
                        { type: Type.STRING, description: (v as { description?: string })?.description },
                      ])
                    ),
                    required: d.parameters.required,
                  },
                })),
              },
            ],
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
          const loc = String(args.mapLocation ?? "").trim();
          if (loc && shouldAllowMapLocation(loc, safeQuery)) {
            shouldShowTabs = true;
            mapLocation = loc;
            if (!searchQuery) {
              searchQuery = loc;
            }
            if (overallSummaryLines.length === 0) {
              overallSummaryLines = [`Showing map for: ${loc}`, ""];
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
        } else if (fc.name === "google_maps") {
          const loc = typeof args.location === "string" ? args.location : String(args.location ?? "");
          if (!shouldAllowMapLocation(loc, safeQuery)) {
            continue;
          }
          shouldShowTabs = true;
          mapLocation = loc;
          // If search query not set yet, use location
          if (!searchQuery) {
            searchQuery = mapLocation;
          }
          if (overallSummaryLines.length === 0) {
            overallSummaryLines = [`Showing map for: ${mapLocation}`, ""];
          }
        } else if (fc.name === "get_current_fx_rate") {
          try {
            const base = String(args.base || "USD").toUpperCase();
            const symbol = String(args.symbol || "INR").toUpperCase();
            const r = await fetch(
              `https://api.exchangerate.host/latest?base=${base}&symbols=${symbol}`,
              { next: { revalidate: 3600 } }
            );
            if (!r.ok) throw new Error(`FX API returned ${r.status}`);
            const j = await r.json();
            const rate = j?.rates?.[symbol];
            overallSummaryLines = [
              rate ? `${base}→${symbol}: ${rate}` : `Rate unavailable for ${base}/${symbol}`,
              "",
            ];
          } catch (err) {
            console.warn("[ai:detectIntent] FX service error", err);
            overallSummaryLines = ["FX service error", ""];
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

    if (shouldShowTabs && !webSearchQuery && !youtubeQuery && !mapLocation && !shoppingQuery) {
      shouldShowTabs = false;
    }

    return {
      shouldShowTabs,
      searchQuery,
      overallSummaryLines,
      mapLocation,
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
    mapLocation,
    youtubeQuery,
    webSearchQuery: webSearchQuery || undefined,
    shoppingQuery: shoppingQuery || undefined,
  };
}
