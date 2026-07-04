#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'

function bullets (items) {
  return items.map(item => `- ${item}`).join('\n')
}

function render (review) {
  const lines = [
    `# Weekly Market Learning Review - ${review.week_ending}`,
    '',
    '## Week in five points',
    '',
    bullets(review.week_in_five_points),
    '',
    '## What actually mattered',
    '',
    bullets(review.what_mattered),
    '',
    '## What was mostly noise',
    '',
    bullets(review.what_was_noise),
    '',
    '## Prediction scorecard',
    ''
  ]
  for (const item of review.prediction_scorecard) {
    lines.push(`- **${item.status}: ${item.claim}** Evidence: ${item.evidence} Calibration lesson: ${item.calibration_lesson}`)
  }
  lines.push(
    '',
    '## Market regime',
    '',
    `- **Growth:** ${review.regime.growth}`,
    `- **Inflation:** ${review.regime.inflation}`,
    `- **Rates:** ${review.regime.rates}`,
    `- **Liquidity:** ${review.regime.liquidity}`,
    `- **Risk appetite:** ${review.regime.risk_appetite}`,
    `- **Confidence:** ${review.regime.confidence}`,
    '',
    '## Historical-parallel update',
    '',
    bullets(review.historical_update),
    '',
    '## Lessons learned',
    '',
    bullets(review.lessons),
    '',
    '## What to watch next week',
    '',
    bullets(review.next_week)
  )
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

const input = process.argv[2]
const output = process.argv[3]
if (!input || !output) {
  console.error('Usage: node ./src/render_weekly.js <review.json> <review.md>')
  process.exit(1)
}
const review = JSON.parse(await readFile(resolve(input), 'utf8'))
await writeFile(resolve(output), render(review), 'utf8')
