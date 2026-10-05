import crypto from 'node:crypto'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { getAbsoluteFSPath } from 'swagger-ui-dist'
import kv from '../_lib/kv.js'
import { fail } from '../_lib/http.js'
import { recordAudit } from '../_lib/audit.js'
import { ipOf, rateKey, underLimit } from '../_lib/rateLimit.js'
import { createZraClient, ZraError } from '../_lib/zra/client.js'
import { getZraConfig } from '../_lib/zra/config.js'

const RATE_KEY = 'los:zra:uat-lookup-rate'
const RATE_SECONDS = 2
const APPLICATION_LOOKUP_LIMIT = 5
const APPLICATION_LOOKUP_WINDOW_SECONDS = 15 * 60
let uatClient = null

const SWAGGER_ASSETS = {
  'swagger-ui.css': 'text/css; charset=utf-8',
  'swagger-ui-bundle.js': 'application/javascript; charset=utf-8',
  'swagger-ui-standalone-preset.js': 'application/javascript; charset=utf-8',
  'favicon-16x16.png': 'image/png',
  'favicon-32x32.png': 'image/png',
}

const isLoopback = (req) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket?.remoteAddress)

const uatEnabled = (req) =>
  process.env.ZRA_UAT_MODE === 'true'
  && process.env.ZRA_UAT_SMOKE_ENABLED === 'true'
  && ['development', 'test'].includes(process.env.NODE_ENV)
  && process.env.VERCEL_ENV !== 'production'
  && !process.env.VERCEL
  && isLoopback(req)

const requireUat = (req) => {
  if (!uatEnabled(req)) fail(404, 'Not found.', 'not_found')
}

const openApi = {
  openapi: '3.0.3',
  info: {
    title: 'ZRA UAT Taxpayer Lookup',
    version: '1.0.0',
    description: 'UAT-only proxy through the loan system backend. ZRA credentials and tokens are never sent to Swagger or the browser.',
  },
  tags: [{ name: 'ZRA Integration', description: 'Authenticate the backend to ZRA, then test taxpayer lookups with an approved UAT identifier.' }],
  servers: [{ url: '/api/v1' }],
  components: {
    schemas: {
      LookupRequest: {
        type: 'object',
        required: ['lookupType', 'lookupValue'],
        additionalProperties: false,
        properties: {
          lookupType: { type: 'string', enum: ['TPIN', 'NRC', 'PASSPORT', 'BRN'] },
          lookupValue: { type: 'string', minLength: 1, maxLength: 100, description: 'Use a ZRA-approved UAT test identifier.' },
        },
      },
      ApplicationLookupRequest: {
        type: 'object',
        required: ['lookupType', 'lookupValue', 'consent'],
        additionalProperties: false,
        properties: {
          lookupType: { type: 'string', enum: ['NRC', 'TPIN', 'PASSPORT', 'BRN'] },
          lookupValue: { type: 'string', minLength: 1, maxLength: 100 },
          consent: { type: 'boolean', enum: [true], description: 'Applicant consent to verify this identifier with ZRA.' },
        },
      },
      LookupResponse: {
        type: 'object',
        required: ['found'],
        properties: {
          found: { type: 'boolean' },
          taxpayer: {
            type: 'object',
            properties: {
              tpin: { type: 'string' },
              name: { type: 'string' },
              idType: { type: 'string', nullable: true },
              idNumber: { type: 'string', nullable: true },
              brn: { type: 'string', nullable: true },
            },
          },
        },
      },
      Error: {
        type: 'object',
        properties: { code: { type: 'string' }, message: { type: 'string' } },
      },
      ZraAuthenticationRequest: {
        type: 'object',
        required: ['baseUrl', 'apiKey', 'username', 'password'],
        additionalProperties: false,
        properties: {
          baseUrl: { type: 'string', format: 'uri', example: 'https://zws.zra.org.zm', description: 'HTTPS origin only. Must be reachable from this machine over the approved ZRA network/VPN.' },
          apiKey: { type: 'string', writeOnly: true },
          username: { type: 'string', writeOnly: true },
          password: { type: 'string', format: 'password', writeOnly: true },
        },
      },
    },
  },
  paths: {
    '/zra/authenticate': {
      post: {
        tags: ['ZRA Integration'],
        operationId: 'zraAuthenticate',
        summary: 'Authenticate the backend with ZRA',
        description: 'Enter the ZRA UAT HTTPS base URL, API key, username, and password here. The request is accepted only from local loopback during development. The backend uses the credentials to authenticate, returns no secrets or tokens, and keeps the configured client in memory for subsequent UAT lookup tests. Do not use real applicant identifiers.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ZraAuthenticationRequest' } } },
        },
        responses: {
          200: {
            description: 'ZRA authentication succeeded.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    authenticated: { type: 'boolean', example: true },
                    message: { type: 'string', example: 'Authenticated with ZRA.' },
                  },
                },
              },
            },
          },
          404: { description: 'UAT operation is disabled or not running on local loopback.' },
          503: { description: 'ZRA configuration or encrypted token storage is unavailable.' },
          502: { description: 'ZRA rejected credentials or could not be reached.' },
        },
      },
    },
    '/zra/lookup': {
      post: {
        tags: ['ZRA Integration'],
        operationId: 'zraUatTaxpayerLookup',
        summary: 'Look up a taxpayer in ZRA UAT',
        description: 'Local development only, served to loopback clients while both UAT flags are enabled. No LOS login is required. Call POST /zra/authenticate first; this request then uses the stored backend token. Use an approved UAT test identifier only.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/LookupRequest' } } },
        },
        responses: {
          200: { description: 'Lookup completed; found=false means ZRA did not find the taxpayer.', content: { 'application/json': { schema: { $ref: '#/components/schemas/LookupResponse' } } } },
          400: { description: 'Invalid lookup input.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'UAT lookup is disabled or the request is not from local development.' },
          429: { description: 'Rate limit reached; wait two seconds before retrying.' },
          502: { description: 'ZRA rejected the request or returned an upstream error.' },
          503: { description: 'ZRA is not configured.' },
          504: { description: 'ZRA request timed out.' },
        },
      },
    },
    '/zra/application-lookup': {
      post: {
        tags: ['ZRA Integration'],
        operationId: 'zraApplicantLookup',
        summary: 'Verify an applicant identifier with ZRA',
        description: 'Accepts NRC, TPIN, passport, or BRN after applicant consent. In local loopback UAT, authenticate first with POST /zra/authenticate and this route reuses that in-memory client; otherwise it uses the encrypted database or server environment configuration. The backend manages ZRA tokens; never send credentials or tokens from the frontend. A found taxpayer includes TPIN and full name for application form population.',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/ApplicationLookupRequest' } } },
        },
        responses: {
          200: { description: 'Lookup completed; found=false means the identifier was not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/LookupResponse' } } } },
          400: { description: 'Invalid lookup input or required consent was not provided.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
          404: { description: 'Application lookup is disabled.' },
          429: { description: 'Lookup rate limit reached.' },
          502: { description: 'ZRA rejected the request or returned an upstream error.' },
          503: { description: 'ZRA configuration or secure token storage is unavailable.' },
          504: { description: 'ZRA request timed out.' },
        },
      },
    },
  },
}

