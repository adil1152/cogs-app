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
  position: number;
  levelName: string;
}

export function defaultChain(): ChainEntry[] {
  return DEFAULT_CHAIN.map((levelName, i) => ({
    position: i + 1,
    levelName,
  }));
}

export async function getProjectChain(
  projectId: string,
): Promise<ChainEntry[]> {
  const rows = await db
    .select({
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
    arr.push({ position: r.position, levelName: r.levelName });
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
