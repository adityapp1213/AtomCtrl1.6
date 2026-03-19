import { mutation, query, internalMutation } from "./_generated/server";
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
      .withIndex("by_user_session", (q) =>
        q.eq("userId", userId).eq("sessionId", sessionId)
      )
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
      .withIndex("by_user_session", (q) => q.eq("userId", userId))
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
      .withIndex("by_user_session", (q) =>
        q.eq("userId", userId).eq("sessionId", sessionId)
      )
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

    const reasoningArg = typeof reasoning === "string" ? reasoning : null;
    const dataObj = data as Record<string, unknown> | null;
    const reasoningFromData = typeof dataObj?.reasoning === "string" ? dataObj.reasoning : null;
    const finalReasoning = reasoningArg ?? reasoningFromData;

    const responseId = await ctx.db.insert(
      "responses",
      {
        chatId,
        userId,
        sessionId,
        promptId: promptId ?? null,
        responseType,
        ...(finalReasoning ? { reasoning: finalReasoning } : {}),
        content: content ?? "",
        data: null,
        createdAt,
        ...(typeof countNo === "number" ? { countNo } : {}),
      }
    );

    if (responseType === "search" && dataObj && typeof dataObj === "object") {
      const searchData = dataObj;
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
        mapLocation: typeof searchData.mapLocation === "string" ? searchData.mapLocation : undefined,
        googleMapsKey: typeof searchData.googleMapsKey === "string" ? searchData.googleMapsKey : undefined,
        shouldShowTabs: Boolean(searchData.shouldShowTabs),
      });
    }

    return { chatId, responseId };
  },
});