const swaggerDocs = async (req, res) => {
  requireUat(req)
  const nonce = crypto.randomBytes(18).toString('base64')
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Content-Security-Policy', `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`)
  res.end(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ZRA UAT Lookup API</title>
  <link rel="stylesheet" href="/api/v1/zra/assets/swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/api/v1/zra/assets/swagger-ui-bundle.js" nonce="${nonce}"></script>
  <script nonce="${nonce}">
    window.onload = () => SwaggerUIBundle({
      url: '/api/v1/zra/openapi.json',
      dom_id: '#swagger-ui',
      persistAuthorization: false,
      requestInterceptor: (request) => { request.credentials = 'same-origin'; return request; },
    });
  </script>
</body>
</html>`)
}

const swaggerAsset = async (req, res, { params }) => {
  requireUat(req)
  const contentType = SWAGGER_ASSETS[params.asset]
  if (!contentType) fail(404, 'Not found.', 'not_found')
  let contents
  try {
    contents = await readFile(path.join(getAbsoluteFSPath(), params.asset))
  } catch {
    fail(404, 'Not found.', 'not_found')
  }
  res.setHeader('Content-Type', contentType)
  res.setHeader('Cache-Control', 'no-store')
  res.end(contents)
}

const openApiDocument = async (req) => {
  requireUat(req)
  return openApi
}

const authenticate = async (req) => {
  requireUat(req)
  const config = {
    baseUrl: typeof req.body?.baseUrl === 'string' ? req.body.baseUrl.trim() : '',
    apiKey: typeof req.body?.apiKey === 'string' ? req.body.apiKey : '',
    username: typeof req.body?.username === 'string' ? req.body.username.trim() : '',
    password: typeof req.body?.password === 'string' ? req.body.password : '',
  }
  if (!config.baseUrl || !config.apiKey.trim() || !config.username || !config.password) {
    fail(400, 'Enter the HTTPS base URL, API key, username, and password.', 'invalid_input')
  }

  uatClient = null
  let client
  let result
  try {
    client = createZraClient({ config })
    result = await client.authenticate()
  } catch (error) {
    if (!(error instanceof ZraError)) throw error
    const status = ['zra_not_configured', 'zra_token_store_failed', 'zra_rate_gate_failed', 'zra_auth_busy'].includes(error.code) ? 503
      : error.code === 'zra_timeout' ? 504
        : error.code === 'zra_rate_limited' ? 429
          : 502
    fail(status, error.message, error.code)
  }
  uatClient = client

  await recordAudit({
    req,
    actor: null,
    action: 'zra.uat_authenticated',
    entityType: 'integration',
    entityId: 'zra',
    detail: { authenticated: result.authenticated },
  })
  return { authenticated: true, message: 'Authenticated with ZRA.' }
}

const lookup = async (req) => {
  requireUat(req)
  const lookupType = typeof req.body?.lookupType === 'string' ? req.body.lookupType.trim().toUpperCase() : ''
  const lookupValue = typeof req.body?.lookupValue === 'string' ? req.body.lookupValue.trim() : ''
  if (!['TPIN', 'NRC', 'PASSPORT', 'BRN'].includes(lookupType) || !lookupValue || lookupValue.length > 100) {
    fail(400, 'Provide a supported lookup type and a value of no more than 100 characters.', 'invalid_input')
  }

  if ((await kv.set(RATE_KEY, '1', { nx: true, ex: RATE_SECONDS })) === null) {
    fail(429, 'Wait two seconds before making another ZRA lookup.', 'zra_rate_limited')
  }

  let result
  try {
    if (!uatClient) uatClient = createZraClient({ config: (await getZraConfig()).config })
    result = await uatClient.lookup(lookupType, lookupValue)
  } catch (error) {
    if (!(error instanceof ZraError)) throw error
    const status = ['zra_not_configured', 'zra_token_store_failed', 'zra_rate_gate_failed', 'zra_auth_busy'].includes(error.code) ? 503
      : error.code === 'zra_timeout' ? 504
        : error.code === 'zra_rate_limited' ? 429
          : error.code === 'zra_invalid_lookup' ? 400
            : 502
    fail(status, error.message, error.code)
  }

  await recordAudit({
    req,
    actor: null,
    action: 'zra.uat_lookup',
    entityType: 'integration',
    entityId: 'zra',
    detail: { lookupType, found: result.found },
  })
  return result
}

const applicationLookup = async (req) => {
  const localUat = uatEnabled(req)
  if (process.env.ZRA_APPLICATION_LOOKUP_ENABLED !== 'true' && !localUat) {
    fail(404, 'ZRA application lookup is not enabled.', 'not_found')
  }
  if (req.body?.consent !== true) {
    fail(400, 'Consent is required before sending an identifier to ZRA.', 'zra_consent_required')
  }

  const lookupType = typeof req.body?.lookupType === 'string' ? req.body.lookupType.trim().toUpperCase() : ''
  const lookupValue = typeof req.body?.lookupValue === 'string' ? req.body.lookupValue.trim() : ''
  if (!['TPIN', 'NRC', 'PASSPORT', 'BRN'].includes(lookupType) || !lookupValue || lookupValue.length > 100) {
    fail(400, 'Provide NRC, TPIN, passport, or BRN and a value of no more than 100 characters.', 'invalid_input')
  }

  if (!(await underLimit(rateKey('zra-applicant', ipOf(req)), APPLICATION_LOOKUP_LIMIT, APPLICATION_LOOKUP_WINDOW_SECONDS))) {
    fail(429, 'Too many ZRA lookups from this connection. Try again later.', 'zra_rate_limited')
  }

  let result
  try {
    const client = localUat && uatClient
      ? uatClient
      : createZraClient({ config: (await getZraConfig()).config })
    result = await client.lookup(lookupType, lookupValue)
  } catch (error) {
    if (!(error instanceof ZraError)) throw error
    const status = ['zra_not_configured', 'zra_token_store_failed', 'zra_rate_gate_failed', 'zra_auth_busy'].includes(error.code) ? 503
      : error.code === 'zra_timeout' ? 504
        : error.code === 'zra_rate_limited' ? 429
          : error.code === 'zra_invalid_lookup' ? 400
            : 502
    fail(status, error.message, error.code)
  }

  await recordAudit({
    req,
    actor: null,
    action: 'zra.applicant_lookup',
    entityType: 'integration',
    entityId: 'zra',
    detail: { lookupType, found: result.found, consented: true },
  })
  return result
}

export const zraRoutes = [
  ['GET', '/zra/docs', swaggerDocs],
  ['GET', '/zra/assets/:asset', swaggerAsset],
  ['GET', '/zra/openapi.json', openApiDocument],
  ['POST', '/zra/authenticate', authenticate],
  ['POST', '/zra/lookup', lookup],
  ['POST', '/zra/application-lookup', applicationLookup],
]