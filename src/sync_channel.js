#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  access,
  mkdir,
  readFile,
  writeFile
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { folderNames, paths } from './lib/project.js'
import { dateInTimeZone, reportDate, validateReportDate } from './lib/time.js'

const require = createRequire(import.meta.url)
const youtubeDl = require('youtube-dl-exec')
const binary = youtubeDl.constants.YOUTUBE_DL_PATH
const root = resolve(import.meta.dirname, '..')

const HELP = `
Sync new captioned videos from a YouTube channel.

Usage:
  npm run sync:bloomberg
  node ./src/sync_channel.js [channel-url] [options]

Options:
  --limit <number>  Number of newest uploads to inspect (default: 10)
  --lang <code>     Preferred caption language (default: en)
  --video-delay     Seconds between videos (default: 12)
  --source-name     Display name used in the daily packet
  --source-slug     Stable folder/packet name
  --date            Report date (default: today)
  --skip-title-keywords  JSON array or comma list of title words to skip
  --help            Show this help

The first run processes up to --limit videos. Later runs skip videos already
recorded in .finance-video/state.json.
`.trim()

function parseArgs (argv) {
  const options = {
    channel: 'https://www.youtube.com/@markets/videos',
    limit: 10,
    lang: 'en',
    videoDelay: 12,
    date: reportDate(),
    skipTitleKeywords: []
  }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--help' || value === '-h') options.help = true
    else if (value === '--limit') options.limit = Number(argv[++index])
    else if (value === '--lang') options.lang = argv[++index]
    else if (value === '--video-delay') options.videoDelay = Number(argv[++index])
    else if (value === '--source-name') options.sourceName = argv[++index]
    else if (value === '--source-slug') options.sourceSlug = argv[++index]
    else if (value === '--date') options.date = validateReportDate(argv[++index])
    else if (value === '--skip-title-keywords') options.skipTitleKeywords = parseKeywordList(argv[++index])
    else if (!value.startsWith('-')) options.channel = value
    else throw new Error(`Unknown argument: ${value}`)
  }
  if (!Number.isInteger(options.limit) || options.limit < 1 || options.limit > 100) {
    throw new Error('--limit must be a whole number from 1 to 100.')
  }
  if (!Number.isFinite(options.videoDelay) || options.videoDelay < 0 || options.videoDelay > 300) {
    throw new Error('--video-delay must be between 0 and 300 seconds.')
  }
  return options
}

function parseKeywordList (value = '') {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) return parsed.map(item => String(item).trim()).filter(Boolean)
  } catch {
    // Fall through to comma parsing.
  }
  return value.split(',').map(item => item.trim()).filter(Boolean)
}

function titleHasKeyword (title = '', keywords = []) {
  const normalized = title.toLowerCase()
  return keywords.some(keyword => normalized.includes(keyword.toLowerCase()))
}

function sleep (milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))
}

function run (command, args, { show = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
      if (show) process.stdout.write(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
      if (show) process.stderr.write(chunk)
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolvePromise({ stdout, stderr })
      else reject(new Error(stderr.trim() || stdout.trim() || `Command failed with code ${code}`))
    })
  })
}

async function runWithBackoff (command, args, options = {}) {
  const waits = [15000, 30000, 60000]
  for (let attempt = 0; attempt <= waits.length; attempt += 1) {
    try {
      return await run(command, args, options)
    } catch (error) {
      const rateLimited = /(?:HTTP Error )?429|Too Many Requests/i.test(error.message)
      if (!rateLimited || attempt === waits.length) throw error
      const seconds = waits[attempt] / 1000
      console.log(`YouTube rate limit detected while checking the channel. Waiting ${seconds} seconds...`)
      await sleep(waits[attempt])
    }
  }
}

function slugify (value) {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[-\s]+/g, '-')
    .toLowerCase()
    .slice(0, 80) || 'youtube-channel'
}

