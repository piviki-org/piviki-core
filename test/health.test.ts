import type { Payload } from 'payload'

import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { GET } from '../src/app/api/v1/health/route'
import { testPayload } from './helpers'

let payload: Payload

beforeAll(async () => {
  ;({ payload } = await testPayload())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('GET /api/v1/health', () => {
  it('is 200 and not cached while the database answers', async () => {
    const res = await GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('is 503 with the error shape when the database query fails', async () => {
    vi.spyOn(payload.db.pool, 'query').mockRejectedValueOnce(new Error('connection refused') as never)
    const res = await GET()
    expect(res.status).toBe(503)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ error: { code: 'unavailable', message: 'Service unavailable' } })
  })
})
