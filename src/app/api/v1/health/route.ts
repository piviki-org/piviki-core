import config from '@payload-config'
import { getPayload } from 'payload'

export const dynamic = 'force-dynamic'

const headers = { 'Cache-Control': 'no-store' }

/** Liveness and database reachability for deploy checks. Carries no data. */
export async function GET(): Promise<Response> {
  try {
    const payload = await getPayload({ config })
    await payload.db.pool.query('select 1')
    return Response.json({ status: 'ok' }, { headers })
  } catch {
    return Response.json(
      { error: { code: 'unavailable', message: 'Service unavailable' } },
      { status: 503, headers },
    )
  }
}
