import nodemailer from 'nodemailer'
import { brandName } from './branding.js'
import { codeBlock, details, itemList, notice, paragraph, renderEmail } from './emailLayout.js'

const isTrue = (value) => String(value).toLowerCase() === 'true'

const useSsl = isTrue(process.env.EMAIL_USE_SSL)
const useTls = isTrue(process.env.EMAIL_USE_TLS)
const FROM_EMAIL = process.env.DEFAULT_FROM_EMAIL || process.env.EMAIL_HOST_USER

let transporter = null

const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.EMAIL_HOST,
      port: Number(process.env.EMAIL_PORT || 587),
      secure: useSsl, // true for implicit TLS (port 465), false for STARTTLS (port 587)
      requireTLS: !useSsl && useTls,
      auth: {
        user: process.env.EMAIL_HOST_USER,
        pass: process.env.EMAIL_HOST_PASSWORD,
      },
    })
  }
  return transporter
}

/** Sends one message: the plain text, and the branded HTML (emailLayout.js) with its inline logo. */
const send = async ({ to, subject, text, attachments = [], ...layout }) => {
  const rendered = await renderEmail({ title: subject, ...layout })
  await getTransporter().sendMail({ from: FROM_EMAIL, to, subject, text, html: rendered.html, attachments: [...attachments, ...rendered.attachments] })
}

const DO_NOT_SHARE = 'If you didn’t ask for this code, ignore this email and don’t share the code with anyone. We will never ask you for it by phone.'

export const sendOtpEmail = async (email, code, { purpose = 'resume', agentName = '' } = {}) => {
  if (purpose === 'sign') {
    return send({
      to: email,
      subject: 'Your code to sign your loan documents',
      text: `Your code to sign your loan documents is ${code}. It expires in 10 minutes. If you did not ask for it, do not share it with anyone.`,
      preheader: `${code} is your signing code`,
      eyebrow: 'Signing code',
      title: 'Confirm your signature',
      blocks: [paragraph('Enter this code on the signing page to confirm it’s you signing your loan documents.'), codeBlock(code), notice(DO_NOT_SHARE, { tone: 'warning' })],
    })
  }
  if (purpose === 'offer') {
    const who = agentName || 'our staff member'
    return send({
      to: email,
      subject: 'Accept your loan offer',
      text: `To accept your loan offer with ${who}, read them this code: ${code}. It expires in 10 minutes. You can also accept it yourself at any time by signing in to your applications.`,
      preheader: `Read ${code} to ${who} to accept your offer`,
      eyebrow: 'Accepting in person',
      title: 'Accept your loan offer',
      blocks: [paragraph(`To accept your loan offer with ${who}, read them this code.`), codeBlock(code), paragraph('You can also accept it yourself at any time by signing in to your applications.', { muted: true })],
    })
  }
  if (purpose === 'consent') {
    const brand = await brandName()
    const who = agentName ? `${agentName}, a ${brand} agent,` : `A ${brand} agent`
    return send({
      to: email,
      subject: 'Confirm your loan application',
      text: `${who} is completing a loan application with you. If you agree to it being submitted, read this code to them: ${code}. It expires in 10 minutes. If you are not applying for a loan, do not share it.`,
      preheader: 'Read this code to your agent to submit your application',
      eyebrow: 'Your consent',
      title: 'Confirm your loan application',
      blocks: [
        paragraph(`${who} is completing a loan application with you. If you agree to it being submitted, read this code to them.`),
        codeBlock(code),
        notice('If you are not applying for a loan, don’t share this code with anyone.', { tone: 'warning' }),
      ],
    })
  }
  if (purpose === 'login') {
    return send({
      to: email,
      subject: 'Your code to sign in to your applications',
      text: `Your code to sign in to your loan applications is ${code}. It expires in 10 minutes. If you did not ask for it, do not share it with anyone.`,
      preheader: `${code} is your sign-in code`,
      eyebrow: 'Sign-in code',
      title: 'Sign in to your applications',
      blocks: [paragraph('Enter this code to sign in and see your loan applications.'), codeBlock(code), notice(DO_NOT_SHARE, { tone: 'warning' })],
    })
  }
  return send({
    to: email,
    subject: 'Your loan application resume code',
    text: `Your verification code is ${code}. It expires in 10 minutes.`,
    preheader: `${code} is your code to continue your application`,
    eyebrow: 'Verification code',
    title: 'Continue your application',
    blocks: [paragraph('Enter this code to pick up your loan application where you left off.'), codeBlock(code), notice(DO_NOT_SHARE, { tone: 'warning' })],
  })
}

/**
 * Staff account links. `purpose` is 'invite' (new account, 7 days) or 'reset' (forgotten
 * password, 1 hour); the wording differs, the link does the same thing — set a password.
 */
