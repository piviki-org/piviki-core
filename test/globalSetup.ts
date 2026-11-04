import type { TestProject } from 'vitest/node'

import { startPostgres } from './pg'

declare module 'vitest' {
  export interface ProvidedContext {
    databaseURL: string
  }
}

export default async function setup(project: TestProject) {
  const pg = await startPostgres()
  project.provide('databaseURL', pg.url)
  return async () => {
    await pg.stop()
  }
}
