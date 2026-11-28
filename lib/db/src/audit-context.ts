import { AsyncLocalStorage } from "node:async_hooks";
import type pg from "pg";

export const auditContext = new AsyncLocalStorage<{
  actorId?: string;
  actorName?: string;
  requestId?: string;
  path?: string;
}>();

/** Set attribution on EVERY checkout, including anonymous/background work.
 * Transactions retain one connection/context; concurrent requests never share it.
 */
export function attachAuditContext(pool: pg.Pool) {
  const connect = pool.connect.bind(pool);
  pool.connect = ((callback?: (error: Error | undefined, client: pg.PoolClient, release: (error?: Error | boolean) => void) => void) => {
    const context = JSON.stringify(auditContext.getStore() ?? {});
    const acquire = async () => {
      const client = await connect();
      try {
        await client.query("SELECT set_config('app.audit_context', $1, false)", [context]);
        return client;
      } catch (error) {
        client.release(true);
        throw error;
      }
    };
    if (!callback) return acquire();
    void acquire().then(
      client => callback(undefined, client, client.release.bind(client)),
      error => callback(error, undefined as never, () => {}),
    );
    return undefined;
  }) as typeof pool.connect;
}
