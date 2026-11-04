import type { Access, CollectionBeforeOperationHook, PayloadRequest } from 'payload'

import { NotFound } from 'payload'

import { defineCollection } from './_helpers/defineCollection'

export const LIBRARIAN_PASSWORD_MIN_LENGTH = 12
/** About 8 hours (AD-7). */
export const LIBRARIAN_SESSION_SECONDS = 8 * 60 * 60

export const isLibrarian = (req: PayloadRequest): boolean =>
  Boolean(req.user && req.user.collection === 'librarians')

const librarianOnly = ({ req }: { req: PayloadRequest }): boolean => isLibrarian(req)

/** A librarian may not delete their own account, so the last account cannot lock everyone out. */
const deleteOtherLibrarians: Access = ({ req }) => {
  if (!isLibrarian(req) || !req.user) return false
  return { id: { not_equals: req.user.id } }
}

const passwordMinLength = (value: unknown): string | true => {
  if (value === undefined || value === null || value === '') return true // unchanged / required elsewhere
  if (typeof value !== 'string' || value.length < LIBRARIAN_PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${LIBRARIAN_PASSWORD_MIN_LENGTH} characters.`
  }
  return true
}

const FIRST_REGISTER_PATH = /\/first-register\/?$/

/**
 * Payload's first-register creates an account with no authentication. Caddy blocks the route;
 * this endpoint override and hook refuse it if a request ever reaches core directly (AD-5).
 */
export const refuseFirstRegister: CollectionBeforeOperationHook = ({ args, operation, req }) => {
  const pathname = req.pathname ?? (req.url ? new URL(req.url, 'http://local').pathname : '')
  if (operation === 'create' && FIRST_REGISTER_PATH.test(pathname)) {
    throw new NotFound(req.t)
  }
  return args
}

export const Librarians = defineCollection({
  slug: 'librarians',
  admin: {
    useAsTitle: 'email',
    defaultColumns: ['email', 'updatedAt'],
  },
  auth: {
    tokenExpiration: LIBRARIAN_SESSION_SECONDS,
    useSessions: true,
    removeTokenFromResponses: true,
    maxLoginAttempts: 5,
    lockTime: 15 * 60 * 1000,
    cookies: {
      secure: true,
      sameSite: 'Lax',
      // No `domain`: the cookie is host-only, so it never reaches api.piviki.fi.
    },
  },
  access: {
    admin: librarianOnly,
    create: librarianOnly,
    read: librarianOnly,
    update: librarianOnly,
    delete: deleteOtherLibrarians,
    unlock: librarianOnly,
  },
  endpoints: [
    {
      path: '/first-register',
      method: 'post',
      handler: () => Response.json({ message: 'Not Found' }, { status: 404 }),
    },
  ],
  hooks: {
    beforeOperation: [refuseFirstRegister],
  },
  fields: [
    {
      // Overrides Payload's auth password field; also applied on reset (AD-7).
      name: 'password',
      type: 'text',
      hidden: true,
      // Never a database column: Payload stores only `hash` and `salt`.
      virtual: true,
      minLength: LIBRARIAN_PASSWORD_MIN_LENGTH,
      validate: passwordMinLength,
    },
  ],
})
