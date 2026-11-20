---
name: Whole-system audit scope
description: Admin change tracking covers both COGS and MIS, not only entries.
---
The user wants admins to track all persisted changes across COGS and MIS, including projects, services, security, and approver settings.

**Why:** Entry-specific histories are not sufficient for system administration.

**How to apply:** Keep new business tables covered by audit capture. The shared log is limited to global system admins, not MIS-only roles, because it exposes cross-project financial and security changes.

Capture mutations atomically with database triggers and attribute each checked-out connection to its request. Preserve history independently of deleted entities and redact credentials before storage. Background operations must be labeled as system/unauthenticated rather than inheriting a prior actor.

**Why:** Auditing only route handlers can miss cascades and future write paths; pooled connections can misattribute changes unless context is reset every time.

**How to apply:** Keep coverage/concurrency/rollback tests when changing persistence. Never backfill invented before-values or actors for changes made before tracking began.
