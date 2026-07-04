import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { root } from './project.js'

export const settingsPath = resolve(root, '.finance-video', 'settings.json')

export async function loadSettings () {
  try {
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    return { redditEnabled: settings.redditEnabled === true }
  } catch (error) {
    if (error.code === 'ENOENT') return { redditEnabled: false }
    throw new Error(`Could not read ${settingsPath}: ${error.message}`)
  }
}
