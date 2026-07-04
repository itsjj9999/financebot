import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { root } from './project.js'

export const settingsPath = resolve(root, '.finance-video', 'settings.json')

async function readRaw () {
  try {
    return JSON.parse(await readFile(settingsPath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return {}
    throw new Error(`Could not read ${settingsPath}: ${error.message}`)
  }
}

export async function loadSettings () {
  const settings = await readRaw()
  return {
    redditEnabled: settings.redditEnabled === true,
    // Saved analysis engine ("claude" or "codex"), or null if never chosen.
    analysisEngine: settings.analysisEngine === 'claude' || settings.analysisEngine === 'codex'
      ? settings.analysisEngine
      : null
  }
}

export async function saveSetting (key, value) {
  const settings = await readRaw()
  settings[key] = value
  await mkdir(dirname(settingsPath), { recursive: true })
  await writeFile(settingsPath, JSON.stringify(settings, null, 2), 'utf8')
}
