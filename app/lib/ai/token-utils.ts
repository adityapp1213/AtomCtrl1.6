export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function trimContextToTokenBudget(
  lines: string[],
  maxTokens: number
): string[] {
  const cleaned = lines.filter((l) => l.trim().length > 0);
  const result: string[] = [];
  let used = 0;
  for (let i = cleaned.length - 1; i >= 0; i--) {
    const cost = estimateTokens(cleaned[i]);
    if (used + cost > maxTokens) break;
    result.unshift(cleaned[i]);
    used += cost;
  }
  return result;
}
