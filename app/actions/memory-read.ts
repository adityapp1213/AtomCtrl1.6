import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { GroqClient } from "@/app/lib/ai/groq/groq-client";

type MemoryMatch = {
  chatId: string;
  title: string;
  summary: string;
  content: string;
};

export async function readConversationMemoryForQuery(
  query: string,
  userId: string
): Promise<MemoryMatch | null> {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return null;

  const client = new ConvexHttpClient(convexUrl);

  const chats = (await client.query(api.chat.listUserChats, {
    userId,
  })) as any[];

  if (!Array.isArray(chats) || chats.length === 0) {
    return null;
  }

  const normQuery = query.toLowerCase();
  const queryTokens = normQuery
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);

  let best: { chatId: string; sessionId: string; title: string; score: number } | null =
    null;

  for (const chat of chats) {
    const chatId = String(chat._id);
    const sessionId = String(chat.sessionId || "");
    const title = String(chat.title || "").trim();
    const normTitle = title.toLowerCase();
    const titleTokens = normTitle
      .split(/\s+/)
      .map((t) => t.replace(/[^a-z0-9]/gi, ""))
      .filter(Boolean);

    if (!sessionId || (!title && titleTokens.length === 0)) continue;

    let score = 0;
    for (const qt of queryTokens) {
      if (!qt) continue;
      if (normTitle.includes(qt)) score += 2;
      if (titleTokens.includes(qt)) score += 1;
    }

    if (score <= 0) continue;

    if (!best || score > best.score) {
      best = { chatId, sessionId, title, score };
    }
  }

  if (!best) return null;

  const history = (await client.query(api.chat.listChatMessages, {
    userId,
    sessionId: best.sessionId,
  })) as { chat: any; prompts: any[]; responses: any[] };

  const chat = history?.chat;
  const prompts = Array.isArray(history?.prompts) ? history.prompts : [];
  const responses = Array.isArray(history?.responses) ? history.responses : [];

  if (!chat) return null;

  const turns: { role: "user" | "assistant"; text: string; createdAt: number }[] = [];

  for (const p of prompts) {
    turns.push({
      role: "user",
      text: String(p.content ?? "").slice(0, 800),
      createdAt: Number(p.createdAt ?? 0),
    });
  }

  for (const r of responses) {
    turns.push({
      role: "assistant",
      text: String(r.content ?? "").slice(0, 800),
      createdAt: Number(r.createdAt ?? 0),
    });
  }

  turns.sort((a, b) => a.createdAt - b.createdAt);

  if (turns.length === 0) return null;

  const maxTurnsForModel = 40;
  const effectiveTurns =
    turns.length > maxTurnsForModel ? turns.slice(-maxTurnsForModel) : turns;

  const conversationText = effectiveTurns
    .map((t) => `${t.role === "user" ? "User" : "Assistant"}: ${t.text}`)
    .join("\n");

  const chatCount =
    typeof chat.count === "number" ? (chat.count as number) : turns.length;

  const hasGroqKey = Boolean(
    process.env.GROQ_API_KEY || process.env.OPEN_AI_API_KEY
  );

  let heading = String(best.title || "").slice(0, 80);
  if (!heading) {
    const lastUser = [...effectiveTurns].reverse().find((t) => t.role === "user");
    heading = lastUser?.text
      ? String(lastUser.text).slice(0, 80)
      : "Conversation memory";
  }

  if (chatCount <= 6) {
    return {
      chatId: best.chatId,
      title: heading,
      summary: "Previous short conversation.",
      content: [`# ${heading}`, "", conversationText].join("\n"),
    };
  }

  let summary = "";
  if (hasGroqKey) {
    try {
      const systemInstruction = {
        parts: [
          {
            text:
              "Summarize the following conversation into a single plain-text paragraph. " +
              "Use up to 8 sentences. Do not include markdown lists or headings. " +
              "Return only the summary text.",
          },
        ],
      };

      const result = await GroqClient.getInstance().generateContent(
        "openai/gpt-oss-20b",
        conversationText,
        { systemInstruction }
      );

      summary = String(result?.text || "").trim();
    } catch (err) {
      console.error("[memory-read] Groq summarization failed", err);
    }
  }

  if (!summary) {
    summary = conversationText.slice(0, 4000);
  }

  return {
    chatId: best.chatId,
    title: heading,
    summary,
    content: [`# ${heading}`, "", summary].join("\n"),
  };
}
