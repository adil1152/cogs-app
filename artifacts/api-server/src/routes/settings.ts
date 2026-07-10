import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetSmtpSettingsResponse,
  UpdateSmtpSettingsBody,
  TestSmtpSettingsBody,
} from "@workspace/api-zod";
import { db, smtpSettingsTable } from "@workspace/db";
import { requireAdmin } from "../middlewares/requireAuth";
import { getSmtpSettingsRow, sendMail } from "../lib/mailer";

const router: IRouter = Router();

function serializeSettings(
  row: Awaited<ReturnType<typeof getSmtpSettingsRow>>,
) {
  if (!row) {
    return {
      configured: false,
      host: null,
      port: null,
      secure: null,
      username: null,
      fromEmail: null,
      fromName: null,
      hasPassword: false,
    };
  }
  return {
    configured: true,
    host: row.host,
    port: row.port,
    secure: row.secure,
    username: row.username,
    fromEmail: row.fromEmail,
    fromName: row.fromName,
    hasPassword: Boolean(row.password),
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
      res.status(400).json({ error: "Invalid SMTP settings" });
      return;
    }
    const existing = await getSmtpSettingsRow();
    const b = parsed.data;
    const username = b.username?.trim() || null;
    // Empty/omitted password keeps the previously saved one so admins can
    // edit other fields without re-typing it.
    const password =
      b.password != null && b.password.length > 0
        ? b.password
        : (existing?.password ?? null);

    const values = {
      host: b.host.trim(),
      port: b.port,
      secure: b.secure,
      username,
      password,
      fromEmail: b.fromEmail.trim(),
      fromName: b.fromName?.trim() || null,
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
    if (!row) {
      res.status(400).json({ error: "Save SMTP settings first" });
      return;
    }
    try {
      await sendMail({
        to: parsed.data.to,
        subject: "COGS Tracker — SMTP test",
        text: "This is a test email from COGS Tracker. Your SMTP settings are working.",
      });
      res.json({ success: true });
    } catch (err) {
      req.log.warn({ err }, "SMTP test send failed");
      const message =
        err instanceof Error ? err.message : "Could not send test email";
      res.status(400).json({ error: `Send failed: ${message}` });
    }
  },
);

export default router;
