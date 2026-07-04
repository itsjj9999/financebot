import { plainEnglish, shortClean, shortPlain } from './plain_english.js'

function compact (value, fallback = 'Not enough evidence in the selected videos.') {
  return plainEnglish(value || fallback)
}

function shorten (value, maxWords = 28) {
  return shortPlain(value, maxWords, '')
}

function shortenLabel (value, maxWords = 12) {
  return shortClean(value, maxWords, '')
}

function unique (items) {
  const seen = new Set()
  const output = []
  for (const item of items.map(value => compact(value, '')).filter(Boolean)) {
    const key = item.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    output.push(item)
  }
  return output
}

function take (items, count, fallback) {
  const values = unique(items).slice(0, count)
  while (values.length < count && fallback) values.push(fallback)
  return values
}

function confidenceFromScore (score) {
  if (score >= 75) return 'high'
  if (score >= 50) return 'medium'
  return 'low'
}

function causeType (value) {
  if (['reported', 'inferred', 'speculative'].includes(value)) return value
  return 'mixed'
}

function durabilityFromImpact (impact) {
  if (impact === 'material' || impact === 'potentially_material') return 'potentially_durable'
  if (impact === 'temporary') return 'temporary'
  return 'uncertain'
}

function topAnalyses (analyses) {
  return [...analyses].sort((a, b) => (b.relevance?.score || 0) - (a.relevance?.score || 0))
}

function topicCount (analyses, pattern) {
  return analyses.filter(analysis => pattern.test([
    analysis.video?.title,
    ...(analysis.summary || []),
    ...(analysis.relevance?.categories || [])
  ].join(' '))).length
}

function keywordAgreement (analyses) {
  const topics = [
    ['AI/semiconductors', /\b(ai|chip|semiconductor|nvidia|micron|oracle|tech)\b/i],
    ['energy/geopolitics', /\b(oil|iran|hormuz|sanction|energy|gas)\b/i],
    ['rates/credit', /\b(rate|bond|credit|debt|yield|fed)\b/i],
    ['China/regulation', /\b(china|alibaba|byd|baidu|blacklist|tariff)\b/i]
  ]
  const matches = []
  for (const [label, pattern] of topics) {
    const sources = new Set()
    for (const analysis of analyses) {
      const haystack = [
        analysis.video?.title,
        ...(analysis.summary || []),
        ...(analysis.relevance?.categories || [])
      ].join(' ')
      if (pattern.test(haystack)) sources.add(analysis.video?.source || 'Unknown source')
    }
    if (sources.size >= 2) matches.push(`${label} appeared across ${sources.size} source groups.`)
  }
  return matches
}

