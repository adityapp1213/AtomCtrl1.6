
export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
  isVoice?: boolean;
  type?: "text" | "search";
  data?: any;
};

export type BrowserTab = {
  id: string;
  url: string;
  title: string;
  icon?: string;
};

export type PinnedItem = {
  id: string;
  kind: "web" | "youtube";
  title: string;
  link?: string;
  summary?: string;
};

export type ChatSession = {
  id: string;
  title: string;
  timestamp: number;
  messages: ChatMessage[];
  browserTabs: BrowserTab[];
  activeTabId: string | null;
  searchQuery: string;
  overallSummaryLines: string[];
  summary?: string | null;
  webItems: any[];
  mediaItems: any[];
  isWeatherQuery?: boolean;
  weatherItems: any[];
  youtubeItems: any[];
  shoppingItems?: any[];
  shouldShowTabs: boolean;
  tab: string;
  pinnedItems?: PinnedItem[];
  conversationMemory?: string[];
  memoryWindowKey?: string | null;
};

function storageKeyForUser(userId: string | null | undefined) {
  return userId ? `atom_chat_history:${userId}` : null;
}

export const getChatHistory = (userId: string | null | undefined): ChatSession[] => {
  if (typeof window === "undefined") return [];
  const key = storageKeyForUser(userId);
  if (!key) return [];
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.error("Failed to read chat history", e);
    return [];
  }
};

export const getChatSession = (
  userId: string | null | undefined,
  id: string
): ChatSession | undefined => {
  const history = getChatHistory(userId);
  return history.find((h) => h.id === id);
};

export const saveChatSession = (
  userId: string | null | undefined,
  session: ChatSession
) => {
  if (typeof window === "undefined") return;
  const key = storageKeyForUser(userId);
  if (!key) return;
  try {
    const history = getChatHistory(userId);
    const index = history.findIndex((h) => h.id === session.id);
    if (index >= 0) {
      history[index] = session;
    } else {
      history.unshift(session);
    }
    localStorage.setItem(key, JSON.stringify(history));
    // Dispatch event for sidebar update
    window.dispatchEvent(new Event("chat-history-updated"));
  } catch (e) {
    console.error("Failed to save chat session", e);
  }
};

export const deleteChatSession = (
  userId: string | null | undefined,
  id: string
) => {
  if (typeof window === "undefined") return;
  const key = storageKeyForUser(userId);
  if (!key) return;
  try {
    const history = getChatHistory(userId).filter((h) => h.id !== id);
    localStorage.setItem(key, JSON.stringify(history));
    window.dispatchEvent(new Event("chat-history-updated"));
  } catch (e) {
    console.error("Failed to delete chat session", e);
  }
};
