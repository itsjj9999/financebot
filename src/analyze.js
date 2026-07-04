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
  const localMode = args.includes('--local')
  const videoArgs = localMode
    ? args.filter(value => value !== '--force' && value !== '--local')
    : args
  if (!(await run('analyze_videos.js', videoArgs))) {
    process.exitCode = 1
    return
  }
  if (!(await run('analyze_daily.js', args))) process.exitCode = 1
}

main().catch(error => {
  console.error(`\nError: ${error.message}`)
  process.exitCode = 1
})
