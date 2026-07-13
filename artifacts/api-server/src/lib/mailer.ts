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

export function isSmtpConfigured(row: SmtpSettingsRow): boolean {
  return Boolean(row.host && row.fromEmail);
}

export function isGraphConfigured(row: SmtpSettingsRow): boolean {
  return Boolean(
    row.graphTenantId &&
      row.graphClientId &&
      row.graphClientSecret &&
      row.graphSenderEmail,
  );
}

/** True when the saved settings can actually send mail via the chosen provider. */
export function isEmailConfigured(row: SmtpSettingsRow | null): boolean {
  if (!row) return false;
  return row.provider === "graph" ? isGraphConfigured(row) : isSmtpConfigured(row);
}

function buildTransport(settings: SmtpSettingsRow) {
  return nodemailer.createTransport({
    host: settings.host!,
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

async function sendViaSmtp(settings: SmtpSettingsRow, input: SendMailInput) {
  const transport = buildTransport(settings);
  try {
    await transport.sendMail({
      from: settings.fromName
        ? { name: settings.fromName, address: settings.fromEmail! }
        : settings.fromEmail!,
      to: input.to,
      subject: input.subject,
      text: input.text,
      html: input.html,
    });
  } finally {
    transport.close();
  }
}

/**
 * Send via the Microsoft Graph API (Microsoft 365 work/school tenants).
 * Uses the OAuth2 client-credentials flow: the app registration must have the
 * *application* permission `Mail.Send` with admin consent granted.
 */
async function sendViaGraph(settings: SmtpSettingsRow, input: SendMailInput) {
  const tenant = settings.graphTenantId!;
  const tokenRes = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: settings.graphClientId!,
        client_secret: settings.graphClientSecret!,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  const tokenJson = (await tokenRes.json().catch(() => ({}))) as {
    access_token?: string;
    error_description?: string;
  };
  if (!tokenRes.ok || !tokenJson.access_token) {
    const detail = tokenJson.error_description?.split("\n")[0]?.slice(0, 300);
    throw new Error(
      `Microsoft sign-in failed${detail ? `: ${detail}` : ` (HTTP ${tokenRes.status})`}`,
    );
  }

  const sendRes = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(settings.graphSenderEmail!)}/sendMail`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${tokenJson.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: {
          subject: input.subject,
          body: input.html
            ? { contentType: "HTML", content: input.html }
            : { contentType: "Text", content: input.text },
          toRecipients: [{ emailAddress: { address: input.to } }],
        },
        saveToSentItems: true,
      }),
      signal: AbortSignal.timeout(20_000),
    },
  );
  if (!sendRes.ok) {
    let detail: string | undefined;
    try {
      const j = (await sendRes.json()) as { error?: { message?: string } };
      detail = j.error?.message?.slice(0, 300);
    } catch {
      /* ignore */
    }
    throw new Error(
      `Microsoft 365 rejected the email${detail ? `: ${detail}` : ` (HTTP ${sendRes.status})`}`,
    );
  }
}

/**
 * Send an email using the admin-configured email settings (SMTP server or
 * Microsoft 365 Graph API, depending on the saved provider).
 * Throws if email is not configured or the provider rejects the message.
 */
export async function sendMail(input: SendMailInput): Promise<void> {
  const settings = await getSmtpSettingsRow();
  if (!isEmailConfigured(settings)) {
    throw new Error("Email is not configured");
  }
  if (settings!.provider === "graph") {
    await sendViaGraph(settings!, input);
  } else {
    await sendViaSmtp(settings!, input);
  }
}
