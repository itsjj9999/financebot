#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { reportDate } from './lib/time.js'
import { checkEngineLogin, runStructured } from './lib/engine.js'
import { exists, root, paths } from './lib/project.js'

function parseArgs (argv) {
  const options = { ending: reportDate(), force: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--ending') options.ending = argv[++index]
    else if (value === '--since') options.since = argv[++index]
    else if (value === '--force') options.force = true
    else if (value === '--help' || value === '-h') options.help = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  return options
}

function lastSevenDates (ending) {
  const end = new Date(`${ending}T12:00:00Z`)
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(end)
    date.setUTCDate(end.getUTCDate() - (6 - offset))
    return date.toISOString().slice(0, 10)
  })
}

function dateRange (since, ending) {
  const start = new Date(`${since}T12:00:00Z`)
  const end = new Date(`${ending}T12:00:00Z`)
  if (Number.isNaN(start.getTime())) throw new Error(`Invalid --since date: ${since}`)
  if (Number.isNaN(end.getTime())) throw new Error(`Invalid --ending date: ${ending}`)
  if (start > end) throw new Error('--since must not be after --ending.')
  const dates = []
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    dates.push(cursor.toISOString().slice(0, 10))
  }
  return dates
}

function runScript (script, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(root, 'src', script), ...args], {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit'
    })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolvePromise() : reject(new Error(`${script} failed with exit code ${code}.`)))
  })
}

function cleanJsonText (text) {
  return text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
}

async function loadWeek (dates) {
  const dailyBriefs = []
  const evidence = []
  for (const date of dates) {
    const dailyPath = resolve(paths.analysis, 'daily briefs', date, 'daily-market-brief.json')
    if (await exists(dailyPath)) dailyBriefs.push(JSON.parse(await readFile(dailyPath, 'utf8')))

    const structuredFolder = resolve(paths.analysis, 'evidence cards', date)
    if (!(await exists(structuredFolder))) continue
    const sourceFolders = (await readdir(structuredFolder, { withFileTypes: true })).filter(item => item.isDirectory())
    for (const sourceFolder of sourceFolders) {
      const folder = join(structuredFolder, sourceFolder.name)
      for (const file of await readdir(folder)) {
        if (!file.endsWith('.json')) continue
        evidence.push(JSON.parse(await readFile(join(folder, file), 'utf8')))
      }
    }
  }
  return { dailyBriefs, evidence }
}

async function updatePredictionReviews (review, weekEnding) {
  const path = resolve(paths.learning, 'predictions.json')
  if (!(await exists(path))) return
  const journal = JSON.parse(await readFile(path, 'utf8'))
  for (const score of review.prediction_scorecard) {
    const prediction = journal.predictions.find(item => item.claim.trim().toLowerCase() === score.claim.trim().toLowerCase())
    if (!prediction) continue
    prediction.status = score.status
    prediction.reviews.push({
      date: weekEnding,
      status: score.status,
      evidence: score.evidence,
      calibrationLesson: score.calibration_lesson
    })
  }
  await writeFile(path, JSON.stringify(journal, null, 2), 'utf8')
}

async function main () {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: npm run weekly -- [--ending YYYY-MM-DD] [--since YYYY-MM-DD] [--force]')
    console.log('')
    console.log('Without --since, reviews the trailing 7 days ending on --ending.')
    console.log('With --since, reviews every date from --since through --ending, inclusive,')
    console.log('regardless of length, skipping any dates with no daily brief.')
    return
  }
  const dates = options.since ? dateRange(options.since, options.ending) : lastSevenDates(options.ending)
  const { dailyBriefs, evidence } = await loadWeek(dates)
  if (!dailyBriefs.length) throw new Error('No daily briefs were found in the selected seven-day period.')

  const predictionsPath = resolve(paths.learning, 'predictions.json')
  const predictions = await exists(predictionsPath)
    ? JSON.parse(await readFile(predictionsPath, 'utf8')).predictions
    : []
  const relevantPredictions = predictions.filter(item =>
    item.created <= options.ending && item.status !== 'expired'
  ).slice(-30)

  const folder = resolve(paths.analysis, 'weekly reviews', options.ending)
  const pdfFolder = resolve(paths.pdfRaports, 'weekly raports', options.ending)
  const jsonOutput = resolve(folder, 'weekly-market-review.json')
  const mdOutput = resolve(folder, 'weekly-market-review.md')
  const pdfOutput = resolve(pdfFolder, `weekly-market-raport-${options.ending}.pdf`)
  await mkdir(folder, { recursive: true })
  await mkdir(pdfFolder, { recursive: true })

  if (options.force || !(await exists(jsonOutput))) {
    await checkEngineLogin()
    const input = {
      dates,
      daily_briefs: dailyBriefs,
      selected_video_evidence: evidence.filter(item => item.relevance.include && item.relevance.score >= 60),
      open_predictions: relevantPredictions
    }
    const prompt = `Create an investing-learning review covering ${dates[0]} through ${dates[dates.length - 1]} from the supplied daily briefs, evidence cards, and prediction journal. The supplied "dates" array is the full covered period; some dates may have no matching daily brief because nothing was gathered or analyzed that day, so the period may not be a clean single week or fully continuous.

Return only JSON matching the supplied schema.

Rules:
- Distinguish stories that persisted from stories that disappeared.
- Do not claim a prediction succeeded merely because it was repeated.
- Use exact prediction claim text from open_predictions in the scorecard.
- Mark predictions unresolved unless supplied evidence clearly supports or challenges them.
- Describe the market regime cautiously; this is a learning summary, not a trading signal.
- Explain what changed in the historical comparisons over the covered period.
- Keep every section concise and plain English.
- Do not invent market data or events.`

    await runStructured({
      prompt,
      input: JSON.stringify(input),
      schema: resolve(root, 'schemas', 'weekly-review.schema.json'),
      output: jsonOutput
    })
    const review = JSON.parse(cleanJsonText(await readFile(jsonOutput, 'utf8')))
    review.week_ending = options.ending
    await writeFile(jsonOutput, JSON.stringify(review, null, 2), 'utf8')
    await updatePredictionReviews(review, options.ending)
  }

  await runScript('render_weekly.js', [jsonOutput, mdOutput])
  await runScript('make_report.js', [mdOutput, pdfOutput])
  console.log(`\nWeekly review: ${mdOutput}`)
  console.log(`Weekly PDF: ${pdfOutput}`)
}

main().catch(error => {
  console.error(`\nError: ${error.message}`)
  process.exitCode = 1
})
