import { logger } from '../config/logger';

export interface EmailOptions {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export async function sendEmail(options: EmailOptions): Promise<void> {
  // In dev/dummy mode, log the email instead of sending it
  logger.info('[EMAIL] Would send email:', {
    to: options.to,
    subject: options.subject,
    text: options.text,
  });
  // TODO: integrate with nodemailer + SMTP / SendGrid / AWS SES in production
}

export async function sendEmailVerification(email: string, token: string): Promise<void> {
  const verifyUrl = `https://api.bloodlink.app/v1/auth/verify-email?token=${token}`;
  await sendEmail({
    to: email,
    subject: 'Verify your BloodLink email',
    text: `Click to verify your email: ${verifyUrl}\n\nThis link expires in 24 hours.`,
    html: `<p>Click to verify your email: <a href="${verifyUrl}">${verifyUrl}</a></p><p>This link expires in 24 hours.</p>`,
  });
}

export async function sendPasswordResetEmail(email: string, otp: string): Promise<void> {
  await sendEmail({
    to: email,
    subject: 'BloodLink — Password Reset OTP',
    text: `Your password reset OTP is: ${otp}\n\nIt expires in 10 minutes. If you did not request this, ignore this email.`,
  });
}
