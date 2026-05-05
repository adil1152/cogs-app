import { Router, type IRouter, type Request, type Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { UpdateUserRoleBody } from "@workspace/api-zod";
import { requireAdmin } from "../middlewares/requireAuth";

const router: IRouter = Router();

function toAppUser(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    profileImageUrl: u.profileImageUrl,
    role: (u.role as "admin" | "user") ?? "user",
  };
}

router.get(
  "/users",
  requireAdmin,
  async (_req: Request, res: Response): Promise<void> => {
    const rows = await db.select().from(usersTable).orderBy(usersTable.email);
    res.json(rows.map(toAppUser));
  },
);

router.patch(
  "/users/:id/role",
  requireAdmin,
  async (req: Request, res: Response): Promise<void> => {
    const parsed = UpdateUserRoleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid body" });
      return;
    }

    const [updated] = await db
      .update(usersTable)
      .set({ role: parsed.data.role, updatedAt: new Date() })
      .where(eq(usersTable.id, (req.params.id as string)))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    res.json(toAppUser(updated));
  },
);

export default router;
