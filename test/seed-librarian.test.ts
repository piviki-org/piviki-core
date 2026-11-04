import type { Payload } from 'payload'

import { spawn } from 'node:child_process'

import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { parseSeedInput, seedLibrarian } from '../scripts/seed-librarian'
import { GOOD_PASSWORD, resetLibrarians, testPayload } from './helpers'

let payload: Payload

beforeAll(async () => {
  ;({ payload } = await testPayload())
})

beforeEach(async () => {
  await resetLibrarians(payload)
})

describe('seed-librarian', () => {
  it('reads the email and password from two stdin lines', () => {
    expect(parseSeedInput(`a@example.test\n${GOOD_PASSWORD}\n`)).toEqual({
      email: 'a@example.test',
      password: GOOD_PASSWORD,
    })
    expect(() => parseSeedInput('not-an-email\nx\n')).toThrow(/email/)
    expect(() => parseSeedInput('a@example.test\n')).toThrow(/password/)
  })

  it('creates the first librarian, then refuses without --force', async () => {
    await seedLibrarian({ email: 'first@example.test', password: GOOD_PASSWORD }, { force: false })
    await expect(
      seedLibrarian({ email: 'second@example.test', password: GOOD_PASSWORD }, { force: false }),
    ).rejects.toThrow(/already exist/)
    await seedLibrarian({ email: 'second@example.test', password: GOOD_PASSWORD }, { force: true })
    expect((await payload.count({ collection: 'librarians' })).totalDocs).toBe(2)
  })

  it('still applies the password rule', async () => {
    await expect(
      seedLibrarian({ email: 'short@example.test', password: 'x'.repeat(11) }, { force: false }),
    ).rejects.toBeTruthy()
    expect((await payload.count({ collection: 'librarians' })).totalDocs).toBe(0)
  })
})

/** Runs the script the way the image's entrypoint does, with the email and password on stdin. */
function runSeedCli(input: string, args: string[] = []) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn('node_modules/.bin/tsx', ['scripts/seed-librarian.ts', ...args], {
      env: { ...process.env, NODE_OPTIONS: '--no-deprecation' },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (code) => resolve({ code, stdout, stderr }))
    child.stdin.end(input)
  })
}

describe('seed-librarian command line', () => {
  it('creates from stdin, then refuses a second account without --force', async () => {
    const first = await runSeedCli(`cli@example.test\n${GOOD_PASSWORD}\n`)
    expect(first.code, first.stderr).toBe(0)
    expect(first.stdout).toMatch(/Created librarian id=\d+/)
    // Ids only in logs (AD-14): neither the email nor the password is printed.
    expect(first.stdout + first.stderr).not.toContain('cli@example.test')
    expect(first.stdout + first.stderr).not.toContain(GOOD_PASSWORD)

    const second = await runSeedCli(`cli2@example.test\n${GOOD_PASSWORD}\n`)
    expect(second.code).toBe(1)
    expect(second.stderr).toMatch(/already exist/)

    const forced = await runSeedCli(`cli2@example.test\n${GOOD_PASSWORD}\n`, ['--force'])
    expect(forced.code, forced.stderr).toBe(0)
    expect((await payload.count({ collection: 'librarians' })).totalDocs).toBe(2)
  })
})

