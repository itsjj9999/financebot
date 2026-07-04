import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { exists, root, paths } from './project.js'

function slugify (value) {
  return value
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[-\s]+/g, '-')
    .toLowerCase()
    .slice(0, 90) || 'item'
}

async function readJson (path, fallback) {
  if (!(await exists(path))) return fallback
  return JSON.parse(await readFile(path, 'utf8'))
}

export async function updatePredictionJournal (date, analyses) {
  const folder = paths.learning
  const path = resolve(folder, 'predictions.json')
  await mkdir(folder, { recursive: true })
  const journal = await readJson(path, { predictions: [] })
  const known = new Set(journal.predictions.map(item => item.id))

  for (const analysis of analyses) {
    for (const forecast of analysis.forecasts || []) {
      const fingerprint = `${analysis.video.id}|${forecast.claim}|${forecast.horizon}`
      const id = createHash('sha256').update(fingerprint).digest('hex').slice(0, 16)
      if (known.has(id)) continue
      known.add(id)
      journal.predictions.push({
        id,
        created: date,
        videoId: analysis.video.id,
        source: analysis.video.source,
        videoTitle: analysis.video.title,
        claim: forecast.claim,
        speaker: forecast.speaker,
        horizon: forecast.horizon,
        statedConfidence: forecast.confidence,
        evidence: forecast.evidence,
        confirmingSignals: forecast.confirming_signals,
        falsifyingSignals: forecast.falsifying_signals,
        timestamp: forecast.timestamp,
        status: 'open',
        reviews: []
      })
    }
  }

  await writeFile(path, JSON.stringify(journal, null, 2), 'utf8')
  return path
}

export async function updateCompanyLearning (date, analyses) {
  const learningFolder = paths.learning
  const thesesFolder = resolve(learningFolder, 'company-theses')
  await mkdir(thesesFolder, { recursive: true })
  const watchlist = await readJson(resolve(root, 'watchlist.json'), { companies: [] })
  const candidatesPath = resolve(learningFolder, 'research-candidates.json')
  const candidates = await readJson(candidatesPath, { companies: [] })
  const candidateMap = new Map(candidates.companies.map(item => [item.key, item]))

  const watched = new Map()
  for (const item of watchlist.companies || []) {
    const normalized = typeof item === 'string' ? { name: item, ticker: '' } : item
    watched.set(slugify(normalized.ticker || normalized.name), normalized)
  }

  for (const analysis of analyses) {
    for (const company of analysis.companies || []) {
      const key = slugify(company.ticker || company.name)
      const evidence = {
        date,
        source: analysis.video.source,
        videoId: analysis.video.id,
        videoTitle: analysis.video.title,
        direction: company.direction,
        why: company.why,
        thesisImpact: company.thesis_impact,
        metricsToWatch: company.metrics_to_watch
      }

      if (watched.has(key)) {
        const path = resolve(thesesFolder, `${key}.json`)
        const configured = watched.get(key)
        const thesis = await readJson(path, {
          name: configured.name || company.name,
          ticker: configured.ticker || company.ticker,
          status: 'watchlist',
          thesis: '',
          risks: [],
          invalidationConditions: [],
          evidence: []
        })
        if (!thesis.evidence.some(item => item.date === date && item.videoId === analysis.video.id)) {
          thesis.evidence.push(evidence)
        }
        await writeFile(path, JSON.stringify(thesis, null, 2), 'utf8')
      } else if (company.thesis_impact === 'material' || company.thesis_impact === 'potentially_material') {
        const existing = candidateMap.get(key) || {
          key,
          name: company.name,
          ticker: company.ticker,
          mentions: 0,
          lastSeen: date,
          reasons: []
        }
        existing.mentions += 1
        existing.lastSeen = date
        if (!existing.reasons.includes(company.why)) existing.reasons.push(company.why)
        existing.reasons = existing.reasons.slice(-5)
        candidateMap.set(key, existing)
      }
    }
  }

  candidates.companies = [...candidateMap.values()]
    .sort((a, b) => b.mentions - a.mentions || b.lastSeen.localeCompare(a.lastSeen))
  await writeFile(candidatesPath, JSON.stringify(candidates, null, 2), 'utf8')
  return { thesesFolder, candidatesPath }
}

export { slugify }
