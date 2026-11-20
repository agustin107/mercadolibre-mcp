// Preloaded for every test process (see the "test" script): points ML_ENV_FILE
// at a throwaway file so no test can ever persist tokens into a real .env.local.
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'ml-mcp-test-env-'))
const file = join(dir, '.env.local')
writeFileSync(file, '', 'utf8')
process.env.ML_ENV_FILE = file
