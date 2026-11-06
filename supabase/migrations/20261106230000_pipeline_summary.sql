-- pipeline_summary: aggregate counts for any role, including leadership.
--
-- Leadership has no row access under RLS (inquiries_own_campus matches only
-- counsellors and campus heads), so the app cannot count across campuses as
-- itself. This function runs as its owner, which bypasses RLS, and is
-- therefore the single place leadership's "patterns, not people" rule is
-- enforced: it checks the caller itself and returns counts only, never an
-- id, name or any other column of an individual record.
--
-- Access, decided from current_staff() and nothing the caller passes in:
--   leadership               -> p_campus_id, or every campus when it is null
--   counsellor / campus_head -> own campus; any other campus raises 42501
--   no identity              -> raises 42501 (fail closed)
--
-- Staleness reads inquiry_activity.days_since_contact, the one definition
-- used by find_stale_inquiries: active stage and days_since_contact >= N.
-- The terminal stages below mirror TERMINAL_STAGES in src/db/enums.ts.

create function pipeline_summary(p_campus_id text, p_min_days_without_contact integer)
returns table (stage inquiry_stage, inquiry_count integer, stale_count integer)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
#variable_conflict use_column
declare
  caller record;
  scope_campus_id text;
begin
  select cs.id, cs.role, cs.campus_id into caller from public.current_staff() cs;
  if not found then
    raise exception 'pipeline_summary: no current staff member'
      using errcode = 'insufficient_privilege';
  end if;

  if p_min_days_without_contact is null or p_min_days_without_contact < 1 then
    raise exception 'pipeline_summary: p_min_days_without_contact must be a positive integer'
      using errcode = 'invalid_parameter_value';
  end if;

  if caller.role = 'leadership' then
    -- null means every campus, and only leadership can ask for that.
    scope_campus_id := p_campus_id;
  elsif caller.campus_id is null then
    -- Ruled out by staff_campus_matches_role; checked so a null campus can
    -- never widen the scope to every campus.
    raise exception 'pipeline_summary: % has no campus', caller.role
      using errcode = 'insufficient_privilege';
  elsif p_campus_id is null or p_campus_id = caller.campus_id then
    scope_campus_id := caller.campus_id;
  else
    raise exception 'pipeline_summary: % may only summarise their own campus', caller.role
      using errcode = 'insufficient_privilege';
  end if;

  -- Every stage, zero-filled, so the shape of the answer never depends on
  -- which stages happen to have inquiries.
  return query
  select
    s.stage,
    count(ia.inquiry_id)::integer,
    (count(ia.inquiry_id) filter (
      where s.stage not in ('enrolled', 'withdrawn', 'lost')
        and ia.days_since_contact >= p_min_days_without_contact
    ))::integer
  from unnest(enum_range(null::public.inquiry_stage)) as s (stage)
  left join public.inquiry_activity ia
    on ia.stage = s.stage
   and (scope_campus_id is null or ia.campus_id = scope_campus_id)
  group by s.stage
  order by s.stage;
end;
$$;

comment on function pipeline_summary(text, integer) is
  'Inquiry counts per stage, and stale counts (active stage, days_since_contact >= N), for the caller''s permitted scope. Counts only. Raises 42501 with no identity or for a campus the caller may not see.';

-- Functions are executable by PUBLIC by default.
revoke all on function pipeline_summary(text, integer) from public, anon, authenticated;
grant execute on function pipeline_summary(text, integer) to admissions_app;
