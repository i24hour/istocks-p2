import nodemailer from "nodemailer"

const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD,
    },
})

interface SendEmailOptions {
    to: string
    subject: string
    html: string
}

function resolveBaseUrl(baseUrl?: string) {
  return baseUrl || process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"
}

export async function sendEmail({ to, subject, html }: SendEmailOptions) {
    try {
        await transporter.sendMail({
            from: `"iStocks" <${process.env.SMTP_USER}>`,
            to,
            subject,
            html,
        })
        return { success: true }
    } catch (error) {
        console.error("Email send error:", error)
        return { success: false, error }
    }
}

export async function sendVerificationEmail(email: string, token: string, baseUrl?: string) {
  const verifyUrl = `${resolveBaseUrl(baseUrl)}/verify-email?token=${encodeURIComponent(token)}`

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; background: #0d0d0d; color: #fff; }
        .container { max-width: 500px; margin: 0 auto; padding: 40px; }
        .logo { font-size: 24px; font-weight: bold; color: #10b981; margin-bottom: 24px; }
        .button { 
          display: inline-block; 
          background: linear-gradient(to right, #10b981, #059669);
          color: white; 
          padding: 12px 32px; 
          text-decoration: none; 
          border-radius: 12px;
          font-weight: 600;
          margin: 24px 0;
        }
        .footer { color: #6b7280; font-size: 12px; margin-top: 32px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">📈 iStocks</div>
        <h2>Verify your email</h2>
        <p>Welcome to iStocks! Click the button below to verify your email address:</p>
        <a href="${verifyUrl}" class="button">Verify Email</a>
        <p class="footer">
          If you didn't create an account, you can safely ignore this email.<br>
          This link expires in 24 hours.
        </p>
      </div>
    </body>
    </html>
  `

    return sendEmail({
        to: email,
        subject: "Verify your iStocks account",
        html,
    })
}

export async function sendPasswordResetEmail(email: string, token: string, baseUrl?: string) {
  const resetUrl = `${resolveBaseUrl(baseUrl)}/reset-password?token=${encodeURIComponent(token)}`

    const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: 'Inter', sans-serif; background: #0d0d0d; color: #fff; }
        .container { max-width: 500px; margin: 0 auto; padding: 40px; }
        .logo { font-size: 24px; font-weight: bold; color: #10b981; margin-bottom: 24px; }
        .button { 
          display: inline-block; 
          background: linear-gradient(to right, #10b981, #059669);
          color: white; 
          padding: 12px 32px; 
          text-decoration: none; 
          border-radius: 12px;
          font-weight: 600;
          margin: 24px 0;
        }
        .footer { color: #6b7280; font-size: 12px; margin-top: 32px; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="logo">📈 iStocks</div>
        <h2>Reset your password</h2>
        <p>You requested a password reset. Click the button below:</p>
        <a href="${resetUrl}" class="button">Reset Password</a>
        <p class="footer">
          If you didn't request this, you can safely ignore this email.<br>
          This link expires in 1 hour.
        </p>
      </div>
    </body>
    </html>
  `

    return sendEmail({
        to: email,
        subject: "Reset your iStocks password",
        html,
    })
}
