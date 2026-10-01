
import soap from 'soap'
import http from 'node:http'
import crypto from 'node:crypto'
import { createMemoryKv, client } from './helpers.js'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'


/*
 * The Product 109 bureau integration, against a stand-in SOAP service on this machine —
 * never the real bureau. The stand-in is built from a WSDL shaped like the bureau's
 * (document/literal, a `return` wrapper, Basic auth on every request), with its inputs
 * deliberately in a different order from the adapter's, so ordering comes from the WSDL.
 */

const kv = createMemoryKv()
const PDF = Buffer.from('%PDF-1.4\n% test\n')
vi.mock('../api/_lib/kv.js', () => ({ default: kv }))
const { default: handler } = await import('../api/v1/[...path].js')
const { putBlob } = await import('../api/_lib/blob.js')
const { getDb, schema } = await import('../api/_lib/db/client.js')
const { identityFor } = await import('../api/_lib/crb/identity.js')
const TRANSPORT = { username: 'transport-user', password: 'transport-secret' }
const { resetProduct109Client } = await import('../api/_lib/crb/product109.js')
const { buildStoredReport, extractCommitments, formatNrc, normalizeReport, reportFingerprint } = await import('../api/_lib/crb/normalize.js')



// ---------------------------------------------------------------------------
// Stand-in bureau
// ---------------------------------------------------------------------------

const INPUT_ORDER = ['username', 'password', 'code', 'infinityCode', 'name1', 'name2', 'nationalID', 'reportSector', 'reportReason']

const wsdlFor = (location) => `<?xml version="1.0" encoding="UTF-8"?>
<definitions xmlns="http://schemas.xmlsoap.org/wsdl/" xmlns:soap="http://schemas.xmlsoap.org/wsdl/soap/"
  xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:tns="http://ws.test.crb/" targetNamespace="http://ws.test.crb/" name="Product109Service">
  <types>
    <xs:schema targetNamespace="http://ws.test.crb/" elementFormDefault="unqualified">
      <xs:element name="getProduct109" type="tns:getProduct109"/>
      <xs:element name="getProduct109Response" type="tns:getProduct109Response"/>
      <xs:complexType name="getProduct109"><xs:sequence>
        ${INPUT_ORDER.map((name) => `<xs:element name="${name}" type="xs:string" minOccurs="0"/>`).join('')}
      </xs:sequence></xs:complexType>
      <xs:complexType name="getProduct109Response"><xs:sequence>
        <xs:element name="return" type="tns:product109" minOccurs="0"/>
      </xs:sequence></xs:complexType>
      <xs:complexType name="product109"><xs:sequence>
        <xs:element name="responseCode" type="xs:int" minOccurs="0"/>
        <xs:element name="header" type="tns:header" minOccurs="0"/>
        <xs:element name="personalProfile" type="tns:personalProfile" minOccurs="0"/>
        <xs:element name="scoreOutput" type="tns:scoreOutput" minOccurs="0"/>
        <xs:element name="accountList" type="tns:account" minOccurs="0" maxOccurs="unbounded"/>
        <xs:element name="recentEnquiryList" type="tns:enquiry" minOccurs="0" maxOccurs="unbounded"/>
      </xs:sequence></xs:complexType>
      <xs:complexType name="header"><xs:sequence>
        <xs:element name="reportDate" type="xs:string" minOccurs="0"/><xs:element name="requestNo" type="xs:string" minOccurs="0"/>
      </xs:sequence></xs:complexType>
      <xs:complexType name="personalProfile"><xs:sequence>
        <xs:element name="fullName" type="xs:string" minOccurs="0"/><xs:element name="surname" type="xs:string" minOccurs="0"/>
        <xs:element name="otherNames" type="xs:string" minOccurs="0"/><xs:element name="nationalID" type="xs:string" minOccurs="0"/>
      </xs:sequence></xs:complexType>
      <xs:complexType name="scoreOutput"><xs:sequence>
        <xs:element name="grade" type="xs:string" minOccurs="0"/><xs:element name="positiveScore" type="xs:string" minOccurs="0"/>
        <xs:element name="probability" type="xs:string" minOccurs="0"/><xs:element name="reasonCodeAARC1" type="xs:string" minOccurs="0"/>
        <xs:element name="reasonCodeAARC2" type="xs:string" minOccurs="0"/>
      </xs:sequence></xs:complexType>
      <xs:complexType name="account"><xs:sequence>
        <xs:element name="accountNo" type="xs:string" minOccurs="0"/><xs:element name="accountStatus" type="xs:string" minOccurs="0"/>
        <xs:element name="accountType" type="xs:string" minOccurs="0"/><xs:element name="balanceAmount" type="xs:string" minOccurs="0"/>
        <xs:element name="scheduledPaymentAmount" type="xs:string" minOccurs="0"/><xs:element name="arrearAmount" type="xs:string" minOccurs="0"/>
        <xs:element name="arrearDays" type="xs:string" minOccurs="0"/><xs:element name="disputed" type="xs:string" minOccurs="0"/>
      </xs:sequence></xs:complexType>
      <xs:complexType name="enquiry"><xs:sequence>
        <xs:element name="enquiryDate" type="xs:string" minOccurs="0"/><xs:element name="enquiryReason" type="xs:string" minOccurs="0"/>
      </xs:sequence></xs:complexType>
    </xs:schema>
  </types>
  <message name="getProduct109"><part name="parameters" element="tns:getProduct109"/></message>
  <message name="getProduct109Response"><part name="parameters" element="tns:getProduct109Response"/></message>
  <portType name="Product109"><operation name="getProduct109"><input message="tns:getProduct109"/><output message="tns:getProduct109Response"/></operation></portType>
  <binding name="Product109PortBinding" type="tns:Product109">
    <soap:binding transport="http://schemas.xmlsoap.org/soap/http" style="document"/>
    <operation name="getProduct109"><soap:operation soapAction=""/><input><soap:body use="literal"/></input><output><soap:body use="literal"/></output></operation>
  </binding>
  <service name="Product109Service"><port name="Product109Port" binding="tns:Product109PortBinding"><soap:address location="${location}"/></port></service>
</definitions>`