async function exists (path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function loadState (path) {
  if (!(await exists(path))) return { channels: {} }
  return JSON.parse(await readFile(path, 'utf8'))
}

function videoUrl (entry) {
  return entry.webpage_url || entry.url?.startsWith('http')
    ? entry.webpage_url || entry.url
    : `https://www.youtube.com/watch?v=${entry.id}`
}

async function buildDailyPacket (date, channelSlug, items) {
  if (!items.length) return null
  const folder = resolve(paths.dailyBundles, date)
  await mkdir(folder, { recursive: true })
  const destination = join(folder, `${channelSlug}-source.md`)
  const sections = []

  sections.push(`# Daily source packet - ${date}`)
  sections.push('')
  sections.push('Create one concise daily market brief from these videos. Remove repeated stories. Explain market moves in plain English. Separate reported facts from forecasts. Use four sections: main story, markets and outlook, winners and losers, and long-term investor view.')
  sections.push('')
  sections.push(`Videos included: ${items.length}`)

  for (const item of items) {
    const transcript = await readFile(item.path, 'utf8')
    sections.push('')
    sections.push('---')
    sections.push('')
    sections.push(transcript)
  }

  await writeFile(destination, sections.join('\n'), 'utf8')
  return destination
}

async function main () {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return
  }

  const stateFolder = resolve(root, '.finance-video')
  const statePath = join(stateFolder, 'state.json')
  await mkdir(stateFolder, { recursive: true })
  const state = await loadState(statePath)
  const channelKey = options.channel
  const channelState = state.channels[channelKey] || { processed: {} }

  console.log(`Checking the newest ${options.limit} ${options.sourceName || 'channel'} uploads...`)
  const listing = await runWithBackoff(binary, [
    '--flat-playlist',
    '--dump-json',
    '--playlist-end', String(options.limit),
    '--no-warnings',
    '--js-runtimes', 'node',
    '--sleep-requests', '0.75',
    '--extractor-retries', '5',
    '--retry-sleep', 'extractor:exp=2:30',
    options.channel
  ])

  const entries = listing.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line))
  const unseen = entries.filter(entry => entry.id && !channelState.processed[entry.id])
  const skippedByTitle = unseen.filter(entry => titleHasKeyword(entry.title, options.skipTitleKeywords))
  for (const entry of skippedByTitle) {
    const url = videoUrl(entry)
    channelState.processed[entry.id] = {
      title: entry.title,
      url,
      skippedAt: new Date().toISOString(),
      skipReason: 'Skipped by non-market title keyword.'
    }
  }
  const candidates = unseen.filter(entry => !titleHasKeyword(entry.title, options.skipTitleKeywords))

  if (skippedByTitle.length) {
    console.log(`Skipped ${skippedByTitle.length} obvious non-market video(s) by title before downloading captions.`)
  }
  if (!candidates.length) console.log('No new videos found.')
  else console.log(`Found ${candidates.length} new video(s).`)
  const created = []
  const skipped = skippedByTitle.map(entry => ({
    id: entry.id,
    title: entry.title,
    reason: 'Skipped by non-market title keyword.'
  }))

  // Process oldest first so the folder reads in chronological order.
  const ordered = candidates.reverse()
  for (let index = 0; index < ordered.length; index += 1) {
    const entry = ordered[index]
    const url = videoUrl(entry)
    console.log(`\nProcessing: ${entry.title || entry.id}`)
    try {
      const result = await run(process.execPath, [
        join(root, 'src', 'cli.js'),
        url,
        '--lang', options.lang,
        '--out', folderNames.rawText,
        '--date-folder'
      ], { show: true })
      const match = result.stdout.match(/Created:\s+(.+\.md)\s*$/m)
      if (!match) throw new Error('Transcript was created but its path could not be identified.')
      const transcriptPath = match[1].trim()
      created.push({ id: entry.id, title: entry.title, path: transcriptPath, url })
      channelState.processed[entry.id] = {
        title: entry.title,
        url,
        transcript: transcriptPath,
        syncedAt: new Date().toISOString()
      }
    } catch (error) {
      skipped.push({ id: entry.id, title: entry.title, reason: error.message })
      console.error(`Skipped: ${error.message.split(/\r?\n/)[0]}`)
    }
    if (index < ordered.length - 1 && options.videoDelay > 0) {
      console.log(`Waiting ${options.videoDelay} seconds before the next video...`)
      await sleep(options.videoDelay * 1000)
    }
  }

  state.channels[channelKey] = channelState
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf8')

  const channelSlug = options.sourceSlug || slugify(entries[0]?.channel || entries[0]?.uploader || 'youtube-channel')
  const date = options.date
  const todaysItems = Object.entries(channelState.processed)
    .filter(([, item]) => item.syncedAt && dateInTimeZone(item.syncedAt) === date)
    .map(([id, item]) => ({ id, ...item, path: item.transcript }))
  const packet = await buildDailyPacket(date, channelSlug, todaysItems)
  const runFolder = resolve(paths.dailyBundles, date)
  await mkdir(runFolder, { recursive: true })
  await writeFile(
    join(runFolder, `${channelSlug}-sync-summary.json`),
    JSON.stringify({
      channel: options.channel,
      runAt: new Date().toISOString(),
      created,
      skipped
    }, null, 2),
    'utf8'
  )

  console.log(`\nSync complete: ${created.length} transcript(s) created, ${skipped.length} skipped.`)
  if (packet) {
    console.log(`Daily source packet: ${packet}`)
    console.log('Next: ask Codex, "Analyze today\'s daily source packet and create the daily brief PDF."')
  }
}

main().catch(error => {
  console.error(`\nError: ${error.message}`)
  process.exitCode = 1
})
