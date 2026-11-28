# MIS parent/bulk entry contract

This is the backend contract for the parent transaction introduced for bulk
MIS entry submissions. A parent is the durable identity of one project and
reporting period. Its children are the service lines created by the existing
bulk-entry form. Existing standalone MIS entries remain standalone records and
are never inferred to belong to a parent.

All endpoints require the existing MIS session authentication and the existing
project-scoped permissions. Dates are ISO calendar dates (`YYYY-MM-DD`), and
timestamps are ISO-8601 strings. Error responses use the existing shape:

```json
{ "error": "human-readable message", "conflict": null }
```

`conflict` is omitted unless a period conflict is returned. Conflict details
are deliberately redacted unless the caller can view the conflicting entry.

## Project period policy

`GET /api/mis/projects/{id}` and `GET /api/mis/projects` include:

```json
{
  "reportingSettings": {
    "defaultEntryStatus": "draft",
    "preventDuplicatePeriods": true,
    "allowMultipleEntries": false,
    "overlapPolicy": "nonoverlap",
    "maxEntriesPerPeriod": null
  }
}
```

`allowMultipleEntries` defaults to `false`. `overlapPolicy` is one of:

* `nonoverlap` (the default when multiple entries are enabled);
* `overlap` (multiple overlapping entries are explicitly allowed); or
* `unlimited` (no period-count or overlap restriction).

`maxEntriesPerPeriod` is a positive integer or `null`; it is evaluated for
each new or edited parent and is allowed only when
`allowMultipleEntries` is true. The writable project body accepts these
properties under `reportingSettings`; all project updates are serialized with
the existing project configuration permission and the same project advisory
lock used by parent period checks.

## Create a parent (integrated bulk create)

`POST /api/mis/entries/bulk`

Request:

```json
{
  "projectId": "project-id",
  "fromDate": "2026-09-01",
  "toDate": "2026-09-30",
  "lines": [
    {
      "serviceId": "service-a",
      "quantity": 500,
      "rate": 10,
      "remarks": "Optional note",
      "rateReason": null
    }
  ],
  "action": "draft"
}
```

`action` is `draft` or `submit`. Blank lines (quantity omitted or `null`) are
not persisted. The entire parent and all non-blank children are atomic. A
successful response is `201`:

```json
{
  "parent": {
    "id": "parent-uuid",
    "bulkNumber": "MIS-BULK-000125",
    "projectId": "project-id",
    "fromDate": "2026-09-01",
    "toDate": "2026-09-30",
    "status": "draft",
    "entryType": "bulk",
    "createdById": "user-id",
    "createdAt": "2026-09-01T12:00:00.000Z",
    "updatedAt": "2026-09-01T12:00:00.000Z"
  },
  "items": [
    {
      "id": "child-uuid",
      "parentId": "parent-uuid",
      "bulkNumber": "MIS-BULK-000125",
      "projectId": "project-id",
      "serviceId": "service-a",
      "fromDate": "2026-09-01",
      "toDate": "2026-09-30",
      "quantity": 500,
      "rate": 10,
      "amount": 5000,
      "status": "draft"
    }
  ]
}
```

`items` retain the complete legacy `MisEntry` response fields; the excerpt
above shows only the parent metadata that is additive. A duplicate or
overlapping period returns `409` and rolls back every line:

```json
{
  "error": "An MIS entry already exists for this project for the selected period.",
  "conflict": {
    "reason": "overlap",
    "existing": {
      "bulkNumber": "MIS-BULK-000124",
      "fromDate": "2026-08-15",
      "toDate": "2026-09-15",
      "status": "submitted",
      "parentId": "parent-uuid"
    },
    "canView": true,
    "openUrl": "/mis/entries/parents/parent-uuid"
  }
}
```

When `canView` is false, `existing` and `openUrl` are omitted. Existing
standalone records participate in conflict checks but have no fabricated
`bulkNumber` or `parentId`; a safe conflict contains `canView: false` unless
the caller has permission to view that standalone record.

## List/search parents

`GET /api/mis/entries/parents`

Query parameters: `bulkNumber`, `projectId`, `projectNumber` (project code),
`fromDate`, `toDate`, `createdById`, `status`, `entryType` (`bulk`),
`search`, `page` (default 1), and `pageSize` (default 50, maximum 200).

`200` response:

```json
{
  "items": [
    {
      "id": "parent-uuid",
      "bulkNumber": "MIS-BULK-000125",
      "projectId": "project-id",
      "projectName": "ABC Project",
      "projectNumber": "ABC-001",
      "fromDate": "2026-09-01",
      "toDate": "2026-09-30",
      "status": "submitted",
      "entryType": "bulk",
      "createdById": "user-id",
      "createdByName": "A User",
      "childCount": 6,
      "updatedAt": "2026-09-02T12:00:00.000Z"
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 50
}
```

