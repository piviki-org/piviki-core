import { afterEach, describe, expect, it } from 'vitest'

import { loadEnv } from '../src/env'

const saved = { ...process.env }

afterEach(() => {
  process.env = { ...saved }
})

describe('runtime configuration', () => {
  it('reads every environment-specific value from the environment', () => {
    process.env.SERVER_URL = 'https://test-admin.piviki.fi'
    process.env.CORS_ORIGINS = 'https://test-admin.piviki.fi'
    process.env.CSRF_ORIGINS = 'https://test-admin.piviki.fi'
    const env = loadEnv()
    expect(env.serverURL).toBe('https://test-admin.piviki.fi')
    expect(env.corsOrigins).toEqual(['https://test-admin.piviki.fi'])
    expect(env.csrfOrigins).toEqual(['https://test-admin.piviki.fi'])
  })

  it('refuses a missing value', () => {
    delete process.env.SERVER_URL
    expect(() => loadEnv()).toThrow(/SERVER_URL/)
  })

  it('refuses wildcard or non-exact origins', () => {
    process.env.CORS_ORIGINS = 'https://*.piviki.fi'
    expect(() => loadEnv()).toThrow(/exact origin/)
    process.env.CORS_ORIGINS = 'https://admin.piviki.fi/'
    expect(() => loadEnv()).toThrow(/exact origin/)
  })

  it('refuses a SERVER_URL that is not an exact origin', () => {
    process.env.SERVER_URL = 'https://admin.piviki.fi/admin'
    expect(() => loadEnv()).toThrow(/SERVER_URL.*exact origin/)
    process.env.SERVER_URL = 'admin.piviki.fi'
    expect(() => loadEnv()).toThrow(/SERVER_URL.*not a URL/)
  })

  it('refuses a short secret', () => {
    process.env.PAYLOAD_SECRET = 'short'
    expect(() => loadEnv()).toThrow(/PAYLOAD_SECRET/)
  })
})
