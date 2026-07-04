import { spawn } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import process from 'node:process'

// Model alias passed to `claude --model` (e.g. "sonnet", "opus", or a full model
// id). Configurable via CLAUDE_MODEL. Empty means the CLI's own default.
const CLAUDE_MODEL = process.env.CLAUDE_MODEL || 'opus'

// The `claude` binary is the agentic Claude Code CLI, not a plain completion API.
// To make it behave as a one-shot prompt -> JSON call we must:
//   1. Run from a neutral working directory so it does not wake up as a repo
//      agent and start reading project files instead of answering.
//   2. Disable extended thinking (MAX_THINKING_TOKENS=0); with thinking on, this
//      CLI returns an empty `result` field for large structured prompts.
//   3. Deny every built-in tool so it cannot take agentic detours.
// The JSON Schema is embedded in the prompt (not passed via --json-schema, which
// loops on large multi-object schemas) and the model is asked for raw JSON.
const NEUTRAL_CWD = tmpdir()
const DISABLED_TOOLS = 'Bash Read Write Edit Glob Grep WebFetch WebSearch Task TodoWrite NotebookEdit Skill'

function runClaude (args, { input, capture } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('claude', args, {
      cwd: NEUTRAL_CWD,
      windowsHide: true,
      env: { ...process.env, MAX_THINKING_TOKENS: '0' },
      stdio: ['pipe', capture ? 'pipe' : 'inherit', 'inherit']
    })
    let out = ''
    if (capture) child.stdout.on('data', chunk => { out += chunk })
    child.on('error', error => {
      if (error.code === 'ENOENT') {
        reject(new Error('Claude CLI not found. Install it and run "claude" once to sign in, then retry.'))
      } else {
        reject(error)
      }
    })
    child.on('close', code => {
      if (code === 0) resolvePromise(out)
      else reject(new Error(`Claude analysis failed with exit code ${code}.`))
    })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

// Extract a single JSON object from the model's text, tolerating markdown fences
// or a short natural-language preamble (e.g. "I'll analyze..."). Returns the
// matching JSON substring (validated by JSON.parse) or null if none parses.
function extractJson (text) {
  let body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  try {
    JSON.parse(body)
    return body
  } catch {}
  // Fall back to the widest {...} span and parse it.
  const first = body.indexOf('{')
  const last = body.lastIndexOf('}')
  if (first !== -1 && last > first) {
    const candidate = body.slice(first, last + 1)
    try {
      JSON.parse(candidate)
      return candidate
    } catch {}
  }
  return null
}

export async function checkClaudeLogin () {
  // A trivial print request succeeds only when the CLI is installed and signed in.
  const raw = await runClaude(['-p', 'Reply with OK.', '--output-format', 'json'], { capture: true })
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new Error('Claude CLI did not return a valid response. Run "claude" once to sign in, then retry.')
  }
  if (parsed.is_error) {
    throw new Error('Claude CLI is not signed in. Run "claude" once, complete the login, then retry.')
  }
}

export async function runClaudeStructured ({ prompt, input, schema, output }) {
  await mkdir(dirname(output), { recursive: true })
  const schemaText = await readFile(schema, 'utf8')
  const transcript = input === undefined
    ? ''
    : (Buffer.isBuffer(input) ? input.toString('utf8') : String(input))

  const fullPrompt = `${prompt}

Return ONLY a single JSON object that validates against the JSON Schema below. Your entire response must be raw JSON: start with "{" and end with "}". No markdown fences, no preamble, no explanation.

JSON SCHEMA:
${schemaText}

INPUT:
${transcript}`

  const args = ['-p', fullPrompt, '--output-format', 'json']
  if (CLAUDE_MODEL) args.push('--model', CLAUDE_MODEL)
  args.push('--disallowedTools', DISABLED_TOOLS)

  const raw = await runClaude(args, { capture: true })
  let envelope
  try {
    envelope = JSON.parse(raw)
  } catch {
    throw new Error('Claude CLI returned output that could not be parsed as JSON.')
  }
  if (envelope.is_error) {
    throw new Error(`Claude analysis reported an error: ${envelope.result || 'unknown error'}`)
  }
  const text = typeof envelope.result === 'string' ? envelope.result : JSON.stringify(envelope.result)
  if (!text.trim()) {
    throw new Error('Claude analysis returned an empty response.')
  }
  const structured = extractJson(text)
  if (!structured) {
    throw new Error('Claude analysis did not contain a parseable JSON object.')
  }
  await writeFile(output, structured, 'utf8')
  return structured
}

export async function runClaudeStructuredFile ({ prompt, inputPath, schema, output }) {
  return runClaudeStructured({
    prompt,
    input: await readFile(inputPath),
    schema,
    output
  })
}

// Kept for parity with codex.js in case callers resolve schema paths relatively.
export const schemaRoot = resolve(import.meta.dirname, '..', '..', 'schemas')
