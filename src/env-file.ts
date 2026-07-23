import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

export function resolveEnvFilePath(): string | null {
  const explicit = process.env.ML_ENV_FILE?.trim()
  if (explicit) return explicit

  const cwdFile = `${process.cwd()}/.env.local`
  if (existsSync(cwdFile)) return cwdFile

  return null
}

export function persistEnvVar(key: string, value: string): void {
  const filePath = resolveEnvFilePath()
  if (!filePath) return

  const content = existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''
  const line = `${key}=${value}`
  const regex = new RegExp(`^${escapeRegex(key)}=.*$`, 'm')

  const next = regex.test(content)
    ? content.replace(regex, line)
    : `${content.trimEnd()}${content ? '\n' : ''}${line}\n`

  const tmp = `${filePath}.tmp`
  writeFileSync(tmp, next, 'utf8')
  renameSync(tmp, filePath)
  process.env[key] = value
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
