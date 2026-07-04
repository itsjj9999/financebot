#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { access, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { root } from './lib/project.js'
import { reportDate, validateReportDate } from './lib/time.js'

function parseArgs (argv) {
  const options = { date: reportDate(), force: false, model: 'base.en' }
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--date') options.date = validateReportDate(argv[++index])
    else if (value === '--force') options.force = true
    else if (value === '--podcast-model') options.model = argv[++index]
    else if (value === '--help' || value === '-h') options.help = true
    else throw new Error(`Unknown argument: ${value}`)
  }
  return options
}

async function exists (path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function pythonPath () {
  const windows = resolve(root, '.venv-transcribe', 'Scripts', 'python.exe')
  if (await exists(windows)) return windows
  const unix = resolve(root, '.venv-transcribe', 'bin', 'python')
  if (await exists(unix)) return unix
  throw new Error('Podcast transcription venv was not found. Create it with: py -3.12 -m venv .venv-transcribe; .\\.venv-transcribe\\Scripts\\python.exe -m pip install faster-whisper')
}

function run (command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit'
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolvePromise()
      else reject(new Error(`Podcast sync failed with exit code ${code}.`))
    })
  })
}

async function main () {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('Usage: node ./src/sync_podcasts.js [--date YYYY-MM-DD] [--force] [--podcast-model base.en|small.en|medium.en]')
    return
  }
  const sources = JSON.parse(await readFile(resolve(root, 'sources.json'), 'utf8'))
  const podcasts = sources.filter(source => source.type === 'podcast')
  if (!podcasts.length) {
    console.log('No podcast sources are configured in sources.json.')
    return
  }

  await run(await pythonPath(), [
    join(root, 'tools', 'sync_podcasts.py'),
    '--date', options.date,
    '--root', root,
    '--sources', resolve(root, 'sources.json'),
    '--model', options.model,
    ...(options.force ? ['--force'] : [])
  ])
}

main().catch(error => {
  console.error(`\nError: ${error.message}`)
  process.exitCode = 1
})