const sampleReport = (nrc) => ({
  return: {
    header: { reportDate: '2026-09-30T08:00:00', requestNo: 'REQ-1001' },
    personalProfile: { fullName: 'ADA BANDA', surname: 'BANDA', otherNames: 'ADA', nationalID: nrc },
    scoreOutput: { grade: 'BB', positiveScore: '642', probability: '4.2', reasonCodeAARC1: 'R01', reasonCodeAARC2: 'N/A' },
    accountList: [
      { accountNo: 'A1', accountStatus: 'Active', accountType: 'Personal loan', balanceAmount: '12,500.00', scheduledPaymentAmount: '1,200.00', arrearAmount: '300', arrearDays: '31', disputed: 'false' },
      { accountNo: 'A2', accountStatus: 'Written Off', accountType: 'Overdraft', balanceAmount: '4000', scheduledPaymentAmount: '500', arrearAmount: '4000', arrearDays: '180', disputed: 'false' },
      { accountNo: 'A3', accountStatus: 'Active', accountType: 'Card', balanceAmount: '900', scheduledPaymentAmount: '90', arrearAmount: '0', arrearDays: '0', disputed: 'true' },
    ],
    recentEnquiryList: [{ enquiryDate: '2026-08-01', enquiryReason: 'New credit' }],
  },
})

const bureau = {
  calls: [],
  authHeaders: [],
  mode: 'ok',
  delayMs: 0,
  reportedNrc: null,
}

let outer
let baseUrl

