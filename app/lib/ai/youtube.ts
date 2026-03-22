
export type YouTubeVideo = {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  channelTitle: string;
  publishedAt: string;
};

type YouTubeSearchOptions = {
  maxResults?: number;
};

export async function youtubeSearch(
  query: string,
  options: YouTubeSearchOptions = {}
): Promise<YouTubeVideo[]> {
  const trimmed = (query ?? "").trim();
  if (!trimmed) return [];

  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error("[ai:youtubeSearch] Missing YOUTUBE_API_KEY");
    return [];
  }

  const requestedNum = typeof options.maxResults === "number" ? options.maxResults : 5;
  const maxResults = Math.min(Math.max(requestedNum, 1), 5);
  
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.searchParams.set("key", apiKey);
  url.searchParams.set("q", trimmed);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("maxResults", String(maxResults));
  url.searchParams.set("type", "video");

  try {
    const res = await fetch(url.toString(), { next: { revalidate: 300 } });
    if (!res.ok) {
      console.error("[ai:youtubeSearch] Non-OK response", res.status, res.statusText);
      return [];
    }
    const json = await res.json();
    const items = Array.isArray(json.items) ? json.items : [];
    
    return items.map((item: any) => ({
      id: item.id?.videoId || "",
      title: item.snippet?.title || "",
      description: item.snippet?.description || "",
      thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || "",
      channelTitle: item.snippet?.channelTitle || "",
      publishedAt: item.snippet?.publishedAt || "",
    })).filter((v: YouTubeVideo) => v.id);
  } catch (err) {
    console.error("[ai:youtubeSearch] Error calling YouTube API", err);
    return [];
  }
}
