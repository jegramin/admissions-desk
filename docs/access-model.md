# Access model

Aldermoor Schools has three roles. This is the data access matrix a later
step (the MCP server + auth) must enforce. **Nothing in this repo enforces
it yet** — this step only shapes the schema so it *can* be enforced
cleanly, in particular by keeping every sensitive child field in one table,
[`applicant_private`](../supabase/migrations/20261106141841_initial_schema.sql).

| Data | `counsellor` | `campus_head` | `leadership` |
|---|---|---|---|
| `campuses` (own campus) | read | read | read (all) |
| `campuses` (other campuses) | — | — | read |
| `guardians` / `applicants` (own campus's inquiries) | read | read | — (individual records never exposed) |
| `applicant_private` (DOB, learning support, medical) | — | read | — |
| `inquiries` (own campus) | read + write | read + write | — (individual rows never exposed) |
| `inquiries` (other campuses) | — | — | — (individual rows never exposed) |
| `followups` (own campus) | read + write | read + write | — |
| `inquiry_activity` (own campus, per-inquiry staleness) | read | read | — |
| Cross-campus aggregates (counts, stage funnels, staleness rates) | — | — | read |
| `audit_log` | own actions only (append) | own actions only (append) | own actions only (append) |

## Rules of thumb

- **Campus scoping**: a `counsellor` or `campus_head` only ever sees rows
  where `campus_id` matches their own `staff.campus_id`. Enforced today by
  the `staff_campus_matches_role` CHECK constraint (a `counsellor` or
  `campus_head` row cannot have a null `campus_id`); enforced against
  *data* access in the later auth step.
- **Sensitive fields**: `applicant_private` is a separate table precisely
  so access control can be "may this role join this table at all" instead
  of a per-column rule repeated at every query site. `counsellor` is never
  granted access to it, in any campus.
- **Leadership sees patterns, not people**: leadership's queries must
  always return aggregates (counts, rates, stage distributions) grouped
  across campuses — never a single guardian, applicant, or inquiry row.
  This is a query-shape rule for the later MCP tools, not something the
  schema can fully enforce on its own.
- **Audit is universal and one-directional**: every tool call is logged to
  `audit_log` — including denied ones (`allowed = false`) — and the table
  rejects `UPDATE`/`DELETE` at the database level (see the
  `audit_log_no_update` / `audit_log_no_delete` triggers in the migration).
