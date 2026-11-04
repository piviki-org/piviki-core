import type { Access, CollectionConfig } from 'payload'

/**
 * Every collection is built through this helper (AD-5). Payload's own default lets any signed-in
 * user do anything; here every operation is refused unless the collection grants it explicitly.
 */

export const denyAll: Access = () => false

/** Every collection-level access operation Payload checks, including auth-only ones. */
export const ACCESS_OPERATIONS = [
  'admin',
  'create',
  'delete',
  'read',
  'readVersions',
  'unlock',
  'update',
] as const

export type AccessOperation = (typeof ACCESS_OPERATIONS)[number]

type CollectionAccess = NonNullable<CollectionConfig['access']>

export type DefinedCollectionConfig = Omit<CollectionConfig, 'access'> & {
  /** Only the operations listed here are ever allowed; anything omitted is denied. */
  access?: Partial<Pick<CollectionAccess, AccessOperation>>
}

export function defineCollection(config: DefinedCollectionConfig): CollectionConfig {
  const granted = config.access ?? {}
  for (const key of Object.keys(granted)) {
    if (!(ACCESS_OPERATIONS as readonly string[]).includes(key)) {
      throw new Error(`defineCollection(${config.slug}): unknown access operation "${key}"`)
    }
  }

  const access = Object.fromEntries(
    ACCESS_OPERATIONS.map((op) => [op, granted[op] ?? denyAll]),
  ) as CollectionAccess

  return {
    ...config,
    access,
    // Lets a test prove every app collection went through this helper (Payload's own default
    // access is also a function that refuses anonymous requests, so access alone cannot tell).
    custom: { ...config.custom, deniedByDefault: true },
  }
}
