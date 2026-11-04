import type { Payload, SanitizedConfig } from 'payload'

import { getPayload } from 'payload'

let cached: { payload: Payload; config: SanitizedConfig } | undefined

/** Payload on the test database, migrated the way a deploy migrates before core starts. */
export async function testPayload(): Promise<{ payload: Payload; config: SanitizedConfig }> {
  if (cached) return cached
  const config = await (await import('../src/payload.config')).default
  const payload = await getPayload({ config })
  const { migrations } = await import('../src/migrations')
  await payload.db.migrate({ migrations: migrations as never })
  cached = { payload, config }
  return cached
}

export async function resetLibrarians(payload: Payload): Promise<void> {
  await payload.db.pool.query('truncate table librarians restart identity cascade')
}

export const SERVER = 'https://admin.piviki.test'

export function apiRequest(
  path: string,
  init: RequestInit & { json?: unknown } = {},
): Request {
  const headers = new Headers(init.headers)
  let body = init.body
  if (init.json !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(init.json)
  }
  return new Request(`${SERVER}${path}`, { ...init, headers, body })
}

export const GOOD_PASSWORD = 'correct-horse-battery'
