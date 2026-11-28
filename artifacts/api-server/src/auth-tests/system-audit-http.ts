import assert from "node:assert/strict";
import { writeFile, readFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import app from "../app";
import { createSession, deleteSession } from "../lib/auth";
import { ListSystemAuditLogResponse } from "@workspace/api-zod";

const fixturePath = "/tmp/system-audit-sessions.json";
if (process.argv[2] === "cleanup") {
  const sessions = JSON.parse(await readFile(fixturePath, "utf8"));
  await deleteSession(sessions.adminSid);
  await deleteSession(sessions.userSid);
  await unlink(fixturePath);
  await pool.end();
} else {
  const rows = await pool.query(`SELECT id,email,first_name AS "firstName",last_name AS "lastName",
    mobile,profile_image_url AS "profileImageUrl",role
    FROM users WHERE role IN ('admin','user')`);
  const admin = rows.rows.find(r => r.role === "admin");
  const user = rows.rows.find(r => r.role === "user");
  assert.ok(admin && user, "Requires existing admin and user for permission verification");
  const adminSid = await createSession({ user: admin });
  const userSid = await createSession({ user });
  await writeFile(fixturePath, JSON.stringify({ adminSid, userSid }), { mode: 0o600 });
  const server = app.listen(0);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}/api`;
  const request = (path: string, sid?: string, method = "GET", body?: unknown) => fetch(base + path, {
    method, headers: { ...(sid ? { Cookie: `sid=${sid}` } : {}), "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  try {
    assert.equal((await request("/admin/audit-log")).status, 401);
    assert.equal((await request("/admin/audit-log", userSid)).status, 403);
    assert.equal((await request("/admin/audit-log?from=2026-02-31", adminSid)).status, 400);
    const marker = `Audit verification ${randomUUID().slice(0, 8)}`;
    const created = await request("/projects", adminSid, "POST", {
      name: marker, location: "Temporary verification", contractStart: "2026-01-01", contractEnd: "2026-12-31",
    });
    assert.equal(created.status, 201);
    const project = await created.json() as { id: string };
    try {
      const updated = await request(`/projects/${project.id}`, adminSid, "PATCH", { name: marker + " updated" });
      assert.equal(updated.status, 200);
      const log = await request(`/admin/audit-log?search=${encodeURIComponent(marker)}&module=COGS&action=UPDATE`, adminSid);
      assert.equal(log.status, 200);
      const result = ListSystemAuditLogResponse.parse(await log.json());
      const event = result.items.find(r => r.entityId === project.id);
      assert.ok(event);
      assert.equal(event.actorId, admin.id);
      assert.equal(event.oldValues?.name, marker);
      assert.equal(event.newValues?.name, marker + " updated");
      assert.ok(event.requestId);
      assert.equal(event.path, `PATCH /api/projects/${project.id}`);
    } finally {
      assert.equal((await request(`/projects/${project.id}`, adminSid, "DELETE")).status, 204);
    }
    const history = ListSystemAuditLogResponse.parse(await (await request(`/admin/audit-log?search=${project.id}`, adminSid)).json());
    assert.ok(history.items.some(r => r.action === "DELETE" && r.projectName === marker + " updated"));
    console.log("PASS: admin access, non-admin rejection, filters, request attribution, before/after and deleted-project history. Private test sessions ready.");
  } finally {
    await new Promise<void>(resolve => server.close(() => resolve()));
    await pool.end();
  }
}
