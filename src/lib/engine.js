import process from 'node:process'
import readline from 'node:readline/promises'
import { checkCodexLogin, runCodexStructured, runCodexStructuredFile } from './codex.js'
import { checkClaudeLogin, runClaudeStructured, runClaudeStructuredFile } from './claude.js'
import { loadSettings, saveSetting } from './settings.js'

// Which AI performs the analysis. Resolved in priority order:
//   1. ANALYSIS_ENGINE env var ("claude" or "codex") — always wins.
//   2. The engine saved in .finance-video/settings.json.
//   3. A one-time interactive prompt on first run (defaults to Claude).
// The resolved value is cached for the process lifetime.
let cached = null

function normalize (value) {
  const v = (value || '').toLowerCase()
  return v === 'claude' || v === 'codex' ? v : null
}

async function promptForEngine () {
  // Non-interactive (cron, piped) runs cannot prompt — default to Claude.
  if (!process.stdin.isTTY || !process.stdout.isTTY) return 'claude'
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    console.log('\nWhich AI should analyze your sources and write the raports?')
    console.log('  1) Claude  (Opus, via the Claude CLI)   [default]')
    console.log('  2) Codex   (via the OpenAI Codex CLI / ChatGPT subscription)')
    const answer = (await rl.question('Choose 1 or 2: ')).trim()
    return answer === '2' ? 'codex' : 'claude'
  } finally {
    rl.close()
  }
}

async function resolveEngine () {
  if (cached) return cached

  const fromEnv = normalize(process.env.ANALYSIS_ENGINE)
  if (fromEnv) {
    cached = fromEnv
    return cached
  }

  const { analysisEngine } = await loadSettings()
  if (analysisEngine) {
    cached = analysisEngine
    return cached
  }

  const chosen = await promptForEngine()
  await saveSetting('analysisEngine', chosen)
  console.log(`Saved analysis engine: ${chosen === 'claude' ? 'Claude' : 'Codex'}. Change it anytime in .finance-video/settings.json or with ANALYSIS_ENGINE.`)
  cached = chosen
  return cached
}

export async function engineName () {
  return (await resolveEngine()) === 'claude' ? 'Claude' : 'Codex'
}

export async function checkEngineLogin () {
  return (await resolveEngine()) === 'claude' ? checkClaudeLogin() : checkCodexLogin()
}

export async function runStructured (options) {
  return (await resolveEngine()) === 'claude' ? runClaudeStructured(options) : runCodexStructured(options)
}

export async function runStructuredFile (options) {
  return (await resolveEngine()) === 'claude' ? runClaudeStructuredFile(options) : runCodexStructuredFile(options)
}
