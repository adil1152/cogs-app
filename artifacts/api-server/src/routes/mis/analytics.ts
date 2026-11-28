import { Router, type IRouter, type Request, type Response } from "express";
import { requireAuth } from "../../middlewares/requireAuth";
import { loadMisAccess } from "../../lib/mis/access";
import {
  analyticsCsv,
  analyticsPdf,
  analyticsXlsx,
  AnalyticsAuthorizationError,
  AnalyticsQueryError,
  parseAnalyticsQuery,
  runAnalytics,
} from "../../lib/mis/analytics";

const router: IRouter = Router();

function queryRecord(req: Request): Record<string, unknown> {
  return req.query as Record<string, unknown>;
}

function errorStatus(error: unknown): number {
  if (error instanceof AnalyticsAuthorizationError) return 403;
  if (error instanceof AnalyticsQueryError) return 400;
  return 500;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "MIS analytics request failed";
}

async function analyticsRequest(req: Request, res: Response, exportRequest: boolean): Promise<void> {
  try {
    const parsed = parseAnalyticsQuery(queryRecord(req), exportRequest);
    const access = await loadMisAccess(req.user!.id);
    if (!access.roles.length) {
      res.status(403).json({ error: "No MIS access grant" });
      return;
    }
    const data = await runAnalytics(access, parsed.filters, exportRequest, exportRequest);
    if (!exportRequest) {
      res.json(data);
      return;
    }
    const format = parsed.format!;
    const baseName = "mis-analytics";
    if (format === "csv") {
      res.type("text/csv").attachment(`${baseName}.csv`).send(analyticsCsv(data));
      return;
    }
    if (format === "xlsx") {
      res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .attachment(`${baseName}.xlsx`).send(analyticsXlsx(data));
      return;
    }
    res.type("application/pdf").attachment(`${baseName}.pdf`).send(await analyticsPdf(data));
  } catch (error) {
    const status = errorStatus(error);
    if (status === 500) throw error;
    res.status(status).json({ error: errorMessage(error) });
  }
}

router.get("/mis/analytics", requireAuth, async (req, res): Promise<void> => {
  await analyticsRequest(req, res, false);
});

router.get("/mis/analytics/export", requireAuth, async (req, res): Promise<void> => {
  await analyticsRequest(req, res, true);
});

export default router;