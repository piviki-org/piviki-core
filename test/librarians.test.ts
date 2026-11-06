import type { Payload, SanitizedConfig } from 'payload'

import { handleEndpoints } from 'payload'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { LIBRARIAN_SESSION_SECONDS } from '../src/collections/librarians'
import { apiRequest, GOOD_PASSWORD, resetLibrarians, testPayload } from './helpers'

let payload: Payload
let config: SanitizedConfig

const call = (request: Request) => handleEndpoints({ config, request })

async function createLibrarian(email = 'kirjastonhoitaja@example.test', password = GOOD_PASSWORD) {
  return payload.create({
    collection: 'librarians',
    data: { email, password },
    overrideAccess: true,
  })
}

async function login(email = 'kirjastonhoitaja@example.test', password = GOOD_PASSWORD) {
  return call(
    apiRequest('/api/librarians/login', { method: 'POST', json: { email, password } }),
  )
}

function isPasswordTooShort(error: unknown): boolean {
  const errors = (error as { data?: { errors?: { path: string; message: string }[] } }).data?.errors
  return Boolean(
    errors?.some((e) => e.path === 'password' && /at least 12 characters/.test(e.message)),
  )
}

const ADMIN_ORIGIN = { Origin: 'https://admin.localhost' }

function parseSetCookie(header: string) {
  const [pair, ...attrs] = header.split(';').map((p) => p.trim())
  const [name, ...rest] = pair.split('=')
  const attributes = new Map<string, string>()
  for (const attr of attrs) {
    const [k, ...v] = attr.split('=')
    attributes.set(k.toLowerCase(), v.join('='))
  }
  return { name, value: rest.join('='), attributes }
}

beforeAll(async () => {
  ;({ payload, config } = await testPayload())
})

beforeEach(async () => {
  await resetLibrarians(payload)
})

describe('librarian password', () => {
  it('refuses an 11-character password on create', async () => {
    await expect(createLibrarian('short@example.test', 'a'.repeat(11))).rejects.toSatisfy(
      isPasswordTooShort,
    )
    expect((await payload.count({ collection: 'librarians' })).totalDocs).toBe(0)
  })

  it('accepts a 12-character password', async () => {
    const doc = await createLibrarian('ok@example.test', 'a'.repeat(12))
    expect(doc.id).toBeDefined()
  })

  it('refuses an 11-character password on update', async () => {
    const doc = await createLibrarian()
    await expect(
      payload.update({
        collection: 'librarians',
        id: doc.id,
        data: { password: 'b'.repeat(11) },
        overrideAccess: true,
      }),
    ).rejects.toSatisfy(isPasswordTooShort)
  })

  it('refuses an 11-character password on reset', async () => {
    await createLibrarian()
    const token = await payload.forgotPassword({
      collection: 'librarians',
      data: { email: 'kirjastonhoitaja@example.test' },
      disableEmail: true,
    })
    await expect(
      payload.resetPassword({
        collection: 'librarians',
        data: { token, password: 'c'.repeat(11) },
        overrideAccess: true,
      }),
    ).rejects.toSatisfy(isPasswordTooShort)
  })

  it('never stores the plain password', async () => {
    await createLibrarian()
    const { rows } = await payload.db.pool.query(
      `select column_name from information_schema.columns where table_name = 'librarians'`,
    )
    expect(rows.map((r: { column_name: string }) => r.column_name)).not.toContain('password')
  })
})

describe('first-register', () => {
  it('returns 404 and creates nobody, even with no librarian yet', async () => {
    const res = await call(
      apiRequest('/api/librarians/first-register', {
        method: 'POST',
        json: { email: 'intruder@example.test', password: GOOD_PASSWORD },
      }),
    )
    expect(res.status).toBe(404)
    expect((await payload.count({ collection: 'librarians' })).totalDocs).toBe(0)
  })

  it('is refused by the hook if the operation is reached on that path', async () => {
    const librarians = config.collections.find((c) => c.slug === 'librarians')!
    const hook = librarians.hooks.beforeOperation[0]
    const req = { pathname: '/api/librarians/first-register', t: (k: string) => k }
    expect(() => hook({ args: {}, operation: 'create', req } as never)).toThrow()
    const ok = { pathname: '/api/librarians', t: (k: string) => k }
    expect(hook({ args: { a: 1 }, operation: 'create', req: ok } as never)).toEqual({ a: 1 })
  })
})

