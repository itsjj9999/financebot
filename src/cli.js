#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, readdir, rm, mkdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'
import { folderNames } from './lib/project.js'

const require = createRequire(import.meta.url)
const youtubeDl = require('youtube-dl-exec')
const binary = youtubeDl.constants.YOUTUBE_DL_PATH

const HELP = `
finance-video — prepare a YouTube transcript for finance study in ChatGPT

Usage:
  finance-video <youtube-url> [options]
  npm start -- <youtube-url> [options]

Options:
  --lang <code>    Preferred caption language (default: en)
  --out <folder>   Output transcript folder (default: "./01 raw gathered text")
  --date-folder    Put the transcript inside a YYYY-MM-DD folder
  --help            Show this help

Caption policy:
  1. Creator-provided captions in the preferred language
  2. YouTube auto-generated captions in the preferred language

Videos without captions in the preferred language are skipped.
`.trim()

function parseArgs (argv) {
  const result = { lang: 'en', out: folderNames.rawText, url: null }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--help' || value === '-h') result.help = true
    else if (value === '--lang') result.lang = argv[++index]
    else if (value === '--out') result.out = argv[++index]
    else if (value === '--date-folder') result.dateFolder = true
    else if (!value.startsWith('-') && !result.url) result.url = value
    else throw new Error(`Unknown argument: ${value}`)
  }
  return result
}

function run (args, { quiet = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) return resolvePromise({ stdout, stderr })
      const useful = stderr.trim() || stdout.trim() || `yt-dlp exited with code ${code}`
      reject(new Error(useful))
    })
    if (!quiet) {
      child.stderr.on('data', chunk => {
        const text = chunk.toString()
        if (!text.includes('ffmpeg')) process.stderr.write(text)
      })
    }
  })
}

function sleep (milliseconds) {
  return new Promise(resolvePromise => setTimeout(resolvePromise, milliseconds))
}

async function runWithBackoff (args, options = {}) {
  const waits = [15000, 30000, 60000]
  for (let attempt = 0; attempt <= waits.length; attempt += 1) {
    try {
      return await run(args, options)
    } catch (error) {
      const rateLimited = /(?:HTTP Error )?429|Too Many Requests/i.test(error.message)
      if (!rateLimited || attempt === waits.length) throw error
      const seconds = waits[attempt] / 1000
      console.log(`YouTube rate limit detected. Waiting ${seconds} seconds before retry ${attempt + 2}/${waits.length + 1}...`)
      await sleep(waits[attempt])
    }
  }
}

function languageScore (code, wanted) {
  if (code === wanted) return 3
  if (code.toLowerCase().startsWith(`${wanted.toLowerCase()}-`)) return 2
  if (wanted.toLowerCase().startsWith(`${code.toLowerCase()}-`)) return 1
  return 0
}

function chooseTrack (metadata, wanted) {
  const groups = [
    { source: 'creator-provided', tracks: metadata.subtitles || {}, automatic: false },
    { source: 'youtube-auto-generated', tracks: metadata.automatic_captions || {}, automatic: true }
  ]

  for (const group of groups) {
    const matching = Object.keys(group.tracks)
      .map(code => ({ code, score: languageScore(code, wanted) }))
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
    if (matching.length) return { ...group, language: matching[0].code }
  }

  return null
}