Only parents visible through the existing `view_entries` project scope are
returned. Legacy standalone entries are not converted into parents.

## Parent detail and children

`GET /api/mis/entries/parents/{id}`

`200` response:

```json
{
  "parent": {
    "id": "parent-uuid",
    "bulkNumber": "MIS-BULK-000125",
    "projectId": "project-id",
    "projectName": "ABC Project",
    "projectNumber": "ABC-001",
    "fromDate": "2026-09-01",
    "toDate": "2026-09-30",
    "status": "submitted",
    "entryType": "bulk",
    "createdById": "user-id",
    "createdAt": "2026-09-01T12:00:00.000Z",
    "updatedAt": "2026-09-02T12:00:00.000Z"
  },
  "items": [
    { "id": "child-uuid", "parentId": "parent-uuid", "bulkNumber": "MIS-BULK-000125", "status": "submitted", "serviceName": "Service A" }
  ]
}
```

`items` contain full legacy entry fields plus `parentId` and `bulkNumber`.
The response is permission-filtered as a whole; no child can be used to
bypass the parent project's view permission.

## Parent edit

`PATCH /api/mis/entries/parents/{id}`

Request:

```json
{
  "fromDate": "2026-09-01",
  "toDate": "2026-09-30",
  "lines": [
    {
      "serviceId": "service-a",
      "quantity": 500,
      "rate": 10,
      "remarks": "Updated",
      "rateReason": "Approved commercial adjustment"
    }
  ],
  "reason": "Corrected service quantities"
}
```

The replacement is atomic, and uses the same rate, service, project-period,
and blank-line rules as create. `reason` is required for an approved edit.
`projectId` and `action` are optional on edit; the parent project is used when
`projectId` is omitted, and omitting `action` preserves the current status.
Draft, submitted, rejected, and returned parents may be edited by the
existing `edit_entries` permission. Approved parents additionally require
`edit_approved`; MIS administrators receive that permission by default.
Single-entry `PATCH /api/mis/entries/{id}` rejects child IDs with `409` and a
link to the parent; it never permits a child-only mutation.

`200` response:

```json
{
  "parent": { "id": "parent-uuid", "bulkNumber": "MIS-BULK-000125", "status": "submitted" },
  "items": [ { "id": "child-uuid", "parentId": "parent-uuid", "status": "submitted" } ]
}
```

Every child receives the parent's single status, and a parent status can never
be mixed across child rows.

## Parent workflow actions

`POST /api/mis/entries/parents/{id}/action`

Request:

```json
{ "action": "submit", "remarks": "Ready for review" }
```

`action` is `submit`, `approve`, `reject`, `return`, `reset`, or `cancel`.
The endpoint locks the parent and synchronizes every child status in one
transaction. `200` returns the same `{parent,items}` shape as parent detail.
An invalid transition or concurrent change returns `409`; the database
transaction rolls back, leaving all children at their previous status.

## Parent deletion

`DELETE /api/mis/entries/parents/{id}`

Deletes the parent and all children atomically using the existing delete
permissions. Approved parents require `delete_approved`; the operation is
audited against both the parent and children. `200`:

```json
{ "success": true, "parentId": "parent-uuid", "bulkNumber": "MIS-BULK-000125" }
```

## Parent audit history

`GET /api/mis/entries/parents/{id}/history`

`200` returns newest-first append-only audit records:

```json
[
  {
    "id": "audit-uuid",
    "parentId": "parent-uuid",
    "bulkNumber": "MIS-BULK-000125",
    "action": "EDIT_APPROVED",
    "actorId": "user-id",
    "actorName": "A User",
    "remarks": "Corrected approved quantity",
    "oldValues": {},
    "newValues": {},
    "occurredAt": "2026-09-03T12:00:00.000Z"
  }
]
```

## Legacy endpoints and invariants

* `GET /api/mis/entries` remains a child/standalone line list. Bulk children
  add `parentId` and `bulkNumber`; response pagination and all existing fields
  remain intact.
* `GET /api/mis/entries/{id}`, action, history, and delete remain supported.
  They return `409` with `parentId`/`openUrl` for bulk children rather than
  mutating one child. Parent actions are the only way to change a bulk
  transaction's status.
* No existing standalone row is assigned a parent during migration.
* Period conflict checks compare inclusive ranges (`existing.fromDate <=
  new.toDate && existing.toDate >= new.fromDate`) across both parents and
  standalone lines. Project advisory locks and row locks protect concurrent
  create, edit, and project-policy updates.