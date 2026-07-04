#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { checkCodexLogin, runCodexStructured } from './lib/codex.js'
import {
  latestDailyDate,
  parseTranscriptMetadata,
  root,
  paths,
  transcriptsForSyncDate,
  exists
} from './lib/project.js'
import { isMarketRelevant, normalizeRelevanceScore } from './lib/relevance.js'

function parseArgs (argv) {
  const options = { force: false, date: null }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--force') options.force = true
    else if (value === '--date') options.date = argv[++index]
    else if (value === '--local') options.local = true
    else if (value === '--help' || value === '-h') options.help = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  return options
}

function cleanJsonText (text) {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
}

async function analyzeVideo (item, date, force) {
  const folder = resolve(paths.analysis, 'evidence cards', date, item.sourceSlug)
  const output = resolve(folder, `${item.id}.json`)
  if (!force && await exists(output)) {
    console.log(`Already analyzed: ${item.title}`)
    return JSON.parse(await readFile(output, 'utf8'))
  }

  const transcript = await readFile(item.transcript, 'utf8')
  const metadata = parseTranscriptMetadata(transcript, item)
  const redditRules = metadata.sourceType === 'reddit'
    ? `
Reddit-specific restrictions:
- This input is a headline/post signal, not an independently verified news report.
- Do not place Reddit-only claims in facts, market_moves, forecasts, actors, or companies.
- Use Reddit only to identify a topic that may corroborate or differ from other gathered sources.
- Keep relevance.include=true only when the headline identifies a concrete market-relevant event.
- Set source-quality missing context to high.
- No comments or linked webpages were collected.`
    : ''
  const prompt = `Analyze one finance/news source item for an educational long-term investor.

Return only JSON matching the supplied schema.

Rules:
- Use the transcript as the primary source.
- Do not invent tickers, prices, percentages, speakers, or events.
- Timestamp fields must use a timestamp shown in the transcript, such as "12:34".
- Distinguish reported facts, interpretation, and forecasts.
- Score relevance to markets, economics, companies, investing, or strategically important geopolitics.
- Relevance score must be on a 0-100 scale, where 0 means no market value and 100 means extremely useful for a market/investing daily brief.
- Set relevance.include=false when the video offers little useful market or investing information.
- Actor analysis is game theory: identify what each player wants, constraints, leverage, and likely next move.
- "Likely next move" must be cautious and confidence-rated.
- The long-term investor default should often be observe or no_action.
- Keep explanations plain, compact, and free of business jargon.
- Extract forecasts only when somebody actually predicts a future outcome.
- Caption source is "${metadata.captionSource}". Increase caption risk when it is auto-generated.
${redditRules}

Source metadata:
${JSON.stringify(metadata)}`

  await mkdir(folder, { recursive: true })
  console.log(`Analyzing source: ${item.title}`)
  await runCodexStructured({
    prompt,
    input: transcript,
    schema: resolve(root, 'schemas', 'video-analysis.schema.json'),
    output
  })
  const analysis = normalizeRelevanceScore(JSON.parse(cleanJsonText(await readFile(output, 'utf8'))))
  await writeFile(output, JSON.stringify(analysis, null, 2), 'utf8')
  return analysis
}

async function main () {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: node ./src/analyze_videos.js [--date YYYY-MM-DD] [--force] [--local]')
    return
  }
  const date = options.date || await latestDailyDate()
  const runManifestPath = resolve(paths.dailyBundles, date, 'run-manifest.json')
  let videos = []
  if (await exists(runManifestPath)) {
    const runManifest = JSON.parse(await readFile(runManifestPath, 'utf8'))
    const all = await transcriptsForSyncDate(date)
    const byId = new Map(all.map(item => [item.id, item]))
    const candidates = []
    for (const item of runManifest.created || []) {
      const direct = item.transcript && await exists(item.transcript)
        ? { ...item, syncedAt: item.syncedAt || runManifest.generatedAt }
        : byId.get(item.id)
      if (!direct) continue
      if (!direct.title || !direct.url || !direct.published) {
        const transcript = await readFile(direct.transcript, 'utf8')
        Object.assign(direct, parseTranscriptMetadata(transcript, direct))
      }
      candidates.push(direct)
    }
    videos = candidates
    if (!videos.length) {
      const existingManifest = resolve(paths.analysis, 'evidence cards', date, 'manifest.json')
      if (await exists(existingManifest)) {
        console.log('No new source items in this sync; keeping the existing structured evidence.')
        return
      }
      videos = all.slice(0, 12)
      if (videos.length) {
        console.log(`Migration mode: no new items, so the ${videos.length} most recently synced items will seed the learning system.`)
      } else {
        throw new Error(`No new source items were created by the ${date} sync.`)
      }
    }
  } else {
    const all = await transcriptsForSyncDate(date)
    videos = all.slice(0, 12)
    if (all.length > videos.length) {
      console.log(`Migration mode: analyzing the 12 most recently synced videos out of ${all.length}.`)
    }
  }
  if (!videos.length) throw new Error(`No newly synced source items were found for ${date}.`)

  const needsCodex = options.force || await Promise.all(videos.map(video =>
    exists(resolve(paths.analysis, 'evidence cards', date, video.sourceSlug, `${video.id}.json`))
  )).then(results => results.some(found => !found))
  if (needsCodex) await checkCodexLogin()
  const analyses = []
  for (const video of videos) {
    analyses.push(await analyzeVideo(video, date, options.force))
  }

  const manifest = {
    date,
    generatedAt: new Date().toISOString(),
    total: analyses.length,
    included: analyses.filter(isMarketRelevant).length,
    analyses: videos.map(item => resolve(paths.analysis, 'evidence cards', date, item.sourceSlug, `${item.id}.json`))
  }
  const manifestPath = resolve(paths.analysis, 'evidence cards', date, 'manifest.json')
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), 'utf8')
  console.log(`\nStructured evidence manifest: ${manifestPath}`)
}

main().catch(error => {
  console.error(`\nError: ${error.message}`)
  process.exitCode = 1
})
