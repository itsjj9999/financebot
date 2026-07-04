#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import process from 'node:process'
import { paths } from './lib/project.js'

const path = resolve('watchlist.json')
const watchlist = JSON.parse(await readFile(path, 'utf8'))
const [command, name, ticker = ''] = process.argv.slice(2)

function slugify (value) {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[-\s]+/g, '-')
    .toLowerCase()
}

if (!command || command === 'list') {
  if (!watchlist.companies.length) console.log('Watchlist is empty.')
  else watchlist.companies.forEach(item => console.log(`${item.name}${item.ticker ? ` (${item.ticker})` : ''}`))
} else if (command === 'add') {
  if (!name) throw new Error('Usage: npm run watchlist -- add "Company Name" TICKER')
  if (!watchlist.companies.some(item => item.name.toLowerCase() === name.toLowerCase() || (ticker && item.ticker === ticker))) {
    watchlist.companies.push({ name, ticker: ticker.toUpperCase() })
  }
  await writeFile(path, JSON.stringify(watchlist, null, 2), 'utf8')
  const thesisFolder = resolve(paths.learning, 'company-theses')
  const thesisPath = resolve(thesisFolder, `${slugify(ticker || name)}.json`)
  await mkdir(thesisFolder, { recursive: true })
  try {
    await readFile(thesisPath, 'utf8')
  } catch {
    await writeFile(thesisPath, JSON.stringify({
      name,
      ticker: ticker.toUpperCase(),
      status: 'watchlist',
      thesis: '',
      risks: [],
      invalidationConditions: [],
      evidence: []
    }, null, 2), 'utf8')
  }
  console.log(`Added ${name}${ticker ? ` (${ticker.toUpperCase()})` : ''}.`)
} else if (command === 'remove') {
  const before = watchlist.companies.length
  watchlist.companies = watchlist.companies.filter(item =>
    item.name.toLowerCase() !== name?.toLowerCase() && item.ticker !== name?.toUpperCase()
  )
  await writeFile(path, JSON.stringify(watchlist, null, 2), 'utf8')
  console.log(before === watchlist.companies.length ? 'No matching company found.' : `Removed ${name}.`)
} else {
  throw new Error('Commands: list, add, remove')
}
