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

export const sendOtpEmail = async (email, code) => {
  await getTransporter().sendMail({
    from: FROM_EMAIL,
    to: email,
    subject: 'Your loan application resume code',
    text: `Your verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your verification code is <strong>${code}</strong>. It expires in 10 minutes.</p>`,
  })
}
