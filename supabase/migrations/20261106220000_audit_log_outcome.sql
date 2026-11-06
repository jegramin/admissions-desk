-- Audit log: three-way outcome and a sensitive-data flag.
--
-- `allowed boolean` couldn't tell a refused call from one that failed
-- halfway, and nothing recorded whether DOB / learning-support / medical
-- fields left the database. audit_log is empty at this point (nothing has
-- written to it yet), so the column swap loses no history.
--
-- Every MCP tool call writes exactly one row, from the server's per-call
-- helper (src/db/tool-call.ts), in the same transaction as the call's reads.
-- If that insert fails, the tool returns an error and no data.

create type audit_outcome as enum ('ok', 'denied', 'error');

alter table audit_log
  drop column allowed,
  add column outcome audit_outcome not null,
  add column sensitive_returned boolean not null default false,
  -- Illegal states, ruled out: sensitive fields only leave on a successful
  -- call, and only a successful call has a result count.
  add constraint audit_log_sensitive_only_when_ok check (not sensitive_returned or outcome = 'ok'),
  add constraint audit_log_result_count_only_when_ok check ((outcome = 'ok') = (result_count is not null));

comment on column audit_log.outcome is
  'ok: the call returned data (possibly zero rows). denied: refused by an access rule, including get_inquiry ids that are not found or belong to another campus (the two are indistinguishable by design). error: the call failed and returned no data.';

comment on column audit_log.sensitive_returned is
  'True when the response included applicant_private fields (date of birth, learning support or medical notes).';
