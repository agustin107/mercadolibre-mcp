import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { persistEnvVar, resolveEnvFilePath } from '../src/env-file.js'

function fingerprint(path: string): string | null {
  if (!existsSync(path)) return null
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex')
  return `${statSync(path).mtimeMs}:${hash}`
}

test('tests persist tokens only to a temp file, never to cwd/.env.local', () => {
  const real = `${process.cwd()}/.env.local`
  const before = fingerprint(real)

  const resolved = resolveEnvFilePath()
  assert.ok(resolved, 'a temp env file must be configured for tests')
  assert.notEqual(resolved, real)
  assert.ok(resolved.startsWith(tmpdir()), 'env file must live under os.tmpdir()')

  persistEnvVar('ML_TEST_ISOLATION_PROBE', 'probe')
  assert.match(readFileSync(resolved, 'utf8'), /ML_TEST_ISOLATION_PROBE=probe/)
  delete process.env.ML_TEST_ISOLATION_PROBE

  assert.equal(fingerprint(real), before, 'cwd/.env.local must be untouched')
})

test('under the test runner, no cwd/.env.local fallback even without ML_ENV_FILE', () => {
  const saved = process.env.ML_ENV_FILE
  delete process.env.ML_ENV_FILE
  try {
    assert.equal(resolveEnvFilePath(), null)
  } finally {
    if (saved === undefined) delete process.env.ML_ENV_FILE
    else process.env.ML_ENV_FILE = saved
  }
})
