# Phase 0: Gemini References Before Refactor
Generated: Thu Mar 19 2026

Found 53 matches across 7 files:

## Files with Gemini References

1. app/lib/ai/gemini-client.ts (entire file - 181 lines)
2. app/lib/ai/firecrawl.ts (7 references)
3. app/lib/ai/search.ts (16 references)
4. app/lib/ai/genai.ts (4 references)
5. app/api/ai/summary-stream/route.ts (6 references)
6. app/actions/search.ts (3 references)
7. app/actions/agent-plan.ts (1 reference)

## Summary
- GeminiClient class with multi-key support, streaming, and fallback logic
- Provider override logic in search.ts, firecrawl.ts, search.ts
- Cookie-based provider selection in search.ts and summary-stream route
- GEMINI_API_KEY and GOOGLE_API_KEY environment variable checks

## Action Plan (Phase 1)
- Delete: app/lib/ai/gemini-client.ts
- Remove all imports of GeminiClient
- Remove all "gemini" branches in provider logic
- Replace with hardcoded "groq" provider
- Uninstall @google/genai package
- Remove GEMINI_API_KEY from .env.local