function cleanText (text) {
  return text
    .replace(/\n/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

function parseJson3 (data) {
  const items = []
  for (const event of data.events || []) {
    if (!event.segs || event.tStartMs == null) continue
    const text = cleanText(event.segs.map(segment => segment.utf8 || '').join(''))
    if (!text || text === '[Music]' || text === '♪') continue
    items.push({
      start: Number(event.tStartMs) / 1000,
      end: (Number(event.tStartMs) + Number(event.dDurationMs || 0)) / 1000,
      text
    })
  }
  return items
}

function compactSegments (segments) {
  const output = []
  let current = null

  for (const segment of segments) {
    if (current && segment.text === current.lastText) continue
    if (!current) {
      current = { start: segment.start, end: segment.end, parts: [segment.text], lastText: segment.text }
      continue
    }

    const duration = segment.end - current.start
    const length = current.parts.join(' ').length
    const sentenceEnd = /[.!?]["']?$/.test(current.parts.at(-1))
    if (duration >= 35 || length >= 550 || (duration >= 18 && sentenceEnd)) {
      output.push(current)
      current = { start: segment.start, end: segment.end, parts: [segment.text], lastText: segment.text }
    } else {
      current.parts.push(segment.text)
      current.end = segment.end
      current.lastText = segment.text
    }
  }

  if (current) output.push(current)
  return output
}

function timestamp (seconds) {
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`
    : `${minutes}:${String(secs).padStart(2, '0')}`
}

function slugify (value) {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[-\s]+/g, '-')
    .toLowerCase()
    .slice(0, 90) || 'video'
}

function dateFromCompact (value) {
  if (!/^\d{8}$/.test(value || '')) return value || 'unknown'
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`
}

function buildMarkdown ({ metadata, track, chunks, url }) {
  const duration = metadata.duration_string || timestamp(metadata.duration || 0)
  const uploadDate = dateFromCompact(metadata.upload_date)
  const warning = track.automatic
    ? '> **Caption warning:** No suitable creator-provided captions were available. This file uses YouTube auto-generated captions, which may contain transcription errors.'
    : '> **Caption quality:** Creator-provided captions were used.'

  const transcript = chunks.map(chunk => {
    const seconds = Math.floor(chunk.start)
    const link = `${metadata.webpage_url || url}${(metadata.webpage_url || url).includes('?') ? '&' : '?'}t=${seconds}s`
    return `**[${timestamp(chunk.start)}](${link})** ${chunk.parts.join(' ')}`
  }).join('\n\n')

  return `# ${metadata.title}

## Video information

- **Channel:** ${metadata.channel || metadata.uploader || 'Unknown'}
- **Published:** ${uploadDate}
- **Duration:** ${duration}
- **Language:** ${track.language}
- **Caption source:** ${track.source}
- **Video:** ${metadata.webpage_url || url}
- **Video ID:** ${metadata.id}

${warning}

## Instructions for ChatGPT

Treat this transcript as the primary source for our discussion. Begin by producing:

1. A concise overview of the video's narrative.
2. The central financial or economic thesis.
3. The argument's progression from premise to conclusion.
4. Important claims, evidence, assumptions, and predictions.
5. The speaker's tone and framing: bullish, bearish, neutral, promotional, alarmist, or mixed.
6. Financial concepts I should learn to understand the video.
7. Plausible counterarguments and information that would verify or falsify the claims.

When answering later questions:

- Cite transcript timestamps using the links below.
- Separate what the speaker says from your own interpretation.
- Label facts, opinions, forecasts, and speculation.
- Explain finance terminology in plain language without oversimplifying it.
- Point out uncertainty, missing evidence, incentives, and possible bias.
- Do not present the video's claims as personalized financial advice.
- If the transcript does not support an answer, say so clearly.

## Timestamped transcript

${transcript}
`
}

async function main () {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return
  }
  if (!options.url) throw new Error(`A YouTube URL is required.\n\n${HELP}`)
  if (!options.lang) throw new Error('--lang requires a language code.')
  if (!options.out) throw new Error('--out requires a folder.')

  console.log('Inspecting video and available captions...')
  const metadataResult = await runWithBackoff([
    '--dump-single-json',
    '--skip-download',
    '--no-playlist',
    '--no-warnings',
    '--js-runtimes', 'node',
    '--sleep-requests', '0.75',
    '--extractor-retries', '5',
    '--retry-sleep', 'extractor:exp=2:30',
    options.url
  ], { quiet: true })
  const metadata = JSON.parse(metadataResult.stdout)
  const track = chooseTrack(metadata, options.lang)

  if (!track) {
    throw new Error(`This video has no creator-provided or YouTube auto-generated captions matching "${options.lang}".`)
  }

  const fallbackNote = track.automatic ? ' (automatic fallback)' : ''
  console.log(`Using ${track.source} captions: ${track.language}${fallbackNote}`)

  const temporary = await mkdtemp(join(tmpdir(), 'finance-video-'))
  try {
    const writeFlag = track.automatic ? '--write-auto-subs' : '--write-subs'
    await runWithBackoff([
      '--skip-download',
      '--no-playlist',
      '--no-warnings',
      '--js-runtimes', 'node',
      '--sleep-requests', '0.75',
      '--sleep-subtitles', '5',
      '--retries', '10',
      '--extractor-retries', '5',
      '--retry-sleep', 'http:exp=2:30',
      '--retry-sleep', 'extractor:exp=2:30',
      writeFlag,
      '--sub-langs', track.language,
      '--sub-format', 'json3',
      '--output', join(temporary, '%(id)s.%(ext)s'),
      options.url
    ], { quiet: true })

    const files = await readdir(temporary)
    const transcriptFile = files.find(name => name.endsWith('.json3'))
    if (!transcriptFile) throw new Error('YouTube listed captions, but the selected caption file could not be downloaded.')

    const raw = JSON.parse(await readFile(join(temporary, transcriptFile), 'utf8'))
    const segments = parseJson3(raw)
    if (!segments.length) throw new Error('The selected caption track was empty.')

    const chunks = compactSegments(segments)
    const channelFolder = slugify(metadata.channel || metadata.uploader || 'unknown-channel')
    const published = dateFromCompact(metadata.upload_date)
    const outputFolder = options.dateFolder
      ? resolve(options.out, channelFolder, published)
      : resolve(options.out, channelFolder)
    const filename = `${slugify(metadata.title)}-${metadata.id}.md`
    const destination = join(outputFolder, filename)
    await mkdir(outputFolder, { recursive: true })
    await writeFile(destination, buildMarkdown({ metadata, track, chunks, url: options.url }), 'utf8')

    console.log(`\nCreated: ${destination}`)
    console.log('\nNext: upload this Markdown file to your private ChatGPT finance project and ask ChatGPT to analyze it.')
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(`\nError: ${error.message}`)
  process.exitCode = 1
})
