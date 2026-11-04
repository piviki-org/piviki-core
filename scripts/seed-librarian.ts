/**
 * Creates a librarian account from stdin, for seeding over SSH before any public DNS record
 * exists (AD-5). Reads two lines: the email, then the password. Nothing is taken from argv,
 * so the password never lands in shell history or the process list.
 *
 *   printf '%s\n%s\n' "$EMAIL" "$PASSWORD" | docker compose run --rm -T core seed-librarian [--force]
 *   printf '%s\n%s\n' "$EMAIL" "$PASSWORD" | pnpm seed:librarian [--force]   # local
 *
 * Refuses when any librarian already exists, unless `--force` is given.
 */
import { pathToFileURL } from 'node:url'
import { getPayload } from 'payload'

import config from '../src/payload.config'

export type SeedInput = { email: string; password: string }

export function parseSeedInput(raw: string): SeedInput {
  const lines = raw.split(/\r?\n/)
  const email = (lines[0] ?? '').trim()
  const password = lines[1] ?? ''
  if (!email || !/^[^\s@]+@[^\s@]+$/.test(email)) {
    throw new Error('First line of stdin must be the librarian email address')
  }
  if (!password) {
    throw new Error('Second line of stdin must be the password')
  }
  return { email, password }
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error('Pipe the email and password on stdin; refusing to read from a terminal')
  }
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

export async function seedLibrarian(
  input: SeedInput,
  { force }: { force: boolean },
): Promise<{ id: number | string }> {
  const payload = await getPayload({ config })
  const { totalDocs } = await payload.count({ collection: 'librarians', overrideAccess: true })
  if (totalDocs > 0 && !force) {
    throw new Error(
      `Refusing: ${totalDocs} librarian account(s) already exist. Re-run with --force to add another.`,
    )
  }
  const doc = await payload.create({
    collection: 'librarians',
    data: { email: input.email, password: input.password },
    overrideAccess: true,
  })
  return { id: doc.id }
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) {
  const force = process.argv.includes('--force')
  try {
    const input = parseSeedInput(await readStdin())
    const { id } = await seedLibrarian(input, { force })
    // Ids only in logs (AD-14).
    console.log(`Created librarian id=${id}`)
    process.exit(0)
  } catch (error) {
    const data = (error as { data?: { errors?: { message: string }[] } }).data
    console.error(data?.errors?.map((e) => e.message).join('; ') || (error as Error).message)
    process.exit(1)
  }
}
