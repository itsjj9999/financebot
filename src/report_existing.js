#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')

function run (script, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(root, 'src', script), ...args], {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit'
    })
    child.on('error', reject)
    child.on('close', code => {
      resolvePromise(code === 0)
    })
  })
}

async function main () {
  const args = process.argv.slice(2)
  if (args.includes('--help') || args.includes('-h')) {
    console.log('Usage: npm run raport -- [--date YYYY-MM-DD] [--force] [--local]')
    console.log('')
    console.log('Creates the daily analysis and PDF raport from already downloaded transcripts/structured evidence.')
    console.log('This command does not fetch YouTube again.')
    console.log('--local skips the full Codex synthesis and builds a readable raport from existing evidence cards.')
    return
  }

  console.log('Raport-only mode: using already gathered captions/evidence. No YouTube fetch will run.')
  if (!(await run('analyze.js', args))) process.exitCode = 1
}

main().catch(error => {
  console.error(`\nError: ${error.message}`)
  process.exitCode = 1
})
