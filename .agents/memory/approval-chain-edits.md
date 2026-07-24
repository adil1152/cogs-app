---
name: Approval chain edits
description: Policy for how a project's approval chain can be edited and how approver assignments survive edits.
---

# Editing a project's approval chain

Approvals route by numeric **position** and history is recorded by position, so a
chain edit that shifts positions while entries are mid-cycle would misroute or
corrupt history.

## Policy / decisions

- **Every project must have persisted chain rows (with real ids) from creation.**
  The default chain is seeded on project create and legacy projects were
  backfilled. **Why:** approver assignments must survive a *rename* of any level
  (including built-in OP/SOP/COO/CC), which requires matching surviving levels by
  a stable id — a synthetic null-id default chain cannot do that, and the first
  edit would silently drop all assignments. **How to apply:** never reintroduce a
  code path where a project with assignments has no persisted chain rows; if you
  add a new way to create projects, seed the chain there too.

- **Surviving levels keep their id across a save.** The set-chain handler rebuilds
  rows but reuses each survivor's existing id. **Why:** a stale client that
  re-saves with older ids must still match the same levels rather than orphaning
  assignments. **How to apply:** don't "simplify" the handler back to
  delete+insert with fresh ids.

- **Chain edits are gated all-or-nothing on cycle-tied entries.** If any of the
  project's daily entries is tied to the approval cycle (an approval in progress
  OR any recorded approval-history row), the edit is rejected (409) with a
  countable message telling the admin to reset/delete those entries first.