beforeAll(async () => {
  const inner = http.createServer()
  outer = http.createServer((req, res) => {
    bureau.authHeaders.push(req.headers.authorization || null)
    const expected = `Basic ${Buffer.from(`${TRANSPORT.username}:${TRANSPORT.password}`).toString('base64')}`
    if (req.headers.authorization !== expected) {
      res.writeHead(401, { 'Content-Type': 'text/html' })
      return res.end('<html><body>Unauthorized</body></html>')
    }
    if (req.method === 'POST' && bureau.mode === 'garbage') {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      return res.end('<html><body>Service temporarily replaced by a maintenance page</body></html>')
    }
    inner.emit('request', req, res)
  })
  await new Promise((resolve) => outer.listen(0, '127.0.0.1', resolve))
  baseUrl = `http://127.0.0.1:${outer.address().port}`
  const service = {
    Product109Service: {
      Product109Port: {
        async getProduct109(args) {
          bureau.calls.push(args)
          if (bureau.delayMs) await new Promise((resolve) => setTimeout(resolve, bureau.delayMs))
          if (bureau.mode === 'fault') {
            // A fault that echoes the NRC, as real services do; it must not reach staff or logs.
            throw { Fault: { faultcode: 'soap:Server', faultstring: `Invalid subscriber for ${args.nationalID}` } }
          }
          if (bureau.mode === 'empty') return { return: { responseCode: 202 } }
          return sampleReport(bureau.reportedNrc || args.nationalID)
        },
      },
    },
  }
  soap.listen(inner, '/crb', service, wsdlFor(`${baseUrl}/crb`))
})

afterAll(() => outer?.close())

const configure = (overrides = {}) => {
  Object.assign(process.env, {
    CRB_PROVIDER: 'product109',
    CRB_WSDL_URL: `${baseUrl}/crb?wsdl`,
    CRB_TRANSPORT_USERNAME: TRANSPORT.username,
    CRB_TRANSPORT_PASSWORD: TRANSPORT.password,
    CRB_MESSAGE_USERNAME: 'message-user',
    CRB_MESSAGE_PASSWORD: 'message-secret',
    CRB_CODE: 'SUB123',
    CRB_INFINITY_CODE: 'INF456',
    CRB_TIMEOUT_SECONDS: '10',
    ...overrides,
  })
  resetProduct109Client()
}

beforeEach(() => {
  configure()
  Object.assign(bureau, { calls: [], authHeaders: [], mode: 'ok', delayMs: 0, reportedNrc: null })
})

// ---------------------------------------------------------------------------
// Applications to check
// ---------------------------------------------------------------------------

const applicant = client(handler)
const admin = client(handler)
const officer = client(handler)
const manager = client(handler)
const dsa = client(handler)

const submit = async (email, { nrc = '123456/78/9', crb = true } = {}) => {
  const token = crypto.randomBytes(12).toString('hex')
  const documents = {}
  const dataDocuments = {}
  for (const slot of ['payslips', 'bankStatements', 'passportPhoto', 'tpin', 'nrcCopy']) {
    const path = `personal.documents.${slot}`
    const stored = await putBlob(`drafts/${email}/${slot}-file.pdf`, PDF, { contentType: 'application/pdf' })
    documents[path] = { ...stored, filename: `${slot}.pdf`, contentType: 'application/pdf', size: PDF.length }
    dataDocuments[slot] = { __draftFile__: path }
  }
  await kv.set(`draft:${email}`, { documents })
  await kv.set(`draftToken:${token}`, email)
  const response = await applicant.post(
    '/applications',
    {
      submissionKey: crypto.randomUUID(),
      loanType: 'personal',
      loanData: { amount: 5000, tenure: 6 },
      consents: { dataProcessing: true, location: false, crb },
      data: {
        personalInfo: { firstName: 'Ada', middleName: 'Mwila', surname: 'Banda', phone: '971234567', email, nrc, birthDate: '1990-05-01' },
        employmentInfo: { residentialAddress: 'Lusaka', occupation: 'Teacher', employerName: 'MoE' },
        documents: dataDocuments,
      },
    },
    { authorization: `Bearer ${token}` }
  )
  expect(response.status).toBe(200)
  return response.body.id
}

let applicationId

beforeAll(async () => {
  await admin.post('/auth/demo', { role: 'admin' })
  await officer.post('/auth/demo', { role: 'loan_officer' })
  await manager.post('/auth/demo', { role: 'sales_manager' })
  await dsa.post('/auth/demo', { role: 'dsa' })
  // Here the sales manager follows every case without working them (no cases.work), so
  // they are not credit staff: they see a report's headline only, and cannot pull one.
  expect((await admin.patch('/roles/sales_manager', { permissions: ['pipeline.view', 'reports.team', 'applications.note'] })).status).toBe(200)
  applicationId = await submit('crb.applicant@example.com')
})

