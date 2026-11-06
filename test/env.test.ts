import { afterEach, describe, expect, it } from 'vitest'

import { hostAgrees, loadEnv } from '../src/env'

const saved = { ...process.env }

afterEach(() => {
  process.env = { ...saved }
})

describe('runtime configuration', () => {
  it('reads every environment-specific value from the environment', () => {
    process.env.ENVIRONMENT = 'test'
    process.env.SERVER_URL = 'https://test-admin.piviki.fi'
    process.env.CORS_ORIGINS = 'https://test-admin.piviki.fi'
    process.env.CSRF_ORIGINS = 'https://test-admin.piviki.fi'
    const env = loadEnv()
    expect(env.environment).toBe('test')
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

  it('refuses a missing or unknown environment name', () => {
    delete process.env.ENVIRONMENT
    expect(() => loadEnv()).toThrow(/ENVIRONMENT/)
    process.env.ENVIRONMENT = 'prod'
    expect(() => loadEnv()).toThrow(/ENVIRONMENT.*one of local, test, production/)
  })
})

describe('host names agree with the environment name (AD-17)', () => {
  function configure(environment: string, server: string, origins: string) {
    process.env.ENVIRONMENT = environment
    process.env.SERVER_URL = server
    process.env.CORS_ORIGINS = origins
    process.env.CSRF_ORIGINS = origins
  }

  it('starts on test with test host names', () => {
    configure('test', 'https://test-admin.piviki.fi', 'https://test-admin.piviki.fi,https://test.piviki.fi')
    expect(loadEnv().corsOrigins).toEqual(['https://test-admin.piviki.fi', 'https://test.piviki.fi'])
  })

  it('refuses a production host on test, naming the value', () => {
    configure('test', 'https://admin.piviki.fi', 'https://test-admin.piviki.fi')
    expect(() => loadEnv()).toThrow(/SERVER_URL: "https:\/\/admin\.piviki\.fi" is not a test host/)
    configure('test', 'https://test-admin.piviki.fi', 'https://test-admin.piviki.fi,https://admin.piviki.fi')
    expect(() => loadEnv()).toThrow(/CORS_ORIGINS: "https:\/\/admin\.piviki\.fi"/)
    process.env.CORS_ORIGINS = 'https://test-admin.piviki.fi'
    process.env.CSRF_ORIGINS = 'https://admin.piviki.fi'
    expect(() => loadEnv()).toThrow(/CSRF_ORIGINS: "https:\/\/admin\.piviki\.fi"/)
  })

  it('refuses a test host on production', () => {
    configure('production', 'https://admin.piviki.fi', 'https://admin.piviki.fi')
    expect(loadEnv().serverURL).toBe('https://admin.piviki.fi')
    configure('production', 'https://test-admin.piviki.fi', 'https://admin.piviki.fi')
    expect(() => loadEnv()).toThrow(/SERVER_URL.*not a production host/)
    configure('production', 'https://admin.piviki.fi', 'https://admin.piviki.fi,https://test.piviki.fi')
    expect(() => loadEnv()).toThrow(/CORS_ORIGINS: "https:\/\/test\.piviki\.fi"/)
  })

  it('allows only localhost names on local', () => {
    configure('local', 'http://admin.localhost:8080', 'http://admin.localhost:8080')
    expect(loadEnv().environment).toBe('local')
    configure('local', 'https://admin.piviki.fi', 'http://admin.localhost:8080')
    expect(() => loadEnv()).toThrow(/SERVER_URL.*not a local host/)
  })

  it('applies the rule to the first label only', () => {
    expect(hostAgrees('test', 'test-api.piviki.fi')).toBe(true)
    expect(hostAgrees('test', 'test.piviki.fi')).toBe(true)
    expect(hostAgrees('test', 'TEST-Admin.piviki.fi')).toBe(true)
    expect(hostAgrees('test', 'admin.test.piviki.fi')).toBe(false)
    expect(hostAgrees('test', 'testing.piviki.fi')).toBe(false)
    expect(hostAgrees('production', 'admin.piviki.fi')).toBe(true)
    expect(hostAgrees('production', 'piviki.fi')).toBe(true)
    expect(hostAgrees('production', 'test-api.piviki.fi')).toBe(false)
    expect(hostAgrees('local', 'localhost')).toBe(true)
    expect(hostAgrees('local', 'admin.localhost')).toBe(true)
    expect(hostAgrees('local', 'notlocalhost')).toBe(false)
  })
})
