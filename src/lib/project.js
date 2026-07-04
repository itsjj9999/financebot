import { access, readFile, readdir } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { dateInTimeZone } from './time.js'

export const root = resolve(import.meta.dirname, '..', '..')

export const folderNames = {
  rawText: '01 raw gathered text',
  dailyBundles: '02 daily source bundles',
  analysis: '03 analysis and evidence',
  pdfRaports: '04 pdf raports',
  learning: '05 learning tracker'
}

export const paths = {
  rawText: resolve(root, folderNames.rawText),
  dailyBundles: resolve(root, folderNames.dailyBundles),
  analysis: resolve(root, folderNames.analysis),
  pdfRaports: resolve(root, folderNames.pdfRaports),
  learning: resolve(root, folderNames.learning)
}

export async function exists (path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

export async function latestDailyDate () {
  const dailyRoot = paths.dailyBundles
  const folders = (await readdir(dailyRoot, { withFileTypes: true }))
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
    .sort()
    .reverse()
  if (!folders.length) throw new Error('No daily input exists. Run "npm run sync" first.')
  return folders[0]
}

export async function transcriptsForSyncDate (date) {
  const state = JSON.parse(await readFile(resolve(root, '.finance-video', 'state.json'), 'utf8'))
  const sources = JSON.parse(await readFile(resolve(root, 'sources.json'), 'utf8'))
  const sourceByUrl = new Map(sources.map(source => [source.url, source]))
  const items = []

  for (const [url, channel] of Object.entries(state.channels || {})) {
    const source = sourceByUrl.get(url) || { name: url, slug: 'unknown-source' }
    for (const [id, video] of Object.entries(channel.processed || {})) {
      if (!video.syncedAt || dateInTimeZone(video.syncedAt) !== date) continue
      if (!(await exists(video.transcript))) continue
      items.push({
        id,
        source: source.name,
        sourceSlug: source.slug,
        title: video.title,
        url: video.url,
        transcript: video.transcript,
        syncedAt: video.syncedAt
      })
    }
  }
  return items.sort((a, b) => b.syncedAt.localeCompare(a.syncedAt))
}

export function parseTranscriptMetadata (markdown, fallback = {}) {
  const lines = markdown.split(/\r?\n/)
  const get = label => {
    const prefix = `- **${label}:**`
    return lines.find(line => line.startsWith(prefix))?.slice(prefix.length).trim() || ''
  }
  const captionSource = get('Caption source')
  return {
    id: get('Video ID') || fallback.id || '',
    title: markdown.match(/^# (.+)$/m)?.[1]?.trim() || fallback.title || '',
    source: get('Channel') || fallback.source || '',
    published: get('Published'),
    url: get('Video') || fallback.url || '',
    captionSource,
    sourceType: get('Source type') || fallback.sourceType || (captionSource.startsWith('local-podcast') ? 'podcast' : 'youtube')
  }
}

export function videoIdFromPath (path) {
  return basename(path, '.md').split('-').at(-1)
}

export function dateFromReportPath (path) {
  return basename(dirname(resolve(path)))
}