afterAll(() => admin.post('/roles/sales_manager/reset', {}))

const eventsOf = async (id) => (await officer.get(`/applications/${id}`)).body.events.filter((event) => event.type === 'crb')

// ---------------------------------------------------------------------------
// Report processing, without the network
// ---------------------------------------------------------------------------

describe('Product 109 report processing', () => {
  it('normalises both response shapes, lists always as arrays, placeholders as missing', () => {
    const flat = normalizeReport({ personalProfile: { surname: 'BANDA', gender: 'N/A' }, accountList: { accountNo: 'A1' }, physicalAddressList: { address: 'Plot 1' } })
    expect(flat.accountList).toEqual([{ accountNo: 'A1' }])
    expect(flat.addressList).toEqual([{ address: 'Plot 1' }])
    expect(flat.personalProfile.gender).toBeNull()
    expect(flat.phoneList).toEqual([])
    const nested = normalizeReport({ reportData: { scoreOutput: { grade: 'AA' } } })
    expect(nested.scoreOutput.grade).toBe('AA')
    expect(normalizeReport(null).accountList).toEqual([])
  })

  it('counts commitments as the existing adapter does: written off and disputed accounts left out', () => {
    const reportData = normalizeReport(sampleReport('123456/78/9').return)
    expect(extractCommitments(reportData)).toEqual({ commitments: 1200, outstanding: 12500, arrears: 300, arrearDays: 31 })
    expect(extractCommitments(reportData, { includeDisputed: true }).commitments).toBe(1290)
    // A closed account counts as performing, and any balance over 100 as live.
    expect(extractCommitments({ accountList: [{ accountStatus: 'Account Closed', scheduledPaymentAmount: '10' }, { accountStatus: 'Unknown', balanceAmount: '101', scheduledPaymentAmount: '5' }] }).commitments).toBe(15)
  })

  it('fingerprints the content, not the key order', () => {
    expect(reportFingerprint({ a: 1, b: { c: 2, d: [1, 2] } })).toBe(reportFingerprint({ b: { d: [1, 2], c: 2 }, a: 1 }))
    expect(reportFingerprint({ a: 1 })).not.toBe(reportFingerprint({ a: 2 }))
  })

  it('builds the stored report and flags a report about someone else', () => {
    const { score, report } = buildStoredReport(sampleReport('123456/78/9').return, { nrc: '123456/78/9' })
    expect(score).toBe(642)
    expect(report).toMatchObject({ found: true, grade: 'BB', probabilityOfDefault: 4.2, reasonCodes: ['R01'], requestNo: 'REQ-1001', recentEnquiries: 1 })
    expect(report.identity.mismatch).toBe(false)
    expect(buildStoredReport(sampleReport('999999/99/9').return, { nrc: '123456/78/9' }).report.identity.mismatch).toBe(true)
    const empty = buildStoredReport({}, { nrc: '123456/78/9' })
    expect(empty).toMatchObject({ score: null, report: { found: false, band: 'No record at the bureau' } })
  })

  it('reports written-off arrears that affordability leaves out, as a real bureau record showed', () => {
    const { report } = buildStoredReport(sampleReport('123456/78/9').return, { nrc: '123456/78/9' })
    // The written-off overdraft is not a commitment, but its arrears are on record.
    expect(report).toMatchObject({ arrears: 300, accountsInArrears: 2, arrearsOnRecord: 4300, worstArrearDays: 180, writtenOff: 1 })
    expect(report.summary).toBe('3 accounts on record, 1 written off, K4,300 in arrears on 2 (worst 180 days).')
  })

  it('keeps the newest 100 enquiries and the full count', () => {
    const enquiries = Array.from({ length: 250 }, (_, index) => ({ enquiryDate: `2026-01-01T00:00:${String(index % 60).padStart(2, '0')}.${index}Z`, enquiryReason: 'Loan Application' }))
    enquiries.push({ enquiryDate: '2026-09-30T08:00:00Z', enquiryReason: 'Newest' })
    const { report } = buildStoredReport({ ...sampleReport('123456/78/9').return, recentEnquiryList: enquiries }, { nrc: '123456/78/9' })
    expect(report.recentEnquiries).toBe(251)
    expect(report.reportData.recentEnquiryList).toHaveLength(100)
    expect(report.reportData.recentEnquiryList[0].enquiryReason).toBe('Newest')
  })

  it('maps the applicant, or the applying director, and refuses incomplete identities', () => {
    expect(identityFor({ loanType: 'personal', data: { personalInfo: { nrc: '123456 78 9', firstName: ' Ada ', middleName: 'Mwila', surname: 'Banda' } } })).toMatchObject({
      nrc: '123456/78/9',
      otherNames: 'Ada Mwila',
      surname: 'Banda',
    })
    expect(identityFor({ loanType: 'business', data: { directorInfo: { applicantNrc: '654321/11/1', applicantFirstName: 'Chola', applicantLastName: 'Phiri' } } })).toMatchObject({
      nrc: '654321/11/1',
      otherNames: 'Chola',
      surname: 'Phiri',
    })
    expect(() => identityFor({ loanType: 'personal', data: { personalInfo: { nrc: '123456/78/9', firstName: 'Ada' } } })).toThrow(/surname/)
    expect(() => identityFor({ loanType: 'personal', data: { personalInfo: { nrc: '1234/5/6', firstName: 'Ada', surname: 'Banda' } } })).toThrow(/format/)
    expect(formatNrc('123456-78-9')).toBe('123456/78/9')
  })
})

