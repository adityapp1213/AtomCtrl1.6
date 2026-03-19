import { NextResponse } from "next/server";

export async function GET() {
  const checks = {
    groq: Boolean(process.env.GROQ_API_KEY || process.env.OPEN_AI_API_KEY),
    googleSearch: Boolean(process.env.GOOGLE_API_KEY && process.env.GOOGLE_CX),
    serpapi: Boolean(process.env.SERPAPI_API_KEY),
    youtube: Boolean(process.env.YOUTUBE_API_KEY),
    openweather: Boolean(process.env.OPENWEATHER_API_KEY),
    deepgram: Boolean(process.env.DEEPGRAM_API_KEY),
    firecrawl: Boolean(process.env.FIRECRAWL_API_KEY),
    convex: Boolean(process.env.NEXT_PUBLIC_CONVEX_URL),
  };

  const allOk = Object.values(checks).every(Boolean);

  return NextResponse.json(
    { ok: allOk, checks },
    { status: allOk ? 200 : 503 }
  );
}
