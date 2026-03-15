import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

export const initChat = mutation({
  args: {
    userId: v.string(),
    sessionId: v.string(),
    title: v.optional(v.string()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, sessionId, title, createdAt } = args;

    const existingChat = await ctx.db
      .query("chats")
      .filter((q) => q.eq(q.field("userId"), userId))
      .filter((q) => q.eq(q.field("sessionId"), sessionId))
      .first();

    if (existingChat) {
      return { chatId: existingChat._id };
    }

    const draftChat = await ctx.db
      .query("chats")
      .filter((q) => q.eq(q.field("userId"), userId))
      .filter((q) => q.eq(q.field("count"), 0))
      .first();

    if (draftChat) {
      await ctx.db.patch(draftChat._id, {
        sessionId,
        updatedAt: createdAt,
      });
      return { chatId: draftChat._id };
    }

    const chatId = await ctx.db.insert("chats", {
      userId,
      sessionId,
      title: title ?? "",
      count: 0,
      createdAt,
      updatedAt: createdAt,
    });

    return { chatId };
  },
});

export const listUserChats = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId } = args;

    const chats = await ctx.db
      .query("chats")
      .filter((q) => q.eq(q.field("userId"), userId))
      .collect();

    const nonEmpty = chats.filter((chat) => (chat.count ?? 0) >= 1);

    nonEmpty.sort((a, b) => b.updatedAt - a.updatedAt);

    return nonEmpty.map((chat) => ({
      _id: chat._id,
      userId: chat.userId,
      sessionId: chat.sessionId,
      title: chat.title,
      name: chat.name,
      count: chat.count ?? 0,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
    }));
  },
});

export const writePrompt = mutation({
  args: {
    userId: v.string(),
    sessionId: v.string(),
    promptText: v.string(),
    source: v.string(),
    is_SST: v.optional(v.boolean()),
    createdAt: v.number(),
    searchQuery: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { userId, sessionId, promptText, source, is_SST, createdAt, searchQuery } = args;

    const existingChat = await ctx.db
      .query("chats")
      .filter((q) => q.eq(q.field("userId"), userId))
      .filter((q) => q.eq(q.field("sessionId"), sessionId))
      .first();

    let chatId = existingChat?._id;
    let nextCount = 1;

    if (!existingChat || !chatId) {
      chatId = await ctx.db.insert("chats", {
        userId,
        sessionId,
        title: searchQuery || promptText.slice(0, 80),
        name: promptText,
        count: 1,
        createdAt,
        updatedAt: createdAt,
      });
    } else {
      const currentCount = existingChat?.count ?? 0;
      nextCount = currentCount + 1;
      const shouldSetName = !existingChat?.name;
      if (shouldSetName) {
        await ctx.db.patch(chatId, {
          name: promptText,
          count: nextCount,
          updatedAt: createdAt,
        });
      } else {
        await ctx.db.patch(chatId, {
          count: nextCount,
          updatedAt: createdAt,
        });
      }
    }

    const promptId = await ctx.db.insert("user_prompts", {
      chatId,
      userId,
      sessionId,
      content: promptText,
      source,
      ...(typeof is_SST === "boolean" ? { is_SST } : {}),
      createdAt,
      searchQuery: searchQuery ?? null,
      countNo: nextCount,
    });

    return { chatId, promptId };
  },
});

export const writeResponse = mutation({
  args: {
    userId: v.string(),
    sessionId: v.string(),
    promptId: v.optional(v.id("user_prompts")),
    responseType: v.string(),
    reasoning: v.optional(v.string()),
    content: v.optional(v.string()),
    data: v.optional(v.any()),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const { userId, sessionId, promptId, responseType, reasoning, content, data, createdAt } = args;

    const existingChat = await ctx.db
      .query("chats")
      .filter((q) => q.eq(q.field("userId"), userId))
      .filter((q) => q.eq(q.field("sessionId"), sessionId))
      .first();

    let chatId = existingChat?._id;
    if (!chatId) {
      chatId = await ctx.db.insert("chats", {
        userId,
        sessionId,
        title: (content || "").slice(0, 80),
        createdAt,
        updatedAt: createdAt,
      });
    } else {
      await ctx.db.patch(chatId, { updatedAt: createdAt });
    }

    let countNo: number | undefined;
    if (promptId) {
      const prompt = await ctx.db.get(promptId);
      if (prompt && typeof (prompt as any).countNo === "number") {
        countNo = (prompt as any).countNo as number;
      }
    }

    const responseId = await ctx.db.insert(
      "responses",
      {
        chatId,
        userId,
        sessionId,
        promptId: promptId ?? null,
        responseType,
        ...(typeof reasoning === "string" ? { reasoning } : {}),
        content: content ?? "",
        data: data ?? null,
        createdAt,
        ...(typeof countNo === "number" ? { countNo } : {}),
      }
    );

    if (responseType === "search" && data && typeof data === "object") {
      const searchData: any = data;
      const webItems = Array.isArray(searchData.webItems) ? searchData.webItems : [];
      const mediaItems = Array.isArray(searchData.mediaItems) ? searchData.mediaItems : [];
      const weatherItems = Array.isArray(searchData.weatherItems) ? searchData.weatherItems : [];
      const youtubeItems = Array.isArray(searchData.youtubeItems) ? searchData.youtubeItems : undefined;
      const shoppingItems = Array.isArray(searchData.shoppingItems) ? searchData.shoppingItems : undefined;
      const overallSummaryLines = Array.isArray(searchData.overallSummaryLines)
        ? searchData.overallSummaryLines
        : [];
      const summary = typeof searchData.summary === "string" ? searchData.summary : undefined;

      await ctx.db.insert("search_results", {
        chatId,
        responseId,
        searchQuery: String(searchData.searchQuery || ""),
        overallSummaryLines,
        summary,
        webItems,
        mediaItems,
        weatherItems,
        youtubeItems,
        shoppingItems,
        mapLocation: searchData.mapLocation ?? undefined,
        googleMapsKey: searchData.googleMapsKey ?? undefined,
        shouldShowTabs: Boolean(searchData.shouldShowTabs),
      });
    }

    return { chatId, responseId };
  },
});

