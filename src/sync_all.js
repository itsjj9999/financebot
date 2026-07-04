#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { paths } from './lib/project.js'
import { loadSettings } from './lib/settings.js'
import { reportDate } from './lib/time.js'

const root = resolve(import.meta.dirname, '..')

function parseArgs (argv) {
  const options = { limit: 10, lang: 'en', videoDelay: 12, sourceDelay: 20, podcastModel: 'base.en', podcasts: true, skipReddit: false }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--limit') options.limit = Number(argv[++index])
    else if (value === '--lang') options.lang = argv[++index]
    else if (value === '--video-delay') options.videoDelay = Number(argv[++index])
    else if (value === '--source-delay') options.sourceDelay = Number(argv[++index])
    else if (value === '--podcast-model') options.podcastModel = argv[++index]
    else if (value === '--skip-podcasts') options.podcasts = false
    else if (value === '--skip-reddit') options.skipReddit = true
    else if (value === '--help' || value === '-h') options.help = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error('--limit must be a whole number from 1 to 100.')
  }
  for (const [name, value] of [['--video-delay', options.videoDelay], ['--source-delay', options.sourceDelay]]) {
    if (!Number.isFinite(value) || value < 0 || value > 300) {
      throw new Error(`${name} must be between 0 and 300 seconds.`)
    }
  }
  return options
}

function sleep (milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))
}

function runSource (source, options, date) {
  return new Promise(resolvePromise => {
    console.log(`\n=== ${source.name} ===`)
    const child = spawn(process.execPath, [
      join(root, 'src', 'sync_channel.js'),
      source.url,
      '--limit', String(options.limit),
      '--lang', options.lang,
      '--video-delay', String(options.videoDelay),
      '--source-name', source.name,
      '--source-slug', source.slug,
      '--date', date,
      '--skip-title-keywords', JSON.stringify(source.skipTitleKeywords || [])
    ], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
      process.stderr.write(chunk)
    })
    child.on('close', code => resolvePromise({
      source: source.name,
      code,
      stdout,
      stderr
    }))
  })
}

function runPodcasts (options, date) {
  return new Promise(resolvePromise => {
    console.log('\n=== Podcast sources ===')
    const child = spawn(process.execPath, [
      join(root, 'src', 'sync_podcasts.js'),
      '--date', date,
      '--podcast-model', options.podcastModel
    ], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
      process.stderr.write(chunk)
    })
    child.on('close', code => resolvePromise({
      source: 'Podcast sources',
      code,
      stdout,
      stderr
    }))
  })
}

