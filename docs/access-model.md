# Access model

Aldermoor Schools has three staff roles. Every MCP tool call runs as exactly
one staff member, set by `ADMISSIONS_STAFF_ID` when the server starts, and
what that person may see is enforced **twice**, by two independent layers:

1. **Server**: each tool checks the role and campus before querying, and
   keeps an explicit campus filter in its SQL.
2. **Database**: the server connects as the restricted `admissions_app` role,
   and row level security (RLS) filters every row by the same rules. A bug in
   a tool's SQL returns fewer rows, not another campus's rows.

Either layer alone should be enough. The tests in `test/` check each one
separately: the RLS tests query tables directly as `admissions_app`, without
going through a tool.

## Who sees what

| Data | `counsellor` | `campus_head` | `leadership` |
|---|---|---|---|
| `campuses`, `staff` | read | read | read |
| `inquiries`, `applicants`, `guardians` (own campus) | read | read | — |
| `inquiry_activity` (per-inquiry staleness, own campus) | read | read | — |
| `followups` (own campus) | read + insert as self | read + insert as self | — |
| `applicant_private`: date of birth, learning support, medical notes (own campus) | — | read, only via `get_inquiry` with `include_sensitive: true` | — |
| Anything on another campus | — | — | — |
| Cross-campus aggregates (counts only) | — | — | a later step |
| `audit_log` | append as self, can't read | append as self, can't read | append as self, can't read |

No role can `UPDATE` or `DELETE` anything, and only `followups` and
`audit_log` accept `INSERT`.

**Leadership sees patterns, not people.** Both tools refuse leadership, and
RLS returns zero individual rows to it. Aggregates will come from a function
that returns counts only.

## Database layer

Defined in [`20261106200000_app_role_and_row_level_security.sql`](../supabase/migrations/20261106200000_app_role_and_row_level_security.sql).

- **Identity per call.** The server's per-call helper (`src/tool-call.ts`)
  opens a transaction and first runs
  `set_config('app.staff_id', <id>, true)`. The `true` makes the setting
  transaction-local, so it can't carry over into the next call on the same
  pooled connection.
- **One source of identity.** Every policy asks `current_staff()`
  (`SECURITY DEFINER`, `STABLE`, fixed `search_path`) who the caller is.
- **Fail closed.** If `app.staff_id` is missing, malformed or names nobody,
  `current_staff()` returns no row and every policy matches nothing.
- **Campus via the inquiry.** The campus rule is written once, on
  `inquiries`. The policies on `applicants`, `guardians`, `followups` and
  `applicant_private` check for a visible inquiry, so they inherit that rule.
- **Views obey RLS.** `inquiry_activity` has `security_invoker = true`.
  Without it, a view runs with its owner's rights and bypasses RLS.
  `CREATE OR REPLACE VIEW` drops this option, so any redefinition must
  restate it.

### Database roles

| Role | Used by | Notes |
|---|---|---|
| `admissions_app` | the MCP server (`DATABASE_URL`) | Login only. Not superuser, owns no tables, no `BYPASSRLS`. Its password `admissions_app_local_only` is for the local Supabase stack only. Any shared or production environment must set its own out of band. |
| `postgres` | migrations, seeding, tests (`ADMIN_DATABASE_URL`) | Admin. Owns the tables and has `BYPASSRLS`. The app never connects as it. |
| `service_role` | nothing in this project | Supabase admin role with `BYPASSRLS`. The app never uses it. |
| `anon`, `authenticated` | nothing in this project | Supabase Data API roles. All access to our tables is revoked, including the default grants for future tables. |

## Sensitive fields

All sensitive child data lives in one table, `applicant_private`, so access
can be decided for the whole table at once instead of per column at every
query site.

`get_inquiry` returns these fields in a separate `sensitiveFields` section
only when **both** of the following hold:

- the caller is the `campus_head` of the inquiry's campus, and
- the call sets `include_sensitive: true`.

The tool description tells the model to set it only when the user explicitly
needs one of these fields. A counsellor who sets it gets the normal record
plus a `sensitiveFieldsNote` saying the fields are available to the campus
head only. That is not an error.

If the server's role check were ever wrong, RLS
(`applicant_private_campus_head`) would still return no row to anyone else.
`test/get-inquiry-sensitive.test.ts` checks this by running the query as a
counsellor with the role check skipped.

## Audit log

Every tool call writes exactly one `audit_log` row:

| Column | Meaning |
|---|---|
| `staff_id` | Who made the call. RLS only accepts the current staff member. |
| `tool_name` | Which tool was called. |
| `arguments` | The arguments after schema validation, including defaults that were applied. |
| `outcome` | `ok`, `denied` or `error` (see below). |
| `result_count` | Rows returned. Set only when `outcome = 'ok'`. |
| `sensitive_returned` | `true` when the response included `applicant_private` fields. Can only be true when `outcome = 'ok'`. |

The outcomes mean:

- **`ok`**: the call returned data, which may be zero rows.
- **`denied`**: an access rule refused the call. That includes a leadership
  caller, another campus, and a `get_inquiry` id that wasn't found. The
  server can't tell "doesn't exist" from "another campus" (that is
  deliberate), so both are recorded as denied, which is where probing for
  ids would show up.
- **`error`**: the call failed partway. No data was returned, and the error
  is logged to stderr without row values.

How it works:

- **No tool can skip it.** The audit row is written by the same per-call
  helper that sets the identity, in the same transaction as the call's
  reads. A tool's work function returns an audit-tagged result rather than
  an MCP response, and only that helper can turn it into one.
- **Fail closed.** The result is released only after the transaction,
  including the audit insert, commits. If the audit row can't be written,
  the tool returns an error and no data.
- **Append-only.** Triggers reject `UPDATE` and `DELETE` even for admin
  roles, and `admissions_app` has no `SELECT` on the table.

**Known limit:** a call whose arguments fail the tool's input schema (for
example a malformed `inquiry_id`) is rejected by the MCP SDK before the
handler runs, so it is **not audited**. Such calls return no data.

## Seed staff and switching the acting staff member

| `ADMISSIONS_STAFF_ID` | Name | Role | Campus |
|---|---|---|---|
| `00000000-0000-0000-0000-000000000001` | Lana Hussein | counsellor | erbil |
| `00000000-0000-0000-0000-000000000002` | Darin Saleh | campus_head | erbil |
| `00000000-0000-0000-0000-000000000003` | Fatima Al Suwaidi | counsellor | dubai |
| `00000000-0000-0000-0000-000000000004` | Omar Al Farsi | campus_head | dubai |
| `00000000-0000-0000-0000-000000000005` | Lena Gruber | counsellor | vienna |
| `00000000-0000-0000-0000-000000000006` | Markus Weber | campus_head | vienna |
| `00000000-0000-0000-0000-000000000007` | Nadia Rahimi | leadership | — |
| `00000000-0000-0000-0000-000000000008` | Thomas Becker | leadership | — |

`.mcp.json` passes `${ADMISSIONS_STAFF_ID:-…0001}` to the server, so the
default is Lana Hussein. To act as someone else, set the variable in the
shell that launches Claude Code, then start Claude Code from that shell:

```powershell
$env:ADMISSIONS_STAFF_ID = '00000000-0000-0000-0000-000000000002'   # Darin Saleh, Erbil campus head
claude
```

```bash
ADMISSIONS_STAFF_ID=00000000-0000-0000-0000-000000000002 claude
```

The value is read from Claude Code's environment, so running `/mcp`
reconnect in a session that is already open keeps the old staff member. On
startup the server prints who it is running as to stderr, and it refuses to
start if the id matches no staff member.
