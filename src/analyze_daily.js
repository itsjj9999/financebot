#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { checkEngineLogin, runStructured, engineName } from './lib/engine.js'
import { updateCompanyLearning, updatePredictionJournal } from './lib/learning.js'
import { latestDailyDate, root, paths, exists } from './lib/project.js'
import { isMarketRelevant, normalizeRelevanceScore } from './lib/relevance.js'
import { buildLocalDailyBrief } from './lib/local_brief.js'
import { spawn } from 'node:child_process'

function parseArgs (argv) {
  const options = { date: null, force: false, local: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--date') options.date = argv[++index]
    else if (value === '--force') options.force = true
    else if (value === '--local') options.local = true
    else if (value === '--help' || value === '-h') options.help = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  return options
}

function cleanJsonText (text) {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
}

async function loadAnalyses (date) {
  const manifestPath = resolve(paths.analysis, 'evidence cards', date, 'manifest.json')
  if (!(await exists(manifestPath))) {
    throw new Error(`No structured analysis manifest exists for ${date}. Run "node ./src/analyze_videos.js --date ${date}" first.`)
  }
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  const analyses = []
  for (const path of manifest.analyses) {
    if (await exists(path)) analyses.push(normalizeRelevanceScore(JSON.parse(await readFile(path, 'utf8'))))
  }
  return analyses
}

function runScript (script, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(root, 'src', script), ...args], {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit'
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolvePromise()
      else reject(new Error(`${script} failed with exit code ${code}.`))
    })
  })
}

async function main () {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: node ./src/analyze_daily.js [--date YYYY-MM-DD] [--force] [--local]')
    return
  }
  const date = options.date || await latestDailyDate()
  const reportFolder = resolve(paths.analysis, 'daily briefs', date)
  const pdfFolder = resolve(paths.pdfRaports, 'daily raports', date)
  const jsonOutput = resolve(reportFolder, 'daily-market-brief.json')
  const markdownOutput = resolve(reportFolder, 'daily-market-brief.md')
  const pdfOutput = resolve(pdfFolder, `daily-market-raport-${date}.pdf`)
  await mkdir(reportFolder, { recursive: true })
  await mkdir(pdfFolder, { recursive: true })

  const allAnalyses = await loadAnalyses(date)
  let analyses = allAnalyses.filter(isMarketRelevant)
  if (!analyses.length) {
    const reviewed = allAnalyses
      .map(item => `- ${item.video?.source || 'Unknown source'}: ${item.video?.title || 'Untitled'} (score ${item.relevance?.score ?? 'unknown'}): ${item.relevance?.reason || 'No reason given.'}`)
      .join('\n')
    throw new Error(`No market-relevant videos passed the relevance filter for ${date}.\n\nReviewed videos:\n${reviewed}`)
  }

  const primaryAnalyses = analyses.filter(item => !item.video?.source?.startsWith('Reddit'))

  await updatePredictionJournal(date, primaryAnalyses)
  await updateCompanyLearning(date, primaryAnalyses)

  if (options.force || !(await exists(jsonOutput))) {
    const episodes = JSON.parse(await readFile(resolve(root, 'knowledge', 'historical-episodes.json'), 'utf8'))
    const sourceNames = [...new Set(analyses.map(item => item.video.source))]
    const synthesisInput = {
      date,
      sources: sourceNames,
      evidence_cards: analyses,
      allowed_historical_episodes: episodes
    }
    const prompt = `Create a KISS daily market note from structured video evidence cards.

Return only JSON matching the supplied schema.

Priorities:
- The reader is using this to avoid finance-bro talk, Bloomberg filler, and consultant language.
- Translate the news into plain human meaning.
- Write like a sharp friend explaining markets over coffee.
- Use the KISS principle: keep it simple, blunt, and useful.
- No business-school phrasing. No "market color", "constructive setup", "risk appetite", "thesis framework", "tailwinds/headwinds", or vague consultant words.
- If a phrase sounds like CNBC, rewrite it.
- Prefer direct labels: "What happened", "Why it matters", "Probably noise", "What to watch", "Do nothing unless".
- Merge repeated stories across sources.
- Put the 3 most useful points first.
- Use short sentences. One sentence per field when possible.
- Explain jargon only when unavoidable.
- Prefer 3 main stories, 6 market moves, 6 winners/losers, 2 game-theory setups, and 5 predictions.
- For game theory, name only the important players and answer: "What do they want?" and "What will they probably do?"
- Separate facts from inferred causes and speculation.
- "Ignore this" and "do nothing" are valid conclusions.
- Game theory means objectives, constraints, leverage, credible threats, and likely next moves.
- Select at most two historical analogues and only from allowed_historical_episodes.
- Do not claim history is repeating. Explain similarities, differences, clues, and why each analogy may fail.
- Do not invent historical returns or current market numbers.
- Include one simple strategy example. It is educational, not a recommendation: what would prove it right, what would prove it wrong, and why not to trade it.
- Highlight source agreement, disagreement, and claims supported by only one source.
- Reddit evidence cards are headline-only cross-check signals. They cannot establish facts, causes, forecasts, market moves, winners/losers, or thesis changes.
- Use Reddit only to note that an independently covered topic also appeared in selected Reddit communities.
- Do not treat multiple Reddit posts, cross-posts, or Reddit links to an existing publisher as independent confirmation.
- Do not add a sentiment section. Omit Reddit entirely when it adds no useful cross-source comparison.
- Select one daily lesson that directly explains today's news.
- Keep the content compact enough for a fast skim PDF.
- Every field must be a complete thought. Never end a field with dangling words like "was the", "more likely", "evidence is", "faster-than-expected", or any half sentence.`

    let brief
    if (options.local) {
      console.log(`Building local evidence-based brief from ${analyses.length} relevant evidence card(s)...`)
      brief = buildLocalDailyBrief(date, primaryAnalyses)
    } else {
      try {
        await checkEngineLogin()
        console.log(`Synthesizing ${analyses.length} relevant evidence card(s)...`)
        await runStructured({
          prompt,
          input: JSON.stringify(synthesisInput),
          schema: resolve(root, 'schemas', 'daily-brief.schema.json'),
          output: jsonOutput
        })
        brief = JSON.parse(cleanJsonText(await readFile(jsonOutput, 'utf8')))
      } catch (error) {
        console.warn(`Full ${await engineName()} synthesis unavailable: ${error.message}`)
        console.warn('Building a local evidence-based brief instead, so the PDF is still created.')
        brief = buildLocalDailyBrief(date, primaryAnalyses)
      }
    }
    brief.date = date
    await writeFile(jsonOutput, JSON.stringify(brief, null, 2), 'utf8')
  } else {
    console.log(`Using existing daily synthesis: ${jsonOutput}`)
  }

  await runScript('render_daily.js', [jsonOutput, markdownOutput])
  await runScript('make_report.js', [markdownOutput, pdfOutput])
  console.log(`\nDaily brief: ${markdownOutput}`)
  console.log(`Daily PDF: ${pdfOutput}`)
  console.log(`Prediction journal: ${resolve(paths.learning, 'predictions.json')}`)
  console.log(`Research candidates: ${resolve(paths.learning, 'research-candidates.json')}`)
}

main().catch(error => {
  console.error(`\nError: ${error.message}`)
  process.exitCode = 1
})
