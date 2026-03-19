# Phase 0: Mem0 References Before Refactor
Generated: Thu Mar 19 2026

Found 30 matches across 2 files:

## Files with Mem0 References

1. app/lib/mem0.ts (entire file - 161 lines)
   - MemoryClient import from mem0ai
   - mem0SearchForContext function
   - mem0AddTurn function
   - mem0UpdateMemory function
   - mem0DeleteMemory function
   - mem0DeleteAllForUser function

2. app/actions/search.ts (13 references)
   - Import of mem0AddTurn, mem0SearchForContext, Mem0Operation
   - mem0Ops array management
   - Conditional mem0SearchForContext calls
   - Conditional mem0AddTurn calls

## Summary
- Long-term memory system using Mem0.ai
- Memory operations tracked via mem0Ops array
- Context injection into query pipeline
- Memory extraction from conversation turns

## Action Plan (Phase 2)
- Delete: app/lib/mem0.ts
- Delete: app/actions/memory-read.ts (if exists)
- Remove all mem0 imports from search.ts
- Remove all mem0Context/mem0Ops code
- Uninstall mem0ai package
- Remove MEM0_API_KEY from .env.local
