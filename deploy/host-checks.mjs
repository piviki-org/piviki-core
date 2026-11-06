// In-network deploy checks, run by deploy.sh on the host after `up` (AD-5, AD-17).
// They talk to Caddy on the private `edge` network with each host's Host header, so they work
// before the public admin/api records exist (the first deploy precedes seeding) and are not
// affected by Access. Runs with the core image's node in a throwaway container:
//   docker run --rm --network piviki_edge -v .../host-checks.mjs:/checks.mjs:ro \
//     -e ENVIRONMENT -e ADMIN_HOST -e API_HOST -e ADMIN_ORIGIN \
//     --entrypoint node <core image> /checks.mjs
import http from 'node:http'

const CADDY = process.env.CADDY_ADDR ?? 'caddy'
const PORT = Number(process.env.CADDY_PORT ?? 80)
const { ENVIRONMENT, ADMIN_HOST, API_HOST, ADMIN_ORIGIN } = process.env
if (!ENVIRONMENT || !ADMIN_HOST || !API_HOST || !ADMIN_ORIGIN) {
  console.error('ENVIRONMENT, ADMIN_HOST, API_HOST and ADMIN_ORIGIN are required')
  process.exit(64)
}

// The naming rule core applies to its origins (src/env.ts hostAgrees), on caddy.env's hosts
// (AD-17): on test, a first label `test` or starting `test-`; on production, neither; on local,
// only localhost names. Checked before any request.
function hostAgrees(environment, host) {
  const name = host.toLowerCase().replace(/\.$/, '')
  if (!name) return false // a missing or unparsable value never agrees
  const first = name.split('.')[0]
  const testNamed = first === 'test' || first.startsWith('test-')
  if (environment === 'test') return testNamed
  if (environment === 'production') return !testNamed
  if (environment === 'local') return name === 'localhost' || name.endsWith('.localhost')
  return false
}
let originHost = ''
try {
  originHost = new URL(ADMIN_ORIGIN).hostname
} catch {
  // reported below as a disagreeing host
}
const disagreeing = [
  ['ADMIN_HOST', ADMIN_HOST, ADMIN_HOST],
  ['API_HOST', API_HOST, API_HOST],
  ['ADMIN_ORIGIN', ADMIN_ORIGIN, originHost],
].filter(([, , host]) => !hostAgrees(ENVIRONMENT, host))
if (disagreeing.length) {
  for (const [name, value] of disagreeing) {
    console.log(`FAIL  ${name}=${value} is not a ${ENVIRONMENT} host name; no request sent`)
  }
  process.exit(1)
}

function status(host, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve) => {
    const req = http.request(
      { host: CADDY, port: PORT, path, method, headers: { Host: host, ...headers }, timeout: 15000 },
      (res) => {
        res.resume()
        resolve({ code: res.statusCode, location: res.headers.location ?? '' })
      },
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', () => resolve({ code: 0, location: '' }))
    if (body) req.write(body)
    req.end()
  })
}

const json = { 'Content-Type': 'application/json' }
const checks = [
  ['first-register: admin GET /admin/create-first-user', 404, ADMIN_HOST, '/admin/create-first-user'],
  [
    'first-register: admin POST /api/librarians/first-register',
    404,
    ADMIN_HOST,
    '/api/librarians/first-register',
    { method: 'POST', headers: { ...json, Origin: ADMIN_ORIGIN }, body: '{"email":"check@invalid.example","password":"not-a-real-password"}' },
  ],
  ...[
    '/',
    '/admin',
    '/admin/login',
    '/api/librarians',
    '/api/librarians/first-register',
    '/api/graphql',
    '/api/payload-jobs/run',
    '/api/v1',
    '/api/v1/../librarians',
    '/api/v1/%2e%2e/librarians',
    '/api/v1%2f..%2flibrarians',
  ].map((p) => [`allowlist: api ${p}`, 404, API_HOST, p]),
  ['health: api /api/v1/health', 200, API_HOST, '/api/v1/health'],
  [
    'origin: admin POST with Origin https://evil.example',
    403,
    ADMIN_HOST,
    '/api/librarians/login',
    { method: 'POST', headers: { ...json, Origin: 'https://evil.example' }, body: '{}' },
  ],
  // A same-origin login is let through to Payload (401 for unknown credentials). A wrong
  // ADMIN_ORIGIN in caddy.env would make Caddy answer 403 to every real login.
  [
    'origin: admin POST login with Origin $ADMIN_ORIGIN reaches Payload',
    401,
    ADMIN_HOST,
    '/api/librarians/login',
    { method: 'POST', headers: { ...json, Origin: ADMIN_ORIGIN }, body: '{"email":"check@invalid.example","password":"not-a-real-password"}' },
  ],
  ['unknown host: foo.invalid', 404, 'foo.invalid', '/'],
  // Until the first librarian is seeded (the first deploy, AD-5), Payload redirects every admin
  // page to create-first-user, which Caddy answers 404 (checked above).
  ['admin login page', 'login', ADMIN_HOST, '/admin/login'],
]

// 'login': 200, or a redirect to create-first-user while no librarian exists yet.
function matches(want, { code, location }) {
  if (want !== 'login') return code === want
  return code === 200 || ([302, 303, 307].includes(code) && /\/admin\/create-first-user$/.test(location))
}

let failures = 0
for (const [label, want, host, path, opts] of checks) {
  const got = await status(host, path, opts)
  const shown = got.location ? `${got.code} -> ${got.location}` : `${got.code}`
  if (matches(want, got)) console.log(`PASS  ${label} (${shown})`)
  else {
    failures++
    console.log(`FAIL  ${label}: want ${want === 'login' ? '200 or redirect to create-first-user' : want}, got ${shown}`)
  }
}
console.log(failures ? `${failures} host check(s) failed` : 'all host checks passed')
process.exit(failures ? 1 : 0)
