import { inject } from 'vitest'

// Runtime configuration, as a host's core secrets file would provide it.
process.env.DATABASE_URL = inject('databaseURL')
process.env.PAYLOAD_SECRET = 'test-only-secret-0123456789abcdef0123456789'
process.env.ENVIRONMENT = 'local'
process.env.SERVER_URL = 'https://admin.localhost'
process.env.CORS_ORIGINS = 'https://admin.localhost'
process.env.CSRF_ORIGINS = 'https://admin.localhost'
