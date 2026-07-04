export const MARKET_RELEVANCE_THRESHOLD = 40

export function relevanceScorePercent (analysis) {
  const raw = Number(analysis?.relevance?.score ?? 0)
  if (!Number.isFinite(raw)) return 0
  if (raw > 0 && raw <= 10) return Math.round(raw * 10)
  return Math.round(raw)
}

export function normalizeRelevanceScore (analysis) {
  if (!analysis?.relevance) return analysis
  analysis.relevance.score = relevanceScorePercent(analysis)
  return analysis
}

export function isMarketRelevant (analysis) {
  return Boolean(analysis?.relevance?.include) &&
    relevanceScorePercent(analysis) >= MARKET_RELEVANCE_THRESHOLD
}
