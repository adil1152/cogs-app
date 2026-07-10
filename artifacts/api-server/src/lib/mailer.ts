import nodemailer from "nodemailer";
import { db, smtpSettingsTable, type SmtpSettingsRow } from "@workspace/db";
import { eq } from "drizzle-orm";

export async function getSmtpSettingsRow(): Promise<SmtpSettingsRow | null> {
  const [row] = await db
    .select()
    .from(smtpSettingsTable)
    .where(eq(smtpSettingsTable.id, "default"));
  return row ?? null;
}

function buildTransport(settings: SmtpSettingsRow) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    secure: settings.secure,
    auth:
      settings.username && settings.password
        ? { user: settings.username, pass: settings.password }
        : undefined,
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 20_000,
  });
}

export interface SendMailInput {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

/**
 * Send an email using the admin-configured SMTP settings.
 * Throws if no settings are saved or the SMTP server rejects the message.
 */
export async function sendMail(input: SendMailInput): Promise<void> {
  const settings = await getSmtpSettingsRow();
  if (!settings) {
    throw new Error("SMTP is not configured");
  }
  const transport = buildTransport(settings);
  try {
    await transport.sendMail({
      from: settings.fromName
        ? { name: settings.fromName, address: settings.fromEmail }
        : settings.fromEmail,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  } finally {
    transport.close();
  }
}
