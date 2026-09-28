import nodemailer from 'nodemailer'

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

export const sendOtpEmail = async (email, code, { purpose = 'resume', agentName = '' } = {}) => {
  if (purpose === 'offer') {
    await getTransporter().sendMail({
      from: FROM_EMAIL,
      to: email,
      subject: 'Accept your loan offer',
      text: `To accept your loan offer with ${agentName || 'our staff member'}, read them this code: ${code}. It expires in 10 minutes. You can also accept it yourself at any time by signing in to your applications.`,
      html: `<p>To accept your loan offer with ${escapeHtml(agentName || 'our staff member')}, read them this code: <strong>${code}</strong>. It expires in 10 minutes.</p><p style="color:#64748b">You can also accept it yourself by signing in to your applications.</p>`,
    })
    return
  }
  if (purpose === 'consent') {
    const who = agentName ? `${agentName}, an iZyane agent,` : 'An iZyane agent'
    await getTransporter().sendMail({
      from: FROM_EMAIL,
      to: email,
      subject: 'Confirm your loan application',
      text: `${who} is completing a loan application with you. If you agree to it being submitted, read this code to them: ${code}. It expires in 10 minutes. If you are not applying for a loan, do not share it.`,
      html: `<p>${escapeHtml(who)} is completing a loan application with you.</p><p>If you agree to it being submitted, read this code to them: <strong>${code}</strong>. It expires in 10 minutes.</p><p style="color:#64748b">If you are not applying for a loan, do not share this code.</p>`,
    })
    return
  }
  await getTransporter().sendMail({
    from: FROM_EMAIL,
    to: email,
    subject: 'Your loan application resume code',
    text: `Your verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
  })
}

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])

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

  await getTransporter().sendMail({
    from: FROM_EMAIL,
    to: email,
    subject,
    text: `Hello ${name},\n\n${intro}\n\n${action}: ${url}\n\n${expiry}`,
    html: `<p>Hello ${escapeHtml(name)},</p><p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(url)}">${action}</a></p><p style="color:#64748b">${expiry}</p>`,
  })
}

/**
 * Tells an applicant their application changed in a way that needs them or answers them
 * (information requested, approved, not approved). Details stay behind the sign-in: the
 * email names the reference and links to the page, nothing more.
 */
export const sendApplicationUpdateEmail = async (email, { reference, headline, body, url }) => {
  await getTransporter().sendMail({
    from: FROM_EMAIL,
    to: email,
    subject: `${headline} — application ${reference}`,
    text: `${body}\n\nSee your application: ${url}\n\nReference: ${reference}`,
    html: `<p>${escapeHtml(body)}</p><p><a href="${escapeHtml(url)}">See your application</a></p><p style="color:#64748b">Reference: ${escapeHtml(reference)}</p>`,
  })
}

/** A staff notification: what happened, and a link to it in the workspace. */
export const sendStaffNotificationEmail = async (email, { name, title, body, url }) => {
  await getTransporter().sendMail({
    from: FROM_EMAIL,
    to: email,
    subject: title,
    text: `Hello ${name},\n\n${title}${body ? `\n${body}` : ''}\n\nOpen: ${url}\n\nYou can turn these emails off from your profile in the workspace.`,
    html: `<p>Hello ${escapeHtml(name)},</p><p><strong>${escapeHtml(title)}</strong>${body ? `<br>${escapeHtml(body)}` : ''}</p><p><a href="${escapeHtml(url)}">Open in the workspace</a></p><p style="color:#64748b">You can turn these emails off from your profile in the workspace.</p>`,
  })
}
