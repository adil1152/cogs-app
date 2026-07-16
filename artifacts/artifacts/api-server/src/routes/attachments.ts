import { Router, type IRouter, type Request, type Response } from "express";
import {
  db,
  dailyEntriesTable,
  entryAttachmentsTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { CreateEntryAttachmentBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { getProjectVisibility } from "../lib/projectAccess";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { recordAudit } from "../lib/audit";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

async function loadEntry(id: string) {
  const [entry] = await db
    .select()
    .from(dailyEntriesTable)
    .where(eq(dailyEntriesTable.id, id));
  return entry;
}

function serializeAttachment(a: typeof entryAttachmentsTable.$inferSelect) {
  return {
    id: a.id,
    dailyEntryId: a.dailyEntryId,
    objectPath: a.objectPath,
    fileName: a.fileName,
    fileSize: a.fileSize ?? 0,
    mimeType: a.mimeType ?? "",
    uploadedById: a.uploadedById,
    uploadedAt: a.uploadedAt.toISOString(),
  };
}

router.get(
  "/entries/:id/attachments",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const entry = await loadEntry(id);
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    const v = await getProjectVisibility(
      req.user!.id,
      req.user!.role,
      entry.projectId,
    );
    if (req.user!.role !== "admin" && !v.canViewSummary && !v.canEditEntries) {
      res.status(403).json({ error: "No access" });
      return;
    }
    const rows = await db
      .select()
      .from(entryAttachmentsTable)
      .where(eq(entryAttachmentsTable.dailyEntryId, id))
      .orderBy(entryAttachmentsTable.uploadedAt);
    res.json(rows.map(serializeAttachment));
  },
);

router.post(
  "/entries/:id/attachments",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const entry = await loadEntry(id);
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    if (entry.lockedAt) {
      res.status(403).json({ error: "Entry is locked" });
      return;
    }
    const v = await getProjectVisibility(
      req.user!.id,
      req.user!.role,
      entry.projectId,
    );
    if (req.user!.role !== "admin" && !v.canEditEntries) {
      res.status(403).json({ error: "Edit access required" });
      return;
    }
    const parsed = CreateEntryAttachmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }
    // Only PDF attachments are accepted: the pdfRequired submit guard counts
    // on attachments actually being PDFs.
    const mime = (parsed.data.mimeType ?? "").toLowerCase();
    const ext = parsed.data.fileName.toLowerCase().endsWith(".pdf");
    if (mime !== "application/pdf" || !ext) {
      res.status(400).json({ error: "Only PDF files are accepted" });
      return;
    }
    // Normalize the raw upload URL (or already-normalized /objects/... path)
    // so we always store the canonical /objects/<id> form.
    const normalized = objectStorage.normalizeObjectEntityPath(
      parsed.data.objectPath,
    );
    if (!normalized.startsWith("/objects/")) {
      res.status(400).json({ error: "Invalid object path" });
      return;
    }
    // Verify the file actually exists in private storage and stamp ACL
    // metadata with the uploader as owner. This binds the attachment row to a
    // real upload from /storage/uploads/request-url and prevents callers from
    // registering arbitrary objectPaths to bypass the pdfRequired submit guard.
    try {
      await objectStorage.trySetObjectEntityAclPolicy(normalized, {
        owner: req.user!.id,
        visibility: "private",
      });
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        res.status(400).json({ error: "Uploaded object not found" });
        return;
      }
      throw err;
    }
    const [created] = await db
      .insert(entryAttachmentsTable)
      .values({
        dailyEntryId: id,
        objectPath: normalized,
        fileName: parsed.data.fileName,
        fileSize: parsed.data.fileSize ?? 0,
        mimeType: mime,
        uploadedById: req.user!.id,
      })
      .returning();
    await recordAudit({
      dailyEntryId: id,
      projectId: entry.projectId,
      action: "UPDATE",
      actorId: req.user!.id,
      field: "attachment",
      newValue: parsed.data.fileName,
    });
    res.status(201).json(serializeAttachment(created));
  },
);

router.delete(
  "/entries/:id/attachments/:attachmentId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const id = req.params.id as string;
    const attachmentId = req.params.attachmentId as string;
    const entry = await loadEntry(id);
    if (!entry) {
      res.status(404).json({ error: "Entry not found" });
      return;
    }
    if (entry.lockedAt) {
      res.status(403).json({ error: "Entry is locked" });
      return;
    }
    const v = await getProjectVisibility(
      req.user!.id,
      req.user!.role,
      entry.projectId,
    );
    if (req.user!.role !== "admin" && !v.canEditEntries) {
      res.status(403).json({ error: "Edit access required" });
      return;
    }
    const [existing] = await db
      .select()
      .from(entryAttachmentsTable)
      .where(
        and(
          eq(entryAttachmentsTable.id, attachmentId),
          eq(entryAttachmentsTable.dailyEntryId, id),
        ),
      );
    if (!existing) {
      res.status(204).end();
      return;
    }
    await db
      .delete(entryAttachmentsTable)
      .where(eq(entryAttachmentsTable.id, attachmentId));
    await recordAudit({
      dailyEntryId: id,
      projectId: entry.projectId,
      action: "UPDATE",
      actorId: req.user!.id,
      field: "attachment",
      oldValue: existing.fileName,
    });
    res.status(204).end();
  },
);

export default router;
