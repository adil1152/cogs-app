import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { eq } from "drizzle-orm";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import {
  db,
  dailyEntriesTable,
  entryAttachmentsTable,
} from "@workspace/db";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage";
import { requireAuth } from "../middlewares/requireAuth";
import { getProjectVisibility } from "../lib/projectAccess";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned URL for file upload. Authenticated users only —
 * uploads are intended to be tied to entry attachments via a follow-up
 * POST /entries/:id/attachments call.
 */
router.post(
  "/storage/uploads/request-url",
  requireAuth,
  async (req: Request, res: Response) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Missing or invalid required fields" });
      return;
    }

    try {
      const { name, size, contentType } = parsed.data;
      const uploadURL = await objectStorageService.getObjectEntityUploadURL();
      const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
          metadata: { name, size, contentType },
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Error generating upload URL");
      res.status(500).json({ error: "Failed to generate upload URL" });
    }
  },
);

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * These are unconditionally public — no authentication or ACL checks.
 */
router.get("/storage/public-objects/*filePath", async (req: Request, res: Response) => {
  try {
    const raw = req.params.filePath;
    const filePath = Array.isArray(raw) ? raw.join("/") : raw;
    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve private object entities. Authorization: the caller must be an admin,
 * or the requested objectPath must correspond to an attachment whose entry's
 * project is visible to the caller (canViewSummary OR canEditEntries).
 */
router.get(
  "/storage/objects/*path",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const raw = req.params.path;
      const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
      const objectPath = `/objects/${wildcardPath}`;

      // Authorize via attachment ownership (admins bypass).
      if (req.user!.role !== "admin") {
        const [attachment] = await db
          .select({ dailyEntryId: entryAttachmentsTable.dailyEntryId })
          .from(entryAttachmentsTable)
          .where(eq(entryAttachmentsTable.objectPath, objectPath));
        if (!attachment) {
          res.status(404).json({ error: "Object not found" });
          return;
        }
        const [entry] = await db
          .select({ projectId: dailyEntriesTable.projectId })
          .from(dailyEntriesTable)
          .where(eq(dailyEntriesTable.id, attachment.dailyEntryId));
        if (!entry) {
          res.status(404).json({ error: "Object not found" });
          return;
        }
        const v = await getProjectVisibility(
          req.user!.id,
          req.user!.role,
          entry.projectId,
        );
        if (!v.canViewSummary && !v.canEditEntries) {
          res.status(403).json({ error: "Forbidden" });
          return;
        }
      }

      const objectFile = await objectStorageService.getObjectEntityFile(objectPath);
      const response = await objectStorageService.downloadObject(objectFile);

      res.status(response.status);
      response.headers.forEach((value, key) => res.setHeader(key, value));

      if (response.body) {
        const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
        nodeStream.pipe(res);
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        req.log.warn({ err: error }, "Object not found");
        res.status(404).json({ error: "Object not found" });
        return;
      }
      req.log.error({ err: error }, "Error serving object");
      res.status(500).json({ error: "Failed to serve object" });
    }
  },
);

export default router;
