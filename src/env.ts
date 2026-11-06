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

/** The host's environment name (AD-17): one per host, from `/etc/piviki/environment` via deploy.sh. */
export const ENVIRONMENTS = ['local', 'test', 'production'] as const
export type Environment = (typeof ENVIRONMENTS)[number]

function readEnvironment(): Environment | '' {
  const value = read('ENVIRONMENT')
  if (!value) return ''
  if (!(ENVIRONMENTS as readonly string[]).includes(value)) {
    throw new Error(`ENVIRONMENT: "${value}" must be one of ${ENVIRONMENTS.join(', ')}`)
  }
  return value as Environment
}

/**
 * The naming rule that keeps one environment's host names out of another's configuration
 * (AD-17): on `test` every host has a first label `test` or starting `test-`; on `production`
 * none does; on `local` only `localhost` or `*.localhost`. deploy/checks.sh and
 * deploy/host-checks.mjs apply the same rule.
 */
export function hostAgrees(environment: Environment, host: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, '')
  const first = name.split('.')[0] ?? ''
  const testNamed = first === 'test' || first.startsWith('test-')
  switch (environment) {
    case 'test':
      return testNamed
    case 'production':
      return !testNamed
    case 'local':
      return name === 'localhost' || name.endsWith('.localhost')
  }
}

function assertHostsAgree(environment: Environment, name: string, origins: string[]): void {
  for (const origin of origins) {
    const host = new URL(origin).hostname
    if (!hostAgrees(environment, host)) {
      throw new Error(
        `${name}: "${origin}" is not a ${environment} host name (ENVIRONMENT=${environment}); refusing to start`,
      )
    }
  }
}

export type CoreEnv = {
  environment: Environment | ''
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
  const environment = readEnvironment()
  const serverURL = readOrigin('SERVER_URL')
  const corsOrigins = readOrigins('CORS_ORIGINS')
  const csrfOrigins = readOrigins('CSRF_ORIGINS')
  if (environment) {
    assertHostsAgree(environment, 'SERVER_URL', serverURL ? [serverURL] : [])
    assertHostsAgree(environment, 'CORS_ORIGINS', corsOrigins)
    assertHostsAgree(environment, 'CSRF_ORIGINS', csrfOrigins)
  }
  return {
    environment,
    databaseURL: read('DATABASE_URL'),
    payloadSecret,
    serverURL,
    corsOrigins,
    csrfOrigins,
  }
}
