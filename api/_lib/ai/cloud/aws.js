import crypto from 'node:crypto'

/*
 * AWS Signature Version 4, for the two AWS calls here (Bedrock Converse and Textract).
 * Hand-rolled rather than pulling in the AWS SDK for two POST requests; checked against
 * AWS's published test vector in tests/configurable.test.js.
 */

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const hmac = (key, value) => crypto.createHmac('sha256', key).update(value).digest()

// RFC 3986: encodeURIComponent leaves !'()* alone, SigV4 wants them encoded.
const encodeSegment = (segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`)

/**
 * Signs a request and returns the headers to send (including Authorization). `path` is
 * the raw path; it is encoded here, and encoded a second time for the canonical request
 * as SigV4 requires for every service except S3.
 */
export const signAwsRequest = ({ method = 'POST', host, path = '/', headers = {}, body = '', region, service, accessKeyId, secretAccessKey, now = new Date(), signPayloadHeader = true }) => {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = amzDate.slice(0, 8)
  const payloadHash = sha256(body)
  const requestPath = path.split('/').map(encodeSegment).join('/')
  const canonicalPath = requestPath.split('/').map(encodeSegment).join('/')

  const signed = { ...headers, host, 'x-amz-date': amzDate, ...(signPayloadHeader ? { 'x-amz-content-sha256': payloadHash } : {}) }
  const names = Object.keys(signed).map((name) => name.toLowerCase()).sort()
  const lookup = Object.fromEntries(Object.entries(signed).map(([name, value]) => [name.toLowerCase(), String(value).trim().replace(/\s+/g, ' ')]))
  const canonicalHeaders = names.map((name) => `${name}:${lookup[name]}\n`).join('')
  const signedHeaders = names.join(';')

  const canonicalRequest = [method, canonicalPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const scope = `${date}/${region}/${service}/aws4_request`
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, date), region), service), 'aws4_request')
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex')

  // fetch sets Host itself from the URL.
  const sendHeaders = { ...signed }
  delete sendHeaders.host
  return {
    url: `https://${host}${requestPath}`,
    headers: { ...sendHeaders, Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}` },
  }
}

/** POSTs a signed JSON body and returns the fetch Response. */
export const awsPost = ({ service, region, host, path, headers, body, accessKeyId, secretAccessKey, timeoutMs }) => {
  const request = signAwsRequest({ host, path, headers, body, region, service, accessKeyId, secretAccessKey })
  return fetch(request.url, { method: 'POST', headers: request.headers, body, signal: AbortSignal.timeout(timeoutMs) })
}