export const updateResponse = mutation({
  args: {
    responseId: v.id("responses"),
    content: v.string(),
    responseType: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.responseId, {
      content: args.content,
      responseType: args.responseType,
      ...(args.data !== undefined ? { data: args.data } : {}),
    });
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
  args: { userId: v.string(), sessionId: v.string() },
  handler: async (ctx, args) => {
    const { userId, sessionId } = args;

    const chat = await ctx.db
      .query("chats")
      .withIndex("by_user_session", (q) =>
        q.eq("userId", userId).eq("sessionId", sessionId)
      )
      .first();

    if (!chat) return { chat: null, prompts: [], responses: [] };

    const prompts = await ctx.db
      .query("user_prompts")
      .withIndex("by_user_session", (q) =>
        q.eq("userId", userId).eq("sessionId", sessionId)
      )
      .collect();

    const rawResponses = await ctx.db
      .query("responses")
      .withIndex("by_user_session", (q) =>
        q.eq("userId", userId).eq("sessionId", sessionId)
      )
      .collect();

    const allSearchResults = await ctx.db
      .query("search_results")
      .withIndex("by_chat", (q) => q.eq("chatId", chat._id))
      .collect();

    const searchResultMap = new Map(
      allSearchResults.map((sr) => [sr.responseId as string, sr])
    );

    const responses = rawResponses
      .filter(
        (r) =>
          !(
            r.responseType === "streaming" &&
            (r.content ?? "").trim() === "" &&
            !searchResultMap.has(r._id as string)
          )
      )
      .map((response) => {
        const searchResult = searchResultMap.get(response._id as string);

        if (!searchResult) {
          return response;
        }

        return {
          ...response,
          data: {
            searchQuery: searchResult.searchQuery,
            overallSummaryLines: searchResult.overallSummaryLines ?? [],
            summary: searchResult.summary ?? "",
            webItems: searchResult.webItems ?? [],
            mediaItems: searchResult.mediaItems ?? [],
            weatherItems: searchResult.weatherItems ?? [],
            youtubeItems: searchResult.youtubeItems ?? [],
            shoppingItems: searchResult.shoppingItems ?? [],
            mapLocation: searchResult.mapLocation,
            googleMapsKey: searchResult.googleMapsKey,
            shouldShowTabs: searchResult.shouldShowTabs ?? false,
          },
        };
      });

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

export const patchSearchResultsSummary = mutation({
  args: {
    responseId: v.id("responses"),
    overallSummaryLines: v.array(v.string()),
    summary: v.optional(v.string()),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const searchResult = await ctx.db
      .query("search_results")
      .withIndex("by_response", (q) => q.eq("responseId", args.responseId))
      .first();

    if (searchResult) {
      await ctx.db.patch(searchResult._id, {
        overallSummaryLines: args.overallSummaryLines,
        summary: args.summary,
      });
    }

    await ctx.db.patch(args.responseId, {
      content: args.content,
      responseType: "search",
    });
  },
});

export const writeInitialSearchResponse = mutation({
  args: {
    userId: v.string(),
    sessionId: v.string(),
    promptId: v.union(v.id("user_prompts"), v.null()),
    reasoning: v.string(),
    responseType: v.string(),
    createdAt: v.number(),
    countNo: v.optional(v.number()),
    searchQuery: v.string(),
    webItems: v.array(v.any()),
    mediaItems: v.array(v.any()),
    weatherItems: v.array(v.any()),
    youtubeItems: v.optional(v.array(v.any())),
    shoppingItems: v.optional(v.array(v.any())),
    mapLocation: v.optional(v.string()),
    googleMapsKey: v.optional(v.string()),
    shouldShowTabs: v.boolean(),
  },
  handler: async (ctx, args) => {
    const chat = await ctx.db
      .query("chats")
      .withIndex("by_user_session", (q) =>
        q.eq("userId", args.userId).eq("sessionId", args.sessionId)
      )
      .first();

    if (!chat) throw new Error("Chat not found for writeInitialSearchResponse");

    // Increment chat count and get the response's countNo
    const currentCount = (chat.count ?? 0) + 1;
    await ctx.db.patch(chat._id, { count: currentCount, updatedAt: args.createdAt });

    // Get countNo from prompt if available
    let responseCountNo: number | undefined;
    if (args.promptId) {
      const prompt = await ctx.db.get(args.promptId);
      if (prompt && typeof (prompt as any).countNo === "number") {
        responseCountNo = (prompt as any).countNo as number;
      }
    }

    const responseId = await ctx.db.insert("responses", {
      chatId: chat._id,
      userId: args.userId,
      sessionId: args.sessionId,
      promptId: args.promptId,
      responseType: "streaming",
      reasoning: args.reasoning,
      content: "",
      data: null,
      createdAt: args.createdAt,
      ...(typeof responseCountNo === "number" ? { countNo: responseCountNo } : {}),
    });

    await ctx.db.insert("search_results", {
      chatId: chat._id,
      responseId,
      searchQuery: args.searchQuery,
      overallSummaryLines: [],
      summary: undefined,
      webItems: args.webItems,
      mediaItems: args.mediaItems,
      weatherItems: args.weatherItems,
      youtubeItems: args.youtubeItems,
      shoppingItems: args.shoppingItems,
      mapLocation: args.mapLocation,
      googleMapsKey: args.googleMapsKey,
      shouldShowTabs: args.shouldShowTabs,
    });

    return { responseId };
  },
});

export const migrateReasoningColumn = internalMutation({
  handler: async (ctx) => {
    const responses = await ctx.db.query("responses").collect();
    let migrated = 0;

    for (const response of responses) {
      const data = response.data as any;

      if (data?.reasoning && !response.reasoning) {
        const { reasoning, ...restData } = data;

        await ctx.db.patch(response._id, {
          reasoning: String(reasoning),
          data: Object.keys(restData).length > 0 ? restData : null,
        });
        migrated++;
      }
    }

    console.log(`[migration] Moved reasoning for ${migrated} records`);
  },
});

export const migrateSearchDataToSearchResults = internalMutation({
  handler: async (ctx) => {
    const responses = await ctx.db.query("responses").collect();
    let migrated = 0;
    let skipped = 0;

    for (const response of responses) {
      const data = response.data as any;

      if (!data || (!data.webItems && !data.searchQuery && !data.shouldShowTabs)) {
        continue;
      }

      const existing = await ctx.db
        .query("search_results")
        .withIndex("by_response", (q) => q.eq("responseId", response._id))
        .first();

      if (existing) {
        if (
          (!existing.overallSummaryLines || existing.overallSummaryLines.length === 0) &&
          Array.isArray(data.overallSummaryLines) &&
          data.overallSummaryLines.length > 0
        ) {
          await ctx.db.patch(existing._id, {
            overallSummaryLines: data.overallSummaryLines,
            summary: data.summary ?? undefined,
          });
        }
        await ctx.db.patch(response._id, { data: null });
        skipped++;
        continue;
      }

      await ctx.db.insert("search_results", {
        chatId: response.chatId,
        responseId: response._id,
        searchQuery: String(data.searchQuery ?? ""),
        overallSummaryLines: Array.isArray(data.overallSummaryLines)
          ? data.overallSummaryLines
          : [],
        summary: typeof data.summary === "string" ? data.summary : undefined,
        webItems: Array.isArray(data.webItems) ? data.webItems : [],
        mediaItems: Array.isArray(data.mediaItems) ? data.mediaItems : [],
        weatherItems: Array.isArray(data.weatherItems) ? data.weatherItems : [],
        youtubeItems: Array.isArray(data.youtubeItems) ? data.youtubeItems : undefined,
        shoppingItems: Array.isArray(data.shoppingItems) ? data.shoppingItems : undefined,
        mapLocation: data.mapLocation ?? undefined,
        googleMapsKey: data.googleMapsKey ?? undefined,
        shouldShowTabs: Boolean(data.shouldShowTabs),
      });

      await ctx.db.patch(response._id, { data: null });
      migrated++;
    }

    console.log(
      `[migration] Created search_results for ${migrated} records, patched ${skipped} existing`
    );
  },
});
