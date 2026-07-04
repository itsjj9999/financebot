import { spawn } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..', '..')
const codexEntry = resolve(root, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')

export function checkCodexLogin () {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [codexEntry, 'login', 'status'], {
      cwd: root,
      windowsHide: true,
      stdio: 'ignore'
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolvePromise()
      else reject(new Error('Codex is not signed in. Run "npx codex login" once, complete the browser login, then retry.'))
    })
  })
}

export async function runCodexStructured ({ prompt, input, schema, output }) {
  await mkdir(dirname(output), { recursive: true })
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [
      codexEntry,
      'exec',
      '--ephemeral',
      '--sandbox', 'read-only',
      '--skip-git-repo-check',
      '--output-schema', schema,
      '--output-last-message', output,
      prompt
    ], {
      cwd: root,
      windowsHide: true,
      stdio: ['pipe', 'inherit', 'inherit']
    })
    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) resolvePromise()
      else reject(new Error(`Codex analysis failed with exit code ${code}.`))
    })
    child.stdin.end(input)
  })
}

export async function runCodexStructuredFile ({ prompt, inputPath, schema, output }) {
  return runCodexStructured({
    prompt,
    input: await readFile(inputPath),
    schema,
    output
  })
}
