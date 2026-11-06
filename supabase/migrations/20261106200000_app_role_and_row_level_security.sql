-- Restricted application role + row level security.
--
-- Until now the MCP server connected as postgres (BYPASSRLS, owner of every
-- table), so the TypeScript campus/role checks were the only thing between
-- the model and every campus's data. This migration adds a second,
-- independent layer: the server connects as admissions_app, which can only
-- read what RLS lets the current staff member see and can write nothing but
-- followups and audit entries. A bug in a tool's SQL now returns fewer rows,
-- not another campus's rows.
--
-- Identity: the server opens a transaction per tool call and runs
-- set_config('app.staff_id', <id>, true) first. "true" makes the setting
-- transaction-local, so it cannot leak into the next call on a pooled
-- connection. current_staff() is the single place that turns that setting
-- into a staff member; every policy goes through it. A missing, malformed or
-- unknown app.staff_id yields no staff row, so every policy matches nothing.

-- Role ------------------------------------------------------------------------
-- Roles are cluster-wide and survive `supabase db reset`, hence the guard.
-- The password is for the local Supabase stack only; any shared or production
-- environment must set its own out of band (alter role ... password).

-- CREATE ROLE defaults to nosuperuser, nobypassrls, nocreatedb, nocreaterole
-- and noreplication. Those can't be restated explicitly here (Supabase's
-- postgres is not a superuser), so the check below asserts them instead.

do $$
begin
  if not exists (select from pg_roles where rolname = 'admissions_app') then
    create role admissions_app;
  end if;
end;
$$;

alter role admissions_app with login noinherit password 'admissions_app_local_only';

do $$
begin
  if exists (
    select from pg_roles
    where rolname = 'admissions_app'
      and (rolsuper or rolbypassrls or rolcreaterole or rolcreatedb or rolreplication)
  ) then
    raise exception 'admissions_app must not be superuser or have BYPASSRLS, CREATEROLE, CREATEDB or REPLICATION';
  end if;
end;
$$;

-- Supabase API roles ------------------------------------------------------------
-- Supabase grants anon/authenticated full access to everything postgres
-- creates in public. This project does not use the Supabase Data API, so
-- remove those grants from existing objects and from objects created later.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated;

-- Current staff member -------------------------------------------------------------
-- SECURITY DEFINER so policies don't depend on admissions_app's own grants
-- on staff; fixed search_path so a caller can't shadow public.staff.
-- Compares as text rather than casting the setting to uuid: a malformed
-- value then matches nobody (fail closed) instead of raising mid-query.

create function current_staff()
returns table (id uuid, role staff_role, campus_id text)
language sql
stable
security definer
set search_path = pg_catalog, public
rows 1
as $$
  select s.id, s.role, s.campus_id
  from public.staff s
  where s.id::text = current_setting('app.staff_id', true)
$$;

comment on function current_staff() is
  'The staff member named by the transaction-local app.staff_id setting: one row, or none when it is missing or unknown. The only source of identity for RLS policies.';

revoke all on function current_staff() from public, anon, authenticated;
grant execute on function current_staff() to admissions_app;

-- Grants --------------------------------------------------------------------------
-- SELECT on what the tools read, INSERT on the two append-only tables.
-- No UPDATE or DELETE anywhere. applicant_private is granted because a
-- campus_head may read it; RLS decides who actually gets rows.

grant usage on schema public to admissions_app;

grant select on
  campuses,
  staff,
  guardians,
  applicants,
  applicant_private,
  inquiries,
  followups,
  inquiry_activity
to admissions_app;

grant insert on followups, audit_log to admissions_app;

-- Row level security ----------------------------------------------------------------
-- campuses and staff stay without RLS: readable by the app, and not writable
-- because nothing above grants a write.

alter table inquiries enable row level security;
alter table applicants enable row level security;
alter table guardians enable row level security;
alter table applicant_private enable row level security;
alter table followups enable row level security;
alter table audit_log enable row level security;

-- The campus rule lives here once. Leadership has campus_id null and is
-- excluded by role anyway, so it never sees an individual inquiry.
-- The scalar subquery runs once per statement, not once per row.
create policy inquiries_own_campus on inquiries
  for select to admissions_app
  using (
    campus_id = (
      select cs.campus_id from current_staff() cs
      where cs.role in ('counsellor', 'campus_head')
    )
  );

-- The policies below reach their campus "via their inquiry". The subquery on
-- inquiries is itself filtered by inquiries_own_campus, so they inherit the
-- campus rule instead of restating it.
create policy applicants_via_inquiry on applicants
  for select to admissions_app
  using (exists (select 1 from inquiries i where i.applicant_id = applicants.id));

create policy guardians_via_inquiry on guardians
  for select to admissions_app
  using (exists (select 1 from inquiries i where i.guardian_id = guardians.id));

create policy followups_via_inquiry on followups
  for select to admissions_app
  using (exists (select 1 from inquiries i where i.id = followups.inquiry_id));

create policy followups_insert_as_self on followups
  for insert to admissions_app
  with check (
    staff_id = (select cs.id from current_staff() cs)
    and exists (select 1 from inquiries i where i.id = followups.inquiry_id)
  );

-- Sensitive child fields: campus_head of the applicant's campus only. The
-- explicit role check matters: a counsellor passes inquiries_own_campus.
create policy applicant_private_campus_head on applicant_private
  for select to admissions_app
  using (
    exists (
      select 1 from inquiries i
      where i.applicant_id = applicant_private.applicant_id
        and i.campus_id = (
          select cs.campus_id from current_staff() cs
          where cs.role = 'campus_head'
        )
    )
  );

-- Append as yourself; no SELECT policy (and no SELECT grant), so the app
-- cannot read the audit trail back.
create policy audit_log_insert_as_self on audit_log
  for insert to admissions_app
  with check (staff_id = (select cs.id from current_staff() cs));

-- Views ------------------------------------------------------------------------------
-- A view runs with its owner's rights by default, and the owner (postgres)
-- bypasses RLS, so without this inquiry_activity would return every campus.
-- CREATE OR REPLACE VIEW resets this option: any future redefinition must
-- repeat `with (security_invoker = true)`.

alter view inquiry_activity set (security_invoker = true);
