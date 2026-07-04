#!/usr/bin/env node

import process from 'node:process'
import { folderNames } from './lib/project.js'
import { downloadTranscript } from './lib/transcript.js'

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

async function main () {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(HELP)
    return
  }
  if (!options.url) throw new Error(`A YouTube URL is required.\n\n${HELP}`)
  if (!options.lang) throw new Error('--lang requires a language code.')
  if (!options.out) throw new Error('--out requires a folder.')

  const { destination } = await downloadTranscript({
    url: options.url,
    lang: options.lang,
    outFolder: options.out,
    dateFolder: options.dateFolder
  })

  console.log(`\nCreated: ${destination}`)
  console.log('\nNext: upload this Markdown file to your private ChatGPT finance project and ask ChatGPT to analyze it.')
}

main().catch(error => {
  console.error(`\nError: ${error.message}`)
  process.exitCode = 1
})
