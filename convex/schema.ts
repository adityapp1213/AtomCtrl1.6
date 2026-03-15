import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  chats: defineTable({
    userId: v.string(),
    sessionId: v.string(),
    title: v.string(),
    name: v.optional(v.string()),
    count: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user_session", ["userId", "sessionId"]),

  user_prompts: defineTable({
    chatId: v.id("chats"),
    userId: v.string(),
    sessionId: v.string(),
    content: v.string(),
    source: v.string(),
    is_SST: v.optional(v.boolean()),
    createdAt: v.number(),
    searchQuery: v.union(v.string(), v.null()),
    countNo: v.optional(v.number()),
    isEdit: v.optional(v.boolean()),
    editContent: v.optional(v.string()),
    edit: v.optional(
      v.array(
        v.object({
          content: v.string(),
          responseId: v.id("responses"),
          createdAt: v.number(),
        })
      )
    ),
  })
    .index("by_user_session", ["userId", "sessionId"])
    .index("by_chat", ["chatId"]),

  responses: defineTable({
    chatId: v.id("chats"),
    userId: v.string(),
    sessionId: v.string(),
    promptId: v.union(v.id("user_prompts"), v.null()),
    responseType: v.string(),
    reasoning: v.optional(v.string()),
    content: v.string(),
    data: v.union(v.any(), v.null()),
    createdAt: v.number(),
    countNo: v.optional(v.number()),
  })
    .index("by_user_session", ["userId", "sessionId"])
    .index("by_chat", ["chatId"]),

  search_results: defineTable({
    chatId: v.id("chats"),
    responseId: v.id("responses"),
    searchQuery: v.string(),
    overallSummaryLines: v.array(v.string()),
    summary: v.optional(v.string()),
    webItems: v.array(
      v.object({
        link: v.string(),
        title: v.string(),
        summaryLines: v.array(v.string()),
        imageUrl: v.optional(v.string()),
      })
    ),
    mediaItems: v.array(
      v.object({
        src: v.string(),
        alt: v.optional(v.string()),
      })
    ),
    weatherItems: v.array(v.any()),
    youtubeItems: v.optional(v.array(v.any())),
    shoppingItems: v.optional(v.array(v.any())),
    mapLocation: v.optional(v.string()),
    googleMapsKey: v.optional(v.string()),
    shouldShowTabs: v.boolean(),
  })
    .index("by_chat", ["chatId"])
    .index("by_response", ["responseId"]),
});
