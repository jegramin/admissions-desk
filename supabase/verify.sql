-- Admissions Desk — schema verification queries
--
-- Ad hoc checks for "does the schema + seed data actually behave as
-- designed", run by hand after `supabase db reset`. Not application code
-- and not run automatically by any script.

-- 1. Inquiry count per campus and stage.
-- Expect 20 inquiries per campus, all 9 stages represented in each.
select campus_id, stage, count(*) as n
from inquiries
group by campus_id, stage
order by campus_id, stage;

-- 2. Active Erbil inquiries with no contact for at least 5 whole days.
-- Same inclusive definition as find_stale_inquiries' default
-- (min_days_without_contact = 5): days_since_contact >= 5.
-- "Active" excludes the terminal stages (enrolled/withdrawn/lost), since a
-- withdrawn/lost inquiry going quiet isn't staleness worth flagging.
-- Expect exactly the 6 inquiries guaranteed stale by the seed data
-- (days_since_contact 6 through 11).
select ia.inquiry_id, ia.stage, ia.days_since_contact
from inquiry_activity ia
where ia.campus_id = 'erbil'
  and ia.stage not in ('enrolled', 'withdrawn', 'lost')
  and ia.days_since_contact >= 5
order by ia.days_since_contact desc;

-- 3. Every followup history matches its stage.
-- Expect min_followups >= the stage's minimum (new 0, contacted 1,
-- tour_booked 2, applied 3, assessment 4, offered 5, enrolled 6), max 0 for
-- 'new', and meets_minimum true on every row.
select
  i.stage,
  count(*) as inquiries,
  min(fc.n) as min_followups,
  max(fc.n) as max_followups,
  min(fc.n) >= case i.stage
    when 'new' then 0 when 'contacted' then 1 when 'tour_booked' then 2
    when 'applied' then 3 when 'assessment' then 4 when 'offered' then 5
    when 'enrolled' then 6 else 2
  end as meets_minimum
from inquiries i
cross join lateral (
  select count(*)::integer as n from followups f where f.inquiry_id = i.id
) fc
group by i.stage
order by i.stage;

-- 4. No followup predates its inquiry. Expect 0.
select count(*) as followups_before_inquiry_created
from followups f
join inquiries i on i.id = f.inquiry_id
where f.created_at <= i.created_at;

-- 5. Proof that audit_log is append-only.
-- The insert succeeds; the update and delete must each fail with
-- "audit_log is append-only: <OP> is not permitted".
insert into audit_log (staff_id, tool_name, arguments, allowed, result_count)
values ('00000000-0000-0000-0000-000000000001', 'list_inquiries', '{"campus":"erbil"}', true, 6)
returning id;

update audit_log set allowed = false where tool_name = 'list_inquiries';

delete from audit_log where tool_name = 'list_inquiries';
