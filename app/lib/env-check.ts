const REQUIRED_SERVER_ENV_VARS = [
  "GROQ_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_CX",
  "SERPAPI_API_KEY",
  "YOUTUBE_API_KEY",
  "DEEPGRAM_API_KEY",
  "FIRECRAWL_API_KEY",
  "CLERK_SECRET_KEY",
  "CLERK_ISSUER",
  "NEXT_PUBLIC_CONVEX_URL",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
] as const;

const OPTIONAL_SERVER_ENV_VARS = [
  "OPENWEATHER_API_KEY",
] as const;

export function validateEnv(): void {
  if (typeof window !== "undefined") return;

  const missing = REQUIRED_SERVER_ENV_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `[Atom Ctrl] Server cannot start — missing required environment variables:\n` +
      missing.map((k) => `  ✗ ${k}`).join("\n") +
      `\n\nAdd these to your .env.local file.`
    );
  }
}