export const sendPasswordLinkEmail = async (email, { name, url, purpose, invitedBy, roleLabel }) => {
  const isInvite = purpose === 'invite'
  const subject = isInvite ? 'You’ve been invited to the loan workspace' : 'Reset your loan workspace password'
  const intro = isInvite
    ? `${invitedBy || 'An administrator'} has invited you to the loan workspace as ${roleLabel}.`
    : 'We received a request to reset your password. If it wasn’t you, you can ignore this email.'
  const action = isInvite ? 'Set your password' : 'Choose a new password'
  const expiry = isInvite ? 'This link expires in 7 days.' : 'This link expires in 1 hour.'

  await send({
    to: email,
    subject,
    text: `Hello ${name},\n\n${intro}\n\n${action}: ${url}\n\n${expiry}`,
    preheader: intro,
    eyebrow: isInvite ? 'Invitation' : 'Password reset',
    title: isInvite ? `Welcome, ${name}` : 'Reset your password',
    blocks: [
      paragraph(`Hello ${name},`),
      paragraph(intro),
      ...(isInvite ? [details([['Your role', roleLabel || 'Staff']])] : []),
    ],
    action: { label: action, url },
    footnote: expiry,
  })
}

/**
 * Tells an applicant their application changed in a way that needs them or answers them
 * (information requested, approved, not approved). Details stay behind the sign-in: the
 * email names the reference and links to the page, nothing more.
 */
export const sendApplicationUpdateEmail = async (email, { reference, headline, body, url }) => {
  await send({
    to: email,
    subject: `${headline} — application ${reference}`,
    text: `${body}\n\nSee your application: ${url}\n\nReference: ${reference}`,
    preheader: body,
    eyebrow: 'Application update',
    title: headline,
    blocks: [paragraph(body), details([['Reference', reference]])],
    action: { label: 'See your application', url },
    footnote: 'For your security, the details are only shown once you sign in.',
  })
}

/**
 * The documents a workflow stage sends the applicant (stageDocuments.js), as one email:
 * what each is and whether to sign it, the unsigned PDFs attached, and a button to sign
 * them online. `documents` is [{ label, sign }]; `attachments` is nodemailer's
 * [{ filename, content, contentType }].
 */
export const sendStageDocumentsEmail = async (email, { reference, documents, url, attachments = [] }) => {
  const toSign = documents.some((document) => document.sign)
  const subject = toSign ? `Documents to sign for ${reference}` : `Documents for ${reference}`
  const lead = toSign
    ? 'We have attached documents for your loan application. Please read them, then sign online, or print, sign and upload a scan or photo of each one marked to sign.'
    : 'We have attached documents for your loan application. Please read them and keep them for your records.'
  const lines = documents.map((document) => `${document.label}${document.sign ? ' (to sign)' : ''}`)
  const action = toSign ? 'Sign your documents' : 'See your application'
  await send({
    to: email,
    subject,
    text: `${lead}\n\n${lines.map((line) => `- ${line}`).join('\n')}\n\n${action}: ${url}\n\nReference: ${reference}`,
    preheader: toSign ? `${documents.length} ${documents.length === 1 ? 'document' : 'documents'} ready for your signature` : 'Your loan documents',
    eyebrow: toSign ? 'Action needed' : 'Your documents',
    title: toSign ? 'Your documents are ready to sign' : 'Your loan documents',
    blocks: [
      paragraph(lead),
      itemList(documents.map((document) => ({ label: document.label, badge: document.sign ? 'To sign' : 'To keep' }))),
      details([['Reference', reference], ['Attached', `${attachments.length} PDF${attachments.length === 1 ? '' : 's'}`]]),
    ],
    action: { label: action, url },
    footnote: 'Signing online takes a minute: you draw or type your signature and confirm it with a code we email you.',
    attachments,
  })
}

/** A staff notification: what happened, and a link to it in the workspace. */
export const sendStaffNotificationEmail = async (email, { name, title, body, url }) => {
  await send({
    to: email,
    subject: title,
    text: `Hello ${name},\n\n${title}${body ? `\n${body}` : ''}\n\nOpen: ${url}\n\nYou can turn these emails off from your profile in the workspace.`,
    preheader: body || title,
    eyebrow: 'Workspace notification',
    title,
    blocks: [paragraph(`Hello ${name},`), ...(body ? [paragraph(body)] : [])],
    action: { label: 'Open in the workspace', url },
    footnote: 'You can turn these emails off from your profile in the workspace.',
  })
}

/**
 * A nudge to finish an unfinished application, sent by staff to someone who agreed on the
 * first step to be contacted about it. Names no details: they resume with an emailed code.
 */
export const sendDraftReminderEmail = async (email, { name, product, url, staffName }) => {
  const greeting = name ? `Hello ${name},` : 'Hello,'
  const brand = await brandName()
  const lead = `You started a ${product} application with ${brand} and haven’t finished it yet. Everything you entered is saved.`
  const how = 'Open the link, choose “Resume an application”, and we’ll email you a code to pick up where you left off.'
  const from = staffName ? `\n\n${staffName} from the ${brand} team is happy to help if you have questions.` : ''
  await send({
    to: email,
    subject: 'Finish your loan application',
    text: `${greeting}\n\n${lead}\n\n${how}\n\n${url}${from}\n\nUnfinished applications are deleted after 7 days without changes.`,
    preheader: 'Everything you entered is saved. Pick up where you left off.',
    eyebrow: 'Almost there',
    title: 'Finish your loan application',
    blocks: [
      paragraph(greeting),
      paragraph(lead),
      itemList([{ label: 'Open the link below' }, { label: 'Choose “Resume an application”' }, { label: 'Enter the code we email you' }]),
      ...(staffName ? [notice(`${staffName} from the ${brand} team is happy to help if you have questions.`)] : []),
    ],
    action: { label: 'Finish my application', url },
    footnote: 'Unfinished applications are deleted after 7 days without changes.',
  })
}
