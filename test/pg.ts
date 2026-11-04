import EmbeddedPostgres from 'embedded-postgres'
import { mkdtemp, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

/** A throwaway real Postgres (AD conventions: modules test against a real Postgres). */
export async function startPostgres(): Promise<{ url: string; stop: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'piviki-pg-'))
  const port = await freePort()
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: 'piviki',
    password: 'piviki',
    port,
    persistent: false,
    autoRehydrateSymlinks: true,
    onLog: () => {},
  })
  await pg.initialise()
  await pg.start()
  await pg.createDatabase('piviki')
  return {
    url: `postgres://piviki:piviki@127.0.0.1:${port}/piviki`,
    stop: async () => {
      await pg.stop()
      await rm(dir, { recursive: true, force: true })
    },
  }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
  })
}