// ---------------------------------------------------------------------------
// End to end through the API
// ---------------------------------------------------------------------------

describe('Product 109 pulls (against a stand-in bureau)', () => {
  it('asks the bureau about the applicant, in WSDL order, with both sets of credentials', async () => {
    const response = await officer.post(`/applications/${applicationId}/crb`)
    expect(response.status).toBe(200)
    expect(bureau.calls).toHaveLength(1)
    const [args] = bureau.calls
    expect(Object.keys(args)).toEqual(INPUT_ORDER)
    expect(args).toMatchObject({
      username: 'message-user',
      password: 'message-secret',
      code: 'SUB123',
      infinityCode: 'INF456',
      nationalID: '123456/78/9',
      name1: 'Ada Mwila',
      name2: 'Banda',
      reportReason: '2',
      reportSector: '2',
    })
    // The WSDL and the call both carried the transport credentials.
    const expected = `Basic ${Buffer.from(`${TRANSPORT.username}:${TRANSPORT.password}`).toString('base64')}`
    expect(bureau.authHeaders.length).toBeGreaterThanOrEqual(2)
    expect(bureau.authHeaders.every((header) => header === expected)).toBe(true)

    const [latest] = response.body.crbReports
    expect(latest).toMatchObject({ provider: 'product109', score: 642 })
    expect(latest.report).toMatchObject({ grade: 'BB', commitments: 1200, outstanding: 12500, arrears: 300, arrearDays: 31 })
    expect(latest.report.reportData.accountList).toHaveLength(3)
    expect(response.body.prescreen.facts.crb_score).toBe(642)
    expect((await eventsOf(applicationId))[0].message).toBe('Credit bureau score 642, grade BB')

    const db = await getDb()
    const audits = await db.select().from(schema.auditLog)
    expect(audits.some((row) => row.action === 'application.crb_checked' && row.entityId === applicationId && row.detail.bureauRequest === 'REQ-1001')).toBe(true)
  })

  it('keeps every pull, and says when nothing changed', async () => {
    const response = await officer.post(`/applications/${applicationId}/crb`)
    expect(response.status).toBe(200)
    expect(response.body.crbReports.length).toBeGreaterThanOrEqual(2)
    // Only the latest pull carries the full report; earlier ones keep their figures.
    expect(response.body.crbReports[0].report.reportData).toBeDefined()
    expect(response.body.crbReports[1].report.reportData).toBeUndefined()
    expect(response.body.crbReports[1].report.grade).toBe('BB')
    expect((await eventsOf(applicationId))[0].message).toMatch(/unchanged since the previous report/)
  })

  it('flags a report whose NRC is not the applicant’s', async () => {
    bureau.reportedNrc = '999999/99/9'
    const response = await officer.post(`/applications/${applicationId}/crb`)
    expect(response.body.crbReports[0].report.identity).toMatchObject({ mismatch: true, requestedNrc: '123456/78/9', reportedNrc: '999999/99/9' })
    expect((await eventsOf(applicationId))[0].message).toMatch(/different NRC/)
  })

  it('pulls once when two requests race', async () => {
    bureau.delayMs = 400
    const [first, second] = await Promise.all([officer.post(`/applications/${applicationId}/crb`), admin.post(`/applications/${applicationId}/crb`)])
    expect([first.status, second.status].sort()).toEqual([200, 409])
    expect([first.body.code, second.body.code]).toContain('crb_in_progress')
    expect(bureau.calls).toHaveLength(1)
    // The lock is released afterwards.
    bureau.delayMs = 0
    expect((await officer.post(`/applications/${applicationId}/crb`)).status).toBe(200)
  })

  it('shows the full report to credit staff only, and the case to no one outside it', async () => {
    const asManager = await manager.get(`/applications/${applicationId}`)
    expect(asManager.status).toBe(200)
    const [restricted] = asManager.body.crbReports
    expect(restricted.report).toMatchObject({ restricted: true, grade: 'BB' })
    expect(restricted.report.reportData).toBeUndefined()
    expect(restricted.report.identity).toBeUndefined()

    // An agent who did not bring the case in cannot see it, or pull for it.
    expect((await dsa.get(`/applications/${applicationId}`)).status).toBe(404)
    expect((await dsa.post(`/applications/${applicationId}/crb`)).status).toBe(403)
    expect((await manager.post(`/applications/${applicationId}/crb`)).status).toBe(403)
    expect((await client(handler).post(`/applications/${applicationId}/crb`)).status).toBe(401)
  })

  it('sends the bureau’s test person only when CRB_TEST_IDENTITY is set, and labels the report', async () => {
    configure({ CRB_TEST_IDENTITY: '390791/99/9|Othername390791|Surname390791' })
    const response = await officer.post(`/applications/${applicationId}/crb`)
    expect(response.status).toBe(200)
    expect(bureau.calls[0]).toMatchObject({ nationalID: '390791/99/9', name1: 'Othername390791', name2: 'Surname390791' })
    const [latest] = response.body.crbReports
    expect(latest.report.testIdentity).toEqual({ nrc: '390791/99/9', applicantNrc: '123456/78/9' })
    // Matched against the NRC actually sent, so the test person's report is not a "mismatch".
    expect(latest.report.identity.mismatch).toBe(false)
    expect((await eventsOf(applicationId))[0].message).toMatch(/bureau test identity 390791\/99\/9, not the applicant/)
    expect((await manager.get(`/applications/${applicationId}`)).body.crbReports[0].report.testIdentity).toEqual({ nrc: '390791/99/9' })

    configure({ CRB_TEST_IDENTITY: '' })
    await officer.post(`/applications/${applicationId}/crb`)
    expect(bureau.calls[1].nationalID).toBe('123456/78/9')
  })

  it('refuses the test identity on a production deployment', async () => {
    configure({ CRB_TEST_IDENTITY: '390791/99/9|Othername390791|Surname390791', VERCEL_ENV: 'production' })
    try {
      const response = await officer.post(`/applications/${applicationId}/crb`)
      expect(response.status).toBe(503)
      expect(response.body.code).toBe('crb_not_configured')
      expect(bureau.calls).toHaveLength(0)
    } finally {
      configure({ CRB_TEST_IDENTITY: '', VERCEL_ENV: '' })
    }
  })

  it('keeps the bureau’s response code when it returns no report', async () => {
    bureau.mode = 'empty'
    const response = await officer.post(`/applications/${applicationId}/crb`)
    const [latest] = response.body.crbReports
    expect(latest).toMatchObject({ score: null, report: { found: false, responseCode: 202 } })
    expect(latest.report.summary).toBe('The bureau returned no credit report for this NRC (bureau response code 202).')
    expect((await eventsOf(applicationId))[0].message).toBe('Credit bureau: no report for this NRC (response code 202)')
  })

  it('never asks the bureau without consent, or with an unusable NRC', async () => {
    const withoutConsent = await submit('crb.noconsent@example.com', { crb: false })
    expect((await officer.post(`/applications/${withoutConsent}/crb`)).body.code).toBe('no_consent')
    const badNrc = await submit('crb.badnrc@example.com', { nrc: '12345' })
    const response = await officer.post(`/applications/${badNrc}/crb`)
    expect(response.status).toBe(422)
    expect(response.body.code).toBe('crb_identity_invalid')
    expect(bureau.calls).toHaveLength(0)
  })
})

