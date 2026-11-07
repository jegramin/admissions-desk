# Admissions Desk

An MCP server that lets school admissions staff work with inquiry data through Claude, with campus and role rules enforced in the database, not just in prompts.

[![CI](https://github.com/jegramin/admissions-desk/actions/workflows/ci.yml/badge.svg)](https://github.com/jegramin/admissions-desk/actions/workflows/ci.yml)

## Demo

Video: _link to be added_.

## The problem

Aldermoor Schools (fictional) runs three campuses: Erbil, Dubai and Vienna. Each has counsellors handling family inquiries and a campus head, and there's a leadership team over all three. Staff need quick answers, such as which families haven't heard back, what was said last, or how the pipeline looks this week. Those answers come from records about children, including medical and learning-support notes. Each person should see only their own campus, only the fields their role allows, and every access should be recorded.

## What it exposes

| Name | Kind | What it does | Counsellor | Campus head | Leadership |
|---|---|---|---|---|---|
| `find_stale_inquiries` | Tool, read | Active inquiries with no contact for at least N whole days, most stale first, up to 50 | Own campus | Own campus | Denied |
| `get_inquiry` | Tool, read | One inquiry: applicant, guardian contact details, stage, assigned staff, 5 latest followups | Own campus, no sensitive fields | Own campus; sensitive fields when `include_sensitive: true` | Denied |
| `pipeline_summary` | Tool, read | Counts only: inquiries per stage, active total, stale count | Own campus | Own campus | Any campus, or all combined |
| `log_followup` | Tool, write | Records a followup that already happened (call, email, WhatsApp, meeting) and returns the new days-since-contact. Sends nothing. | Own campus | Own campus | Denied |
| `admissions://policy/{campus}` | Resource | The campus admissions policy: intakes, grades, fee ranges, documents, 3-working-day reply standard | Read | Read | Read |
| `weekly_leadership_brief` | Prompt | Tells the model to call `pipeline_summary` and write a brief of under 200 words, with no names or individual records | Get | Get | Get |

Leadership sees patterns, not people. Its only view of inquiry data is `pipeline_summary`. The full rules are in [docs/access-model.md](docs/access-model.md).

## Example

This is real tool output from the seed data, abridged. Claude's prose replies are left out.

**As Lana Hussein, Erbil counsellor:** "Which inquiries have gone more than 5 days without contact?"

```text
find_stale_inquiries { "min_days_without_contact": 6 }

6 active inquiries in erbil have gone 6+ whole days without contact:
- [offered] Rana Jabbar (Grade 5, 2027) — 11d since last contact — guardian: Mariam Jabbar (English) — ...
- [assessment] Emma Steiner (Grade 4, 2028) — 10d since last contact — guardian: Elias Steiner (Spanish) — ...
- [applied] Khalid Kareem (Grade 3, 2027) — 9d since last contact — ...
- [tour_booked] Sophie Bauer (Grade 2, 2028) — 8d since last contact — ...
- [contacted] Ibrahim Al Dhaheri (Grade 1, 2027) — 7d since last contact — ...
- [new] Finn Fischer (KG2, 2028) — never contacted (6d since created) — ...
```

"Does Emma Steiner have any medical notes?"

```text
get_inquiry { "inquiry_id": "…0003-000000000005", "include_sensitive": true }

Emma Steiner (Grade 4, 2028) — campus: erbil, stage: assessment, source: phone
Guardian: Elias Steiner <elias.steiner5@example.com>, +1-555-0105 (prefers Spanish)
...
Note: Sensitive fields (date of birth, learning support notes, medical notes) are available to the campus head only.
```

**As Darin Saleh, Erbil campus head**, the same call:

```text
...
SENSITIVE (campus head only):
  Date of birth: 2019-06-06
  Learning support notes: none recorded
  Medical notes: Carries own epinephrine auto-injector for nut allergy.
```

## Security design

| Control | How |
|---|---|
| Two independent layers | Each tool checks role and campus and keeps a campus filter in its SQL. Row level security applies the same rules in Postgres. A bug in one layer returns fewer rows, not another campus's rows. |
| Restricted database role | The server connects as `admissions_app`: not superuser, owns no tables, no `BYPASSRLS`. |
| Identity per call | Each tool call is one transaction that starts with `set_config('app.staff_id', …, true)`. The setting is transaction-local, so it can't leak into the next call on a pooled connection. |
| Fail closed | A missing, malformed or unknown staff id makes every policy match nothing, and `pipeline_summary()` raises `42501`. The server won't start if `ADMISSIONS_STAFF_ID` matches no staff member. |
| Sensitive fields on request only | Date of birth, learning support and medical notes live in one table, `applicant_private`. They're returned only to the campus head of that campus, and only with `include_sensitive: true`. RLS refuses the rows to everyone else even if the server's check were wrong. |
| Same "not found" for other campuses | A missing id and another campus's id both return "Inquiry not found or not accessible.", so probing ids reveals nothing. |
| Audit log | Every tool call writes one `audit_log` row (`ok`, `denied` or `error`) in the same transaction. If the row can't be written, the call returns an error and no data. The table is append-only, even for admin roles. `log_followup` records `inquiry_id` and `channel` but never the note text. |
| Human approval for writes | The committed [`.claude/settings.json`](.claude/settings.json) has an `ask` rule for `log_followup`. Claude Code checks ask rules before allow rules, so every write needs a person to approve it. |

## Architecture

```mermaid
flowchart LR
  staff([Staff member]) --> cc[Claude Code]
  cc <-->|"MCP over stdio"| server

  subgraph server["Admissions Desk MCP server (Node)"]
    tools["Tools: check role and campus"]
    policy["Policy resource: reads content/policy/*.md"]
    subgraph call["One transaction per tool call"]
      direction TB
      id["set_config app.staff_id (local)"] --> work["Tool queries (savepoint)"]
      work --> audit["Insert audit_log row"]
      audit --> commit["Commit, then release the result"]
    end
    tools --> call
  end

  call -->|"postgres.js as admissions_app"| db

  subgraph db["Postgres (local Supabase)"]
    rls["RLS on every table via current_staff()"]
    view["inquiry_activity view (security_invoker)"]
    fn["pipeline_summary() SECURITY DEFINER, counts only"]
    log["audit_log, append-only"]
  end
```

## What broke and what I learned

| What happened | Fix |
|---|---|
| postgres.js sends database notices to `console.log` by default. On a stdio MCP server, stdout is the protocol stream, so a notice would corrupt it. | Notices go to `console.error`. ESLint now allows only `console.error` in `src/`. |
| postgres.js returns `timestamptz` columns as JavaScript `Date` objects, but the tool output schemas declare strings. | Timestamps are converted with `toISOString()` when rows are mapped. Date of birth is cast to `text` in SQL, so no timezone conversion can shift the day. |
| `z.uuid()` rejected the seed ids, like `00000000-0000-0000-0000-000000000001`. They're valid Postgres `uuid` values but not RFC version/variant compliant. | Zod's `z.guid()`, which checks the format only. |
| The model misread the stale-inquiry cutoff. The view counted calendar-date boundaries, and the tool filtered with a different comparison than its description promised, so "more than 5 days" and the numbers shown could disagree. | One definition: `inquiry_activity.days_since_contact`, whole elapsed days rounded down. The filter and the output read that column, and the description says the bound is inclusive ("for more than 5 days, pass 6"). A test pins 5 in, 4 out. |
| Views run with their owner's rights by default, and the owner bypasses RLS, so `inquiry_activity` would have returned every campus. | `security_invoker = true`. `CREATE OR REPLACE VIEW` drops this option, so the migration comments warn that any redefinition must restate it. |
| Supabase grants `anon` and `authenticated` access to everything created in `public`, including tables created later. | The access is revoked on existing objects, and `ALTER DEFAULT PRIVILEGES` removes it for future ones. Tests check that both roles read nothing. |

## Testing

85 tests in 9 files (Vitest), run against the local Supabase database. Tools and RLS are exercised as `admissions_app`, the role the server uses. The admin connection only sets up fixtures and reads expected values.

| Suite | Covers |
|---|---|
| `row-level-security` | RLS on its own, without any tool: campus scoping, leadership sees no rows, unset/unknown/malformed identity sees nothing, no UPDATE/DELETE anywhere, followup inserts only as yourself on your own campus, `anon`/`authenticated` locked out |
| `get-inquiry-sensitive` | Sensitive fields per role and request, and the not-found answer for another campus |
| `audit-log` | One row per call for `ok`, `denied` and `error`, and failing closed |
| `pipeline-summary` | Counts per role, denials audited, the database function failing closed, `EXECUTE` revoked, and stale counts agreeing with `find_stale_inquiries` on every campus at 1, 5 and 6 days |
| `log-followup` | Insert and staleness reset, note kept out of the audit log, refusals (other campus, missing id, leadership, empty or over-long note) |
| `find-stale-inquiries` | The inclusive cutoff |
| `admissions-policy`, `weekly-leadership-brief` | Resource and prompt contents, readable by every role, no audit rows, no seed data in the prompt |
| `mcp-end-to-end` | A real MCP client over the SDK's in-memory transport: tool list, annotations, a `get_inquiry` round trip |

Some tests break something on purpose to prove the next layer holds:

- Revoke the audit insert grant: the tool returns an error and no data.
- Force a query to fail (`select 1 / 0`): the error is still audited.
- Call the sensitive-field query with the role check skipped: RLS returns no row to a counsellor.
- Call `pipeline_summary()` directly, bypassing the tool: it refuses another campus on its own.

`pnpm verify` runs typecheck, lint (type-aware typescript-eslint), build and tests, and stops at the first failure. [CI](.github/workflows/ci.yml) runs the same command on every push and pull request. It starts only the Supabase database container, resets it, and uses the same local-only settings with no secrets.

## How this was built

This is AI-assisted development. I planned each step with Claude, then Claude Code implemented it under my own CLAUDE.md engineering standards. I reviewed each step's report and tested the server live in Claude Code before committing.

## Setup

**Prerequisites:** Node.js LTS, pnpm 11, and Docker Desktop (running). The Supabase CLI is a dev dependency, so it needs no separate install.

```bash
git clone https://github.com/jegramin/admissions-desk.git
cd admissions-desk
pnpm install
pnpm exec supabase start   # local Postgres, migrations and seed data
pnpm build                 # Claude Code runs dist/index.js
claude                     # approve the project's admissions-desk MCP server when asked
```

In Claude Code, `/mcp` should show `admissions-desk` as connected. No `.env` file is needed: [`.mcp.json`](.mcp.json) defaults to the local database and to Lana Hussein, the Erbil counsellor. `pnpm db:reset` restores the seed data at any time.

**Switching staff.** Set `ADMISSIONS_STAFF_ID` in the shell, then start Claude Code from that shell. `/mcp` reconnect in an open session keeps the old identity.

```powershell
# PowerShell
$env:ADMISSIONS_STAFF_ID = '00000000-0000-0000-0000-000000000002'   # Darin Saleh, Erbil campus head
claude
```

```bash
# Git Bash
ADMISSIONS_STAFF_ID=00000000-0000-0000-0000-000000000002 claude
```

The ids for all eight seed staff are in [docs/access-model.md](docs/access-model.md#seed-staff-and-switching-the-acting-staff-member).

**Why ports 553xx.** Windows can reserve a dynamic port range that covers Supabase's default 543xx ports (check with `netsh interface ipv4 show excludedportrange protocol=tcp`). That blocks them before Docker is involved, so [supabase/config.toml](supabase/config.toml) shifts every port to 553xx.

| Script | Does |
|---|---|
| `pnpm build` | Compile `src/` to `dist/` |
| `pnpm typecheck` | Type-check `src/` and `test/` |
| `pnpm lint` | ESLint with type-aware rules |
| `pnpm test` | Vitest against the local database |
| `pnpm verify` | All four, in order, stopping at the first failure |
| `pnpm db:reset` | Re-run migrations and the seed |
| `pnpm gen:types` | Regenerate `src/db/types.ts` from the schema |

## Decisions

| Decision | Why |
|---|---|
| postgres.js, not supabase-js | RLS needs the staff identity set inside the same transaction as the queries, with `set_config(…, true)`. supabase-js goes through the HTTP Data API and can't hold a transaction open. A direct connection can. |
| Staff identity from an env var | Enough for one person running the server locally, and it keeps the access model testable. Real login is a production item (below). |
| Calendar-day lower bound for the 3-working-day standard | `pipeline_summary` counts calendar days. Three working days span at most five calendar days on every campus's week, so the brief treats 6+ days as a breach. It ignores public holidays and can flag a breach a day or two late, and the prompt tells the model to say so. |
| TypeScript 6, not 7 | typescript-eslint's type-aware rules need the TypeScript compiler API, which TypeScript 7 doesn't ship. Typecheck, build and lint all use 6.0.3, so they can't disagree about types. |

## Known limits

- **Identity comes from an env var, not a login.** Whoever starts the server chooses who it acts as.
- **Tests share the dev database.** Each run truncates and reseeds it.
- **Schema-rejected calls aren't audited.** The MCP SDK rejects a call with invalid arguments (for example a malformed id) before the handler runs. Such calls return no data.
- **Note content relies on model guidance.** `log_followup` tells the model to keep sensitive details out of notes, but the server doesn't inspect the text.
- **Working-day counts are approximate.** They're calendar-day bounds with no public holidays.
- **There's a local-only password in a migration.** `admissions_app_local_only` is for the local stack. Any shared environment must set its own.
- **All data is fictional.** That includes the school, staff, families, policies and fees.

## For production I would

- Serve over Streamable HTTP with OAuth through the school's SSO, so identity comes from a login rather than an env var.
- Run tests against a separate database, not the dev one.
- Manage the database credentials with a proper secrets manager, with no password in migrations.
- Give each campus its own working-day calendar, with public holidays, so reply-standard breaches are exact.
- Set an audit retention policy: how long rows are kept, and who can read them.

## Licence

[MIT](LICENSE)
