import { db, projectApprovalChainTable } from "@workspace/db";
import { asc, eq, inArray } from "drizzle-orm";

/**
 * Default per-project approval chain used when a project has no explicit
 * chain rows. Position 1 (OP) is the first approver, position 5 (Additional)
 * is the final lock.
 */
export const DEFAULT_CHAIN: readonly string[] = [
  "OP",
  "SOP",
  "COO",
  "CC",
  "Additional",
] as const;

export interface ChainEntry {
  id: string | null;
  position: number;
  levelName: string;
}

export function defaultChain(): ChainEntry[] {
  return DEFAULT_CHAIN.map((levelName, i) => ({
    id: null,
    position: i + 1,
    levelName,
  }));
}

/**
 * Persist the default chain rows for a project that has none yet, returning the
 * freshly-inserted rows (with real ids). Seeding on project creation guarantees
 * every project has stable level ids from day one, so the first edit of the
 * approval order can track surviving levels by id (and keep their approvers)
 * even when the admin renames a built-in level. A no-op if rows already exist.
 */
export async function seedDefaultChain(
  projectId: string,
): Promise<ChainEntry[]> {
  const existing = await db
    .select({
      id: projectApprovalChainTable.id,
      position: projectApprovalChainTable.position,
      levelName: projectApprovalChainTable.levelName,
    })
    .from(projectApprovalChainTable)
    .where(eq(projectApprovalChainTable.projectId, projectId))
    .orderBy(asc(projectApprovalChainTable.position));
  if (existing.length > 0) return existing;

  const inserted = await db
    .insert(projectApprovalChainTable)
    .values(
      DEFAULT_CHAIN.map((levelName, i) => ({
        projectId,
        position: i + 1,
        levelName,
      })),
    )
    .returning({
      id: projectApprovalChainTable.id,
      position: projectApprovalChainTable.position,
      levelName: projectApprovalChainTable.levelName,
    });
  return inserted.sort((a, b) => a.position - b.position);
}

export async function getProjectChain(
  projectId: string,
): Promise<ChainEntry[]> {
  const rows = await db
    .select({
      id: projectApprovalChainTable.id,
      position: projectApprovalChainTable.position,
      levelName: projectApprovalChainTable.levelName,
    })
    .from(projectApprovalChainTable)
    .where(eq(projectApprovalChainTable.projectId, projectId))
    .orderBy(asc(projectApprovalChainTable.position));
  if (rows.length === 0) return defaultChain();
  return rows;
}

export async function getProjectChainsMap(
  projectIds: string[],
): Promise<Map<string, ChainEntry[]>> {
  const out = new Map<string, ChainEntry[]>();
  if (projectIds.length === 0) return out;
  const rows = await db
    .select()
    .from(projectApprovalChainTable)
    .where(inArray(projectApprovalChainTable.projectId, projectIds))
    .orderBy(
      asc(projectApprovalChainTable.projectId),
      asc(projectApprovalChainTable.position),
    );
  for (const r of rows) {
    const arr = out.get(r.projectId) ?? [];
    arr.push({ id: r.id, position: r.position, levelName: r.levelName });
    out.set(r.projectId, arr);
  }
  for (const id of projectIds) {
    if (!out.has(id)) out.set(id, defaultChain());
  }
  return out;
}

export function levelNameAt(chain: ChainEntry[], position: number): string {
  return chain[position - 1]?.levelName ?? `L${position}`;
}
