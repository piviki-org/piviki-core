import type { PayloadRequest } from 'payload'

import { describe, expect, it } from 'vitest'

import { ACCESS_OPERATIONS, defineCollection } from '../src/collections/_helpers/defineCollection'
import { testPayload } from './helpers'

const librarianReq = {
  user: { id: 1, collection: 'librarians', email: 'a@example.test' },
} as unknown as PayloadRequest

describe('defineCollection', () => {
  it('denies every operation when nothing is granted, even to a signed-in librarian', async () => {
    const config = defineCollection({ slug: 'probe', fields: [] })
    for (const op of ACCESS_OPERATIONS) {
      const fn = config.access?.[op]
      expect(fn, op).toBeTypeOf('function')
      expect(await fn!({ req: librarianReq } as never), op).toBe(false)
    }
  })

  it('keeps only what is granted', async () => {
    const config = defineCollection({
      slug: 'probe',
      fields: [],
      access: { read: () => true },
    })
    expect(await config.access!.read!({ req: librarianReq } as never)).toBe(true)
    expect(await config.access!.delete!({ req: librarianReq } as never)).toBe(false)
  })

  it('refuses unknown access keys', () => {
    expect(() =>
      defineCollection({ slug: 'probe', fields: [], access: { reed: () => true } as never }),
    ).toThrow(/unknown access operation/)
  })

  it('every app collection in the config went through defineCollection', async () => {
    const { config } = await testPayload()
    // Payload's internal `payload-*` collections keep their own access; story 1.2 tests them with patrons.
    const appCollections = config.collections.filter((c) => !c.slug.startsWith('payload-'))
    expect(appCollections.map((c) => c.slug)).toEqual(['librarians'])
    for (const collection of appCollections) {
      expect(collection.custom?.deniedByDefault, collection.slug).toBe(true)
    }
  })

  it('an operation librarians does not grant is refused even to a signed-in librarian', async () => {
    const { config } = await testPayload()
    const librarians = config.collections.find((c) => c.slug === 'librarians')!
    // readVersions is not granted (librarians has no versions); Payload's default would allow it.
    expect(await (librarians.access.readVersions as (a: unknown) => unknown)({ req: librarianReq })).toBe(false)
  })

  it('every app collection carries an explicit access function for every operation', async () => {
    const { config } = await testPayload()
    const appCollections = config.collections.filter((c) => !c.slug.startsWith('payload-'))
    for (const collection of appCollections) {
      for (const op of ACCESS_OPERATIONS) {
        if (op === 'admin' || op === 'unlock') {
          if (!collection.auth) continue
        }
        expect(collection.access[op], `${collection.slug}.${op}`).toBeTypeOf('function')
      }
    }
  })

  it('an anonymous request is refused on every librarians operation', async () => {
    const { config } = await testPayload()
    const librarians = config.collections.find((c) => c.slug === 'librarians')!
    const anonymous = { user: null } as unknown as PayloadRequest
    for (const op of ACCESS_OPERATIONS) {
      const fn = librarians.access[op as keyof typeof librarians.access] as
        | ((args: unknown) => unknown)
        | undefined
      expect(await fn!({ req: anonymous }), op).toBe(false)
    }
  })
})