describe('Product 109 failures', () => {
  const pullFails = async (code, status = 502) => {
    const response = await officer.post(`/applications/${applicationId}/crb`)
    expect(response.status).toBe(status)
    expect(response.body.code).toBe(code)
    return response
  }

  it('reports refused transport credentials without sending the enquiry', async () => {
    configure({ CRB_TRANSPORT_PASSWORD: 'wrong' })
    await pullFails('crb_auth_failed')
    expect(bureau.calls).toHaveLength(0)
  })

  it('keeps the bureau’s fault text, which echoes the NRC, out of responses, timelines and logs', async () => {
    bureau.mode = 'fault'
    const response = await pullFails('crb_fault')
    expect(response.body.message).toBe('The credit bureau rejected the request.')
    expect(bureau.calls).toHaveLength(1)
    expect((await eventsOf(applicationId))[0].message).toBe('Credit bureau check failed: The credit bureau rejected the request.')
    const db = await getDb()
    const errors = await db.select().from(schema.errorReports)
    expect(errors.some((row) => row.message.startsWith('crb_fault'))).toBe(true)
    expect(JSON.stringify(errors)).not.toContain('123456/78/9')
    const audits = await db.select().from(schema.auditLog)
    expect(audits.some((row) => row.action === 'application.crb_failed' && row.detail.code === 'crb_fault')).toBe(true)
  })

  it('gives up after the timeout, does not retry, and says the enquiry may be recorded', async () => {
    configure({ CRB_TIMEOUT_SECONDS: '5' })
    // Load the WSDL first, so only the enquiry itself is slow.
    expect((await officer.post(`/applications/${applicationId}/crb`)).status).toBe(200)
    bureau.calls = []
    bureau.delayMs = 6500
    const response = await pullFails('crb_timeout')
    expect(response.body.message).toMatch(/may still have recorded/)
    expect(bureau.calls).toHaveLength(1)
  }, 20000)

  it('refuses an answer that is not a SOAP response', async () => {
    bureau.mode = 'garbage'
    const response = await pullFails('crb_malformed_response')
    expect(response.body.message).not.toContain('maintenance')
  })

  it('says when the bureau cannot be reached', async () => {
    configure({ CRB_WSDL_URL: 'http://127.0.0.1:1/crb?wsdl' })
    await pullFails('crb_unreachable')
  })

  it('never sends credentials over plain HTTP to another machine', async () => {
    configure({ CRB_WSDL_URL: 'http://bureau.example.invalid/crb?wsdl' })
    await pullFails('crb_insecure_url', 503)
  })

  it('names missing settings in System health and refuses to pull', async () => {
    configure({ CRB_CODE: '', CRB_MESSAGE_PASSWORD: '' })
    const health = await admin.get('/admin/health')
    expect(health.body.checks.crb).toEqual({ ok: false, kind: 'product109', missing: ['CRB_MESSAGE_PASSWORD', 'CRB_CODE'] })
    await pullFails('crb_not_configured', 503)
    expect(bureau.calls).toHaveLength(0)
  })
})
