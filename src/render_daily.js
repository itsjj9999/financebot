#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { plainEnglish, shortClean, shortPlain } from './lib/plain_english.js'

function array (value) {
  return Array.isArray(value) ? value : []
}

function clean (value) {
  return plainEnglish(value)
}

function shorten (value, maxWords = 28) {
  return shortPlain(value, maxWords, 'Not enough evidence.')
}

function shortenTitle (value, maxWords = 12) {
  return shortClean(value, maxWords, 'Untitled')
}

function withPeriod (value) {
  const text = clean(value)
  if (!text) return 'Not enough evidence.'
  return /[.!?]$/.test(text) ? text : `${text}.`
}

function upperFirst (value) {
  const text = clean(value)
  return text ? text[0].toUpperCase() + text.slice(1) : text
}

function lowerFirst (value) {
  const text = clean(value)
  return text ? text[0].toLowerCase() + text.slice(1) : text
}

function bullets (items, { maxItems = 5, maxWords = 28 } = {}) {
  return array(items)
    .filter(Boolean)
    .slice(0, maxItems)
    .map(item => `- ${shorten(item, maxWords)}`)
    .join('\n')
}

function pushBullets (sections, items, options = {}) {
  const rendered = bullets(items, options)
  sections.push(rendered || '- Not enough evidence.')
}

function storyLine (story) {
  return `- **${shortenTitle(story.headline, 10)}:** ${shorten(story.what_happened, 18)} **So what:** ${shorten(story.why_it_matters, 14)}`
}

function compactDirection (value) {
  return clean(value).replaceAll('_', ' ')
}

function render (brief) {
  const sections = [
    `# Daily Market Brief - ${brief.date}`,
    '',
    '> KISS version: plain English, less Bloomberg noise, only what is worth checking.',
    '',
    '## Bottom line',
    '',
    bullets(brief.sixty_second_summary, { maxItems: 3, maxWords: 14 }),
    ''
  ]

  sections.push('## What happened?', '')
  for (const story of array(brief.main_stories).slice(0, 3)) {
    sections.push(storyLine(story))
  }

  sections.push('', '## What moved?', '')
  for (const market of array(brief.markets).slice(0, 5)) {
    sections.push(`- **${shortenTitle(market.asset, 7)}:** ${withPeriod(shorten(market.move, 8))} Why: ${withPeriod(shorten(market.why, 12))}`)
  }

  sections.push('', '## Does this matter for a long-term investor?', '')
  sections.push(`- **Default:** ${shorten(brief.long_term_investor?.no_action_case, 18)}`)
  sections.push('- **Maybe matters:**')
  pushBullets(sections, brief.long_term_investor?.what_changed, { maxItems: 3, maxWords: 12 })
  sections.push('- **Ignore unless confirmed:**')
  pushBullets(sections, brief.long_term_investor?.portfolio_risks, { maxItems: 3, maxWords: 12 })
  sections.push('- **Check next:**')
  pushBullets(sections, brief.long_term_investor?.research_tasks, { maxItems: 3, maxWords: 12 })

  sections.push('', '## Stocks / companies mentioned', '')
  for (const item of array(brief.winners_losers).slice(0, 5)) {
    sections.push(`- **${shortenTitle(item.name, 7)} - ${compactDirection(item.direction)}:** ${withPeriod(shorten(item.reason, 12))}`)
  }

  sections.push('', '## Who wants what?', '')
  const games = array(brief.game_theory).slice(0, 2)
  if (!games.length) sections.push('- No useful player-vs-player setup stood out today.')
  for (const game of games) {
    sections.push(`### ${shortenTitle(game.story, 10)}`, '')
    for (const player of array(game.players).slice(0, 3)) {
      sections.push(`- **${upperFirst(shortenTitle(player.name, 5))}:** wants ${lowerFirst(withPeriod(shorten(player.wants, 10)))} Next: ${withPeriod(shorten(player.likely_move, 9))}`)
    }
    sections.push(`- **This changes if:** ${shorten(game.what_changes_the_game, 10)}`, '')
  }

  sections.push('## If I had to do one thing', '')
  sections.push(`- **Action:** ${shorten(brief.strategy_lab?.thesis, 16)}`)
  sections.push('- **Proof needed:**')
  pushBullets(sections, brief.strategy_lab?.confirmation_required, { maxItems: 2, maxWords: 10 })
  sections.push('- **Do not touch if:**')
  pushBullets(sections, brief.strategy_lab?.invalidation, { maxItems: 2, maxWords: 10 })

  const analogues = array(brief.historical_analogues).slice(0, 2)
  if (analogues.length) {
    sections.push('', '## Seen this before?', '')
    for (const analogue of analogues) {
      sections.push(`- **${shortenTitle(analogue.current_story, 8)} vs. ${shortenTitle(analogue.episode, 8)}:** similar: ${withPeriod(shorten(array(analogue.similarities).join(' '), 10))} different: ${withPeriod(shorten(array(analogue.differences).join(' '), 10))}`)
    }
  }

  sections.push('', '## Noise check', '')
  sections.push('- **Repeated by sources:**')
  pushBullets(sections, brief.consensus_disagreement?.agreement, { maxItems: 2, maxWords: 10 })
  sections.push('- **Weak / one-sided:**')
  pushBullets(sections, brief.consensus_disagreement?.disagreement, { maxItems: 2, maxWords: 10 })

  sections.push('', '## Learn one thing', '')
  sections.push(`- **Concept:** ${shorten(brief.daily_lesson?.concept, 8)}`)
  sections.push(`- **Meaning:** ${shorten(brief.daily_lesson?.explanation, 18)}`)
  sections.push(`- **Today:** ${shorten(brief.daily_lesson?.today_example, 16)}`)

  sections.push('', '## Watch tomorrow / later', '')
  for (const prediction of array(brief.predictions_to_watch).slice(0, 4)) {
    sections.push(`- **${withPeriod(shorten(prediction.claim, 12))}** True if: ${withPeriod(shorten(prediction.confirming_signal, 8))} Wrong if: ${withPeriod(shorten(prediction.falsifying_signal, 8))}`)
  }
  return sections.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

const input = process.argv[2]
const output = process.argv[3]
if (!input || !output) {
  console.error('Usage: node ./src/render_daily.js <brief.json> <brief.md>')
  process.exit(1)
}
const brief = JSON.parse(await readFile(resolve(input), 'utf8'))
await writeFile(resolve(output), render(brief), 'utf8')