export function buildLocalDailyBrief (date, analyses) {
  const ranked = topAnalyses(analyses)
  const top = ranked.slice(0, 3)
  const primary = top[0]
  const allSummaries = ranked.flatMap(item => item.summary || [])
  const allQuestions = ranked.flatMap(item => item.investor_view?.questions || [])
  const allRisks = ranked.flatMap(item => item.investor_view?.risks || [])
  const forecasts = ranked.flatMap(item => item.forecasts || [])
  const companies = ranked.flatMap(item => item.companies || [])
  const lessons = ranked.map(item => item.lesson).filter(Boolean)
  const bottomLines = [
    `${analyses.length} relevant videos survived the noise filter.`,
    topicCount(analyses, /\b(ai|chip|semiconductor|nvidia|micron|tech)\b/i) > 1
      ? 'AI and chip stocks were the loudest market story.'
      : '',
    topicCount(analyses, /\b(oil|iran|hormuz|sanction|energy|gas)\b/i) > 1
      ? 'Energy and geopolitics were worth watching, but not automatically a portfolio move.'
      : '',
    topicCount(analyses, /\b(bond|credit|debt|yield|spacex)\b/i) > 1
      ? 'Debt and funding conditions showed up as an important theme.'
      : ''
  ].filter(Boolean)

  const mainStories = top.map(item => ({
    headline: shortenLabel(item.video?.title, 12) || 'Market-relevant story',
    what_happened: shorten((item.summary || []).slice(0, 1).join(' '), 18),
    why_it_matters: shorten(item.investor_view?.signal_vs_noise || item.relevance?.reason, 14),
    confidence: confidenceFromScore(item.relevance?.score || 0)
  }))

  const markets = ranked.flatMap(item => (item.market_moves || []).map(move => ({
    asset: shortenLabel(move.asset, 8) || 'Market',
    move: shorten(`${move.direction || 'unknown'} ${move.magnitude || ''}`, 10),
    why: shorten(move.cause, 12),
    cause_type: causeType(move.cause_type),
    next_signal: compact(move.timestamp ? `Review the claim around ${move.timestamp}.` : 'Watch whether later sources confirm this move.')
  }))).slice(0, 6)

  const gameTheory = ranked
    .filter(item => (item.actors || []).length >= 2)
    .slice(0, 2)
    .map(item => ({
      story: shortenLabel(item.video?.title, 10) || 'Market story',
      players: item.actors.slice(0, 3).map(actor => ({
        name: shortenLabel(actor.name, 6) || 'Actor',
        wants: shorten(actor.objective, 10),
        constraints: shorten((actor.constraints || []).join('; '), 10),
        leverage: shorten(actor.leverage, 10),
        likely_move: shorten(actor.likely_next_move, 9)
      })),
      key_tension: shorten(item.relevance?.reason, 12),
      what_changes_the_game: shorten((item.forecasts?.[0]?.falsifying_signals || item.investor_view?.questions || [])[0], 10) || 'New evidence changes it.'
    }))

  const companyRows = companies.slice(0, 6).map(company => ({
    name: shortenLabel(company.ticker ? `${company.name} (${company.ticker})` : company.name, 8) || 'Company',
    direction: company.direction || 'watch',
    reason: shorten(company.why, 12),
    durability: durabilityFromImpact(company.thesis_impact)
  }))

  const lesson = lessons[0] || {}
  const predictions = forecasts.slice(0, 5).map(forecast => ({
    claim: shorten(forecast.claim, 12) || 'Forecast from source',
    horizon: shorten(forecast.horizon, 8) || 'Unclear horizon',
    confirming_signal: shorten((forecast.confirming_signals || [])[0], 14) || 'Follow-up evidence confirms the claim.',
    falsifying_signal: shorten((forecast.falsifying_signals || [])[0], 14) || 'Follow-up evidence contradicts the claim.'
  }))

  return {
    date,
    sixty_second_summary: take(bottomLines, 3, 'Not enough evidence for a full market summary.').slice(0, 5),
    main_stories: mainStories,
    markets,
    game_theory: gameTheory,
    historical_analogues: [],
    strategy_lab: {
      setup: shorten(primary?.video?.title, 18) || 'No single clean setup stood out.',
      style: 'avoid',
      thesis: shorten(primary?.investor_view?.thesis_change || primary?.investor_view?.signal_vs_noise, 16) || 'Use this to decide what to research, not what to buy.',
      confirmation_required: take(allQuestions, 2, 'Look for confirmation from later market data and multiple sources.').slice(0, 5),
      invalidation: take(allRisks, 2, 'If later evidence contradicts the core story, treat the setup as weak.').slice(0, 5),
      risk_control: 'Do not trade from a news digest.',
      why_not_to_trade: 'Captions and video claims are not enough proof.'
    },
    winners_losers: companyRows,
    long_term_investor: {
      what_changed: take(allSummaries, 3, 'Some market-relevant news appeared, but the evidence is thin.').slice(0, 6),
      what_did_not_change: [
        'A real investment still needs fundamentals, valuation, balance sheet, and competition.',
        'Short-term headlines are not automatically portfolio instructions.'
      ],
      no_action_case: 'If the news does not change a company thesis, observe or research instead of reacting.',
      research_tasks: take(allQuestions, 3, 'Pick one story and verify it against primary data.').slice(0, 6),
      portfolio_risks: take(allRisks, 3, 'Headline risk may fade quickly if not confirmed by data.').slice(0, 6)
    },
    consensus_disagreement: {
      agreement: take(keywordAgreement(analyses), 1, 'No strong cross-source agreement was detected mechanically.').slice(0, 6),
      disagreement: ['The local fallback raport does not deeply compare source disagreement; use the full Codex synthesis for that.'],
      single_source_claims: take(top.map(item => `${item.video?.source || 'Source'}: ${item.video?.title || 'Untitled video'}`), 3, 'No single-source claims listed.').slice(0, 6)
    },
    daily_lesson: {
      concept: compact(lesson.concept, 'Signal versus noise'),
      explanation: compact(lesson.plain_english || lesson.explanation, 'A useful investor separates information that can change long-term value from headlines that only create temporary attention.'),
      today_example: compact(lesson.example || primary?.summary?.[0], 'Use the highest-quality market story as a research starting point, not as a trade instruction.'),
      quiz: take(lesson.quiz || [], 2, 'What evidence would prove this story matters for long-term value?').slice(0, 3)
    },
    predictions_to_watch: predictions
  }
}
