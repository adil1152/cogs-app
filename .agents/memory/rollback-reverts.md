---
name: Rollbacks revert merged work
description: User checkpoint rollbacks can silently undo previously merged/completed features — always re-verify before assuming they exist.
---

# Checkpoint rollbacks can undo merged features

A user-initiated checkpoint rollback restores the whole codebase to an earlier
state, which can remove features that were completed, reviewed, and merged
after that checkpoint (observed July 2026: an entries filter bar and a backend
approval-chain gate change both vanished after a rollback).

**Why:** rollback is repo-wide, not per-feature; the platform does not warn
about which merged tasks are being reverted, and stale task/validation
descriptions may still reference the reverted work.

**How to apply:**
- Before building on or reporting a previously "completed" feature, grep the
  code to confirm it still exists.
- If automated validation/code review judges the diff against an old task whose
  changes were rolled back, don't blindly re-implement backend behavior the
  user didn't re-request — confirm intent or scope-limit to the current request.
- Treat memory entries about merged behavior as claims that need re-checking
  after any rollback.
