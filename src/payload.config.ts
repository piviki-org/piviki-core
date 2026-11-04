import { postgresAdapter } from '@payloadcms/db-postgres'
import path from 'path'
import { buildConfig } from 'payload'
import { fileURLToPath } from 'url'

import { Librarians } from './collections/librarians'
import { loadEnv } from './env'

const filename = fileURLToPath(import.meta.url)
const dirname = path.dirname(filename)

const env = loadEnv()

export default buildConfig({
  serverURL: env.serverURL,
  cors: env.corsOrigins,
  csrf: env.csrfOrigins,
  secret: env.payloadSecret,
  admin: {
    user: Librarians.slug,
    importMap: {
      baseDir: path.resolve(dirname),
    },
  },
  // Only collections built through defineCollection belong here.
  collections: [Librarians],
  graphQL: {
    disable: true,
  },
  jobs: {
    tasks: [],
    access: {
      run: () => false,
    },
  },
  telemetry: false,
  typescript: {
    outputFile: path.resolve(dirname, 'payload-types.ts'),
  },
  db: postgresAdapter({
    pool: {
      connectionString: env.databaseURL,
    },
    // Schema changes only through committed migrations, run before core starts (AD-17).
    push: false,
    migrationDir: path.resolve(dirname, 'migrations'),
  }),
})
