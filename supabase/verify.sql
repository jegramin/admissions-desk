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

-- 2. Active Erbil inquiries with days_since_contact > 5.
-- "Active" excludes the terminal stages (enrolled/withdrawn/lost), since a
-- withdrawn/lost inquiry going quiet isn't staleness worth flagging.
-- Expect exactly the 6 inquiries guaranteed stale by the seed data.
select ia.inquiry_id, ia.stage, ia.days_since_contact
from inquiry_activity ia
where ia.campus_id = 'erbil'
  and ia.stage not in ('enrolled', 'withdrawn', 'lost')
  and ia.days_since_contact > 5
order by ia.days_since_contact desc;

-- 3. Proof that audit_log is append-only.
-- The insert succeeds; the update and delete must each fail with
-- "audit_log is append-only: <OP> is not permitted".
insert into audit_log (staff_id, tool_name, arguments, allowed, result_count)
values ('00000000-0000-0000-0000-000000000001', 'list_inquiries', '{"campus":"erbil"}', true, 6)
returning id;

update audit_log set allowed = false where tool_name = 'list_inquiries';

delete from audit_log where tool_name = 'list_inquiries';
