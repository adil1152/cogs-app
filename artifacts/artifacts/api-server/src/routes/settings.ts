import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetSmtpSettingsResponse,
  UpdateSmtpSettingsBody,
  TestSmtpSettingsBody,
} from "@workspace/api-zod";
import { db, smtpSettingsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth";
import { getSmtpSettingsRow, isEmailConfigured, sendMail } from "../lib/mailer";

const router: IRouter = Router();

function serializeSettings(
  row: Awaited<ReturnType<typeof getSmtpSettingsRow>>,
) {
  if (!row) {
    return {
      configured: false,
      provider: "smtp" as const,
      host: null,
      port: null,
      secure: null,
      username: null,
      fromEmail: null,
      fromName: null,
      hasPassword: false,
      graphTenantId: null,
      graphClientId: null,
      hasGraphClientSecret: false,
      graphSenderEmail: null,
    };
  }
  return {
    configured: isEmailConfigured(row),
    provider: row.provider === "graph" ? ("graph" as const) : ("smtp" as const),
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    hasPassword: Boolean(row.password),
    graphTenantId: row.graphTenantId,
    graphClientId: row.graphClientId,
    hasGraphClientSecret: Boolean(row.graphClientSecret),
    graphSenderEmail: row.graphSenderEmail,
  };
}

router.get(
  "/settings/smtp",
  requireAdmin,
  async (_req: Request, res: Response) => {
    const row = await getSmtpSettingsRow();
    res.json(GetSmtpSettingsResponse.parse(serializeSettings(row)));
  },
);

router.put(
  "/settings/smtp",
  requireAdmin,
  async (req: Request, res: Response) => {
    const parsed = UpdateSmtpSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid email settings" });
      return;
    }
    const existing = await getSmtpSettingsRow();
    const b = parsed.data;

    // Empty/omitted secrets keep the previously saved ones so admins can
    // edit other fields without re-typing them.
    const password =
      b.password != null && b.password.length > 0
        ? b.password
        : (existing?.password ?? null);
    const graphClientSecret =
      b.graphClientSecret != null && b.graphClientSecret.length > 0
        ? b.graphClientSecret
        : (existing?.graphClientSecret ?? null);

    const host = b.host?.trim() || (existing?.host ?? null);
    const fromEmail = b.fromEmail?.trim() || (existing?.fromEmail ?? null);
    const graphTenantId =
      b.graphTenantId?.trim() || (existing?.graphTenantId ?? null);
    const graphClientId =
      b.graphClientId?.trim() || (existing?.graphClientId ?? null);
    const graphSenderEmail =
      b.graphSenderEmail?.trim() || (existing?.graphSenderEmail ?? null);

    if (b.provider === "smtp" && (!host || !fromEmail)) {
      res
        .status(400)
        .json({ error: "SMTP host and sender email are required" });
      return;
    }
    if (
      b.provider === "graph" &&
      (!graphTenantId || !graphClientId || !graphClientSecret || !graphSenderEmail)
    ) {
      res.status(400).json({
        error:
          "Tenant ID, Client ID, Client secret and sender mailbox are all required for Microsoft 365",
      });
      return;
    }

    const values = {
      provider: b.provider,
      host,
      port: b.port ?? existing?.port ?? 587,
      secure: b.secure ?? existing?.secure ?? false,
      username:
        b.username !== undefined
          ? b.username?.trim() || null
          : (existing?.username ?? null),
      password,
      fromEmail,
      fromName:
        b.fromName !== undefined
          ? b.fromName?.trim() || null
          : (existing?.fromName ?? null),
      graphTenantId,
      graphClientId,
      graphClientSecret,
      graphSenderEmail,
      updatedAt: new Date(),
    };

    const [row] = await db
      .insert(smtpSettingsTable)
      .values({ id: "default", ...values })
      .onConflictDoUpdate({
        target: smtpSettingsTable.id,
        set: values,
      })
      .returning();

    res.json(GetSmtpSettingsResponse.parse(serializeSettings(row)));
  },
);

router.post(
  "/settings/smtp/test",
  requireAdmin,
  async (req: Request, res: Response) => {
    const parsed = TestSmtpSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid recipient email" });
      return;
    }
    const row = await getSmtpSettingsRow();
    if (!isEmailConfigured(row)) {
      res.status(400).json({ error: "Save your email settings first" });
      return;
    }
    try {
      await sendMail({
        to: parsed.data.to,
        subject: "COGS Tracker — email test",
        text: "This is a test email from COGS Tracker. Your email settings are working.",
      });
      res.json({ success: true });
    } catch (err) {
      req.log.warn({ err }, "Test email send failed");
      const message =
        err instanceof Error ? err.message : "Could not send test email";
      res.status(400).json({ error: `Send failed: ${message}` });
    }
  },
);

export default router;