describe('librarian session cookie and responses', () => {
  it('sets a secure, HttpOnly, SameSite=Lax, host-only cookie of about 8 hours', async () => {
    await createLibrarian()
    const before = Date.now()
    const res = await login()
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toBeTruthy()
    const cookie = parseSetCookie(setCookie!)
    expect(cookie.name).toBe('payload-token')
    expect(cookie.value.length).toBeGreaterThan(0)
    expect(cookie.attributes.has('secure')).toBe(true)
    expect(cookie.attributes.has('httponly')).toBe(true)
    expect(cookie.attributes.get('samesite')).toBe('Lax')
    expect(cookie.attributes.has('domain')).toBe(false)
    expect(cookie.attributes.get('path')).toBe('/')
    const expires = Date.parse(cookie.attributes.get('expires')!)
    const seconds = (expires - before) / 1000
    expect(LIBRARIAN_SESSION_SECONDS).toBe(8 * 60 * 60)
    expect(seconds).toBeGreaterThan(LIBRARIAN_SESSION_SECONDS - 60)
    expect(seconds).toBeLessThan(LIBRARIAN_SESSION_SECONDS + 60)
  })

  it('leaves the token out of the login, me and refresh bodies', async () => {
    await createLibrarian()
    const res = await login()
    const body = await res.json()
    expect(body.user?.email).toBe('kirjastonhoitaja@example.test')
    expect(body).not.toHaveProperty('token')

    const cookie = parseSetCookie(res.headers.get('set-cookie')!)
    const auth = { ...ADMIN_ORIGIN, Cookie: `payload-token=${cookie.value}` }

    const me = await call(apiRequest('/api/librarians/me', { headers: auth }))
    const meBody = await me.json()
    expect(meBody.user?.email).toBe('kirjastonhoitaja@example.test')
    expect(meBody).not.toHaveProperty('token')

    const refresh = await call(
      apiRequest('/api/librarians/refresh-token', { method: 'POST', headers: auth }),
    )
    expect(refresh.status).toBe(200)
    expect(await refresh.json()).not.toHaveProperty('refreshedToken')
  })

  it('ignores the session cookie on a request from another origin (CSRF list is exact)', async () => {
    await createLibrarian()
    const cookie = parseSetCookie((await login()).headers.get('set-cookie')!)
    const me = await call(
      apiRequest('/api/librarians/me', {
        headers: { Origin: 'https://evil.example', Cookie: `payload-token=${cookie.value}` },
      }),
    )
    expect((await me.json()).user).toBeNull()
  })

  it('refuses a wrong password without saying whether the email exists', async () => {
    await createLibrarian()
    const wrong = await login('kirjastonhoitaja@example.test', 'not-the-password!')
    const missing = await login('nobody@example.test', 'not-the-password!')
    expect(wrong.status).toBe(401)
    expect(missing.status).toBe(401)
    expect((await wrong.json()).errors?.[0]?.message).toBe(
      (await missing.json()).errors?.[0]?.message,
    )
  })
})

describe('surfaces that stay off', () => {
  it('has no GraphQL endpoint', async () => {
    expect(config.graphQL.disable).toBe(true)
    const res = await call(
      apiRequest('/api/graphql', { method: 'POST', json: { query: '{ __typename }' } }),
    )
    expect(res.status).toBe(404)
  })

  it('refuses running jobs over HTTP, even for a librarian', async () => {
    const doc = await createLibrarian()
    const run = config.jobs.access!.run!
    expect(await run({ req: { user: { ...doc, collection: 'librarians' } } } as never)).toBe(false)

    const res = await login()
    const cookie = parseSetCookie(res.headers.get('set-cookie')!)
    const jobs = await call(
      apiRequest('/api/payload-jobs/run', {
        headers: { ...ADMIN_ORIGIN, Cookie: `payload-token=${cookie.value}` },
      }),
    )
    expect([401, 403, 404]).toContain(jobs.status)
  })
})

describe('deleting librarians', () => {
  it('a librarian may delete another librarian, but not their own account', async () => {
    const a = await createLibrarian('a@example.test')
    const b = await createLibrarian('b@example.test')
    const res = await login('a@example.test')
    const token = parseSetCookie(res.headers.get('set-cookie')!).value
    const del = (id: number | string) =>
      call(
        apiRequest(`/api/librarians/${id}`, {
          method: 'DELETE',
          headers: { ...ADMIN_ORIGIN, Cookie: `payload-token=${token}` },
        }),
      )

    const self = await del(a.id)
    expect(self.status).toBeGreaterThanOrEqual(400)
    const remaining = await payload.find({ collection: 'librarians', overrideAccess: true })
    expect(remaining.docs.map((d) => d.email).sort()).toEqual(['a@example.test', 'b@example.test'])

    const other = await del(b.id)
    expect(other.status).toBe(200)
    const after = await payload.find({ collection: 'librarians', overrideAccess: true })
    expect(after.docs.map((d) => d.email)).toEqual(['a@example.test'])
  })
})