function runReddit (date) {
  return new Promise(resolvePromise => {
    console.log('\n=== Reddit sources ===')
    const child = spawn(process.execPath, [
      join(root, 'src', 'sync_reddit.js'),
      '--date', date
    ], {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
      process.stdout.write(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
      process.stderr.write(chunk)
    })
    child.on('close', code => resolvePromise({ source: 'Reddit sources', code, stdout, stderr }))
  })
}

async function combineDailyPackets (date, sources) {
  const folder = resolve(paths.dailyBundles, date)
  const sections = [
    `# Multi-source daily packet - ${date}`,
    '',
    `Sources: ${sources.map(source => source.name).join(', ')}.`,
    '',
    'Create one concise daily market brief. Merge duplicate stories, point out where sources disagree, and favor reported facts over commentary. Use four sections: main story, markets and outlook, winners and losers, and long-term investor view.'
  ]
  let included = 0

  for (const source of sources) {
    const path = join(folder, `${source.slug}-source.md`)
    try {
      const contents = await readFile(path, 'utf8')
      sections.push('', '---', '', `# Source: ${source.name}`, '', contents)
      included += 1
    } catch {
      // A source may have no captioned videos from today's run.
    }
  }

  if (!included) return null
  await mkdir(folder, { recursive: true })
  const destination = join(folder, 'all-sources-daily-packet.md')
  await writeFile(destination, sections.join('\n'), 'utf8')
  return destination
}

async function main () {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: npm run sync -- [--limit 10] [--lang en] [--video-delay 12] [--source-delay 20] [--podcast-model base.en] [--skip-podcasts] [--skip-reddit]')
    return
  }

  const settings = await loadSettings()
  options.reddit = settings.redditEnabled && !options.skipReddit
  const sources = JSON.parse(await readFile(join(root, 'sources.json'), 'utf8'))
  const youtubeSources = sources.filter(source => source.type === 'youtube')
  const podcastSources = sources.filter(source => source.type === 'podcast')
  const redditSources = sources.filter(source => source.type === 'reddit')
  const date = reportDate()
  console.log(`Checking ${youtubeSources.length} YouTube source(s), up to ${options.limit} newest upload(s) each.`)
  if (options.podcasts) console.log(`Checking ${podcastSources.length} podcast source(s) for episodes published today.`)
  if (options.reddit) console.log(`Checking ${redditSources.length} Reddit source(s) for report-date posts without comments.`)
  else console.log('Reddit disabled. Run "python redditswitch.py enable" to enable it.')

  const results = []
  for (let index = 0; index < youtubeSources.length; index += 1) {
    const source = youtubeSources[index]
    results.push(await runSource(source, options, date))
    if (index < youtubeSources.length - 1 && options.sourceDelay > 0) {
      console.log(`\nWaiting ${options.sourceDelay} seconds before the next source...`)
      await sleep(options.sourceDelay * 1000)
    }
  }
  let podcastResult = null
  if (options.podcasts && podcastSources.length) {
    podcastResult = await runPodcasts(options, date)
    results.push(podcastResult)
  }
  if (options.reddit && redditSources.length) results.push(await runReddit(date))

  const activeSources = options.reddit ? sources : sources.filter(source => source.type !== 'reddit')
  const packet = await combineDailyPackets(date, activeSources)
  const created = []
  for (const result of results.filter(result => result.source !== 'Podcast sources')) {
    const source = youtubeSources.find(item => item.name === result.source)
    const matches = [...result.stdout.matchAll(/Created:\s+(.+\.md)\s*$/gm)]
    for (const match of matches) {
      const path = match[1].trim()
      const id = path.match(/-([A-Za-z0-9_-]{11})\.md$/)?.[1] || ''
      created.push({
        id,
        source: result.source,
        sourceSlug: source?.slug || 'unknown-source',
        transcript: path
      })
    }
  }
  const runFolder = resolve(paths.dailyBundles, date)
  await mkdir(runFolder, { recursive: true })
  const podcastSummaryPath = join(runFolder, 'podcasts-sync-summary.json')
  try {
    const podcastSummary = JSON.parse(await readFile(podcastSummaryPath, 'utf8'))
    for (const item of podcastSummary.created || []) {
      created.push({
        id: item.id,
        source: item.source,
        sourceSlug: item.sourceSlug,
        transcript: item.transcript
      })
    }
  } catch {
    // Podcast sync may have been skipped or found no matching episodes.
  }
  if (options.reddit) {
    const redditSummaryPath = join(runFolder, 'reddit-sync-summary.json')
    try {
      const redditSummary = JSON.parse(await readFile(redditSummaryPath, 'utf8'))
      created.push(...(redditSummary.created || []))
    } catch {
      // Reddit may be awaiting credentials or may have no matching posts.
    }
  }
  const runManifest = join(runFolder, 'run-manifest.json')
  await writeFile(runManifest, JSON.stringify({
    date,
    generatedAt: new Date().toISOString(),
    created
  }, null, 2), 'utf8')
  const failures = results.filter(result => result.code !== 0)

  console.log('\n=== All sources complete ===')
  console.log(`${results.length - failures.length} source(s) succeeded; ${failures.length} failed.`)
  if (packet) {
    console.log(`Combined daily packet: ${packet}`)
    console.log(`Run manifest: ${runManifest}`)
    console.log('Next: the analysis pipeline will build evidence cards and the daily PDF.')
  }
  if (failures.length) process.exitCode = 1
}

main().catch(error => {
  console.error(`\nError: ${error.message}`)
  process.exitCode = 1
})
