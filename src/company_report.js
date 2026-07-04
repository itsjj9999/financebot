#!/usr/bin/env node

import { spawn } from 'node:child_process'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'
import { paths } from './lib/project.js'

const root = resolve(import.meta.dirname, '..')

process.on('uncaughtException', error => {
  console.error(`\nError: ${error.message}`)
  process.exit(1)
})

function slugify (value) {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[-\s]+/g, '-')
    .toLowerCase()
}

function bullets (items, fallback = 'Not set yet.') {
  return items.length ? items.map(item => `- ${item}`).join('\n') : `- ${fallback}`
}

function runPdf (input, output) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [join(root, 'src', 'make_report.js'), input, output], {
      cwd: root,
      windowsHide: true,
      stdio: 'inherit'
    })
    child.on('error', reject)
    child.on('close', code => code === 0 ? resolvePromise() : reject(new Error(`PDF generation failed with exit code ${code}.`)))
  })
}

const query = process.argv.slice(2).join(' ')
if (!query) {
  console.error('Usage: npm run company -- "Company Name or Ticker"')
  process.exit(1)
}

const folder = resolve(paths.learning, 'company-theses')
try {
  await access(folder)
} catch {
  throw new Error('No company trackers exist yet. Add one with npm run watchlist -- add "Company" TICKER.')
}
const files = await readdir(folder)
const direct = `${slugify(query)}.json`
let selected = files.find(file => file === direct)
if (!selected) {
  for (const file of files.filter(file => file.endsWith('.json'))) {
    const item = JSON.parse(await readFile(join(folder, file), 'utf8'))
    if (item.name.toLowerCase().includes(query.toLowerCase()) || item.ticker.toLowerCase() === query.toLowerCase()) {
      selected = file
      break
    }
  }
}
if (!selected) throw new Error(`No watchlist thesis found for "${query}". Add it first with npm run watchlist -- add "Company" TICKER.`)

const thesis = JSON.parse(await readFile(join(folder, selected), 'utf8'))
const reportFolder = resolve(paths.analysis, 'company notes')
const pdfFolder = resolve(paths.pdfRaports, 'company raports')
await mkdir(reportFolder, { recursive: true })
await mkdir(pdfFolder, { recursive: true })
const stem = basename(selected, '.json')
const md = resolve(reportFolder, `${stem}.md`)
const pdf = resolve(pdfFolder, `${stem}.pdf`)

const lines = [
  `# ${thesis.name}${thesis.ticker ? ` (${thesis.ticker})` : ''} - Thesis Tracker`,
  '',
  `- **Status:** ${thesis.status}`,
  `- **Current thesis:** ${thesis.thesis || 'Not written yet. Add your own thesis to the JSON tracker.'}`,
  '',
  '## Main risks',
  '',
  bullets(thesis.risks),
  '',
  '## What would prove the thesis wrong',
  '',
  bullets(thesis.invalidationConditions),
  '',
  '## Evidence log',
  ''
]
if (!thesis.evidence.length) {
  lines.push('- No matching evidence has been collected yet.')
} else {
  for (const item of [...thesis.evidence].reverse()) {
    lines.push(`- **${item.date} - ${item.direction}:** ${item.why} _Thesis impact: ${item.thesisImpact}. Source: ${item.source}, ${item.videoTitle}. Metrics: ${item.metricsToWatch.join(', ') || 'none stated'}._`)
  }
}
await writeFile(md, lines.join('\n') + '\n', 'utf8')
await runPdf(md, pdf)
console.log(`Company raport: ${md}`)
console.log(`Company PDF: ${pdf}`)