export const editPrompt = mutation({
  args: {
    promptId: v.id("user_prompts"),
    newContent: v.string(),
    isEdit: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const prompt = await ctx.db.get(args.promptId);
    if (!prompt) {
      return { ok: false };
    }
    await ctx.db.patch(args.promptId, {
      editContent: args.newContent,
      ...(typeof args.isEdit === "boolean" ? { isEdit: args.isEdit } : {}),
    });
    return { ok: true };
  },
});

export const addPromptEdit = mutation({
  args: {
    promptId: v.id("user_prompts"),
    content: v.string(),
    responseId: v.id("responses"),
    createdAt: v.number(),
  },
  handler: async (ctx, args) => {
    const prompt = await ctx.db.get(args.promptId);
    if (!prompt) {
      return { ok: false };
    }
    const existing = Array.isArray((prompt as any).edit) ? ((prompt as any).edit as any[]) : [];
    const next = [
      ...existing,
      { content: args.content, responseId: args.responseId, createdAt: args.createdAt },
    ];
    await ctx.db.patch(args.promptId, {
      isEdit: true,
      edit: next,
    });
    return { ok: true };
  },
});

export const listChatMessages = query({
  args: {
    userId: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, sessionId } = args;

    const chat = await ctx.db
      .query("chats")
      .filter((q) => q.eq(q.field("userId"), userId))
      .filter((q) => q.eq(q.field("sessionId"), sessionId))
      .first();

    if (!chat) {
      return { chat: null, prompts: [], responses: [] };
    }

    const prompts = await ctx.db
      .query("user_prompts")
      .filter((q) => q.eq(q.field("userId"), userId))
      .filter((q) => q.eq(q.field("sessionId"), sessionId))
      .collect();

    const responses = await ctx.db
      .query("responses")
      .filter((q) => q.eq(q.field("userId"), userId))
      .filter((q) => q.eq(q.field("sessionId"), sessionId))
      .collect();

    prompts.sort((a, b) => a.createdAt - b.createdAt);
    responses.sort((a, b) => a.createdAt - b.createdAt);

    return { chat, prompts, responses };
  },
});

export const deleteChat = mutation({
  args: {
    userId: v.string(),
    sessionId: v.string(),
  },
  handler: async (ctx, args) => {
    const { userId, sessionId } = args;

    const chat = await ctx.db
      .query("chats")
      .filter((q) => q.eq(q.field("userId"), userId))
      .filter((q) => q.eq(q.field("sessionId"), sessionId))
      .first();

    if (!chat) {
      return { deleted: false };
    }

    const chatId = chat._id;

    const searchResults = await ctx.db
      .query("search_results")
      .filter((q) => q.eq(q.field("chatId"), chatId))
      .collect();

    for (const doc of searchResults) {
      await ctx.db.delete(doc._id);
    }

    const responses = await ctx.db
      .query("responses")
      .filter((q) => q.eq(q.field("chatId"), chatId))
      .collect();

    for (const doc of responses) {
      await ctx.db.delete(doc._id);
    }

    const prompts = await ctx.db
      .query("user_prompts")
      .filter((q) => q.eq(q.field("chatId"), chatId))
      .collect();

    for (const doc of prompts) {
      await ctx.db.delete(doc._id);
    }

    await ctx.db.delete(chatId);

    return { deleted: true };
  },
});

export const updateChatTitle = mutation({
  args: {
    chatId: v.id("chats"),
    title: v.string(),
  },
  handler: async (ctx, args) => {
    const chat = await ctx.db.get(args.chatId);
    if (!chat) {
      return { ok: false };
    }
    await ctx.db.patch(args.chatId, { title: args.title });
    return { ok: true };
  },
});
