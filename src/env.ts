/**
 * Every value that differs between environments is runtime configuration (AD-17).
 * Nothing environment-specific is hard-coded here; values come only from the process environment,
 * which on a host is filled from the root-owned secrets file of the `core` service.
 */

const isBuildPhase = process.env.NEXT_PHASE === 'phase-production-build'

function read(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    if (isBuildPhase) {
      // `next build` evaluates the config module; the image carries no configuration.
      return ''
    }
    throw new Error(`Missing required environment variable ${name}`)
  }
  return value
}

function assertOrigin(name: string, origin: string): void {
  let parsed: URL
  try {
    parsed = new URL(origin)
  } catch {
    throw new Error(`${name}: "${origin}" is not a URL`)
  }
  if (origin.includes('*') || parsed.origin !== origin) {
    throw new Error(`${name}: "${origin}" must be an exact origin (scheme://host[:port], no path)`)
  }
}

/** Comma-separated list of exact origins, e.g. `https://admin.piviki.fi`. Wildcards are refused. */
function readOrigins(name: string): string[] {
  const raw = read(name)
  if (!raw) return []
  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean)
  for (const origin of origins) assertOrigin(name, origin)
  return origins
}

/** One exact origin, e.g. `https://admin.piviki.fi`. */
function readOrigin(name: string): string {
  const origin = read(name)
  if (origin) assertOrigin(name, origin)
  return origin
}

export type CoreEnv = {
  databaseURL: string
  payloadSecret: string
  serverURL: string
  corsOrigins: string[]
  csrfOrigins: string[]
}

export function loadEnv(): CoreEnv {
  const payloadSecret = read('PAYLOAD_SECRET')
  if (!isBuildPhase && payloadSecret.length < 32) {
    throw new Error('PAYLOAD_SECRET must be at least 32 characters')
  }
  return {
    databaseURL: read('DATABASE_URL'),
    payloadSecret,
    serverURL: readOrigin('SERVER_URL'),
    corsOrigins: readOrigins('CORS_ORIGINS'),
    csrfOrigins: readOrigins('CSRF_ORIGINS'),
  }
}
