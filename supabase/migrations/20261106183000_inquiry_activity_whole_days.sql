-- Single definition of "days since contact".
--
-- Previously the view counted calendar-date boundaries (now()::date -
-- last_contact_at::date), returned null for never-contacted inquiries, and
-- left the caller to fill that gap from created_at. Each caller could then
-- disagree with the number it reported; find_stale_inquiries did, by
-- filtering with a different comparison than its description promised.
--
-- Now: whole elapsed days, rounded down, since the latest followup — or
-- since the inquiry was created if there has never been one. Computed from
-- the timestamp difference, not from dates, so the value does not depend on
-- the session timezone. Every consumer reads this column instead of
-- recomputing it.
--
-- create or replace keeps existing columns in place (same name, same
-- integer type) and appends never_contacted, so grants and dependents stay
-- intact.

create or replace view inquiry_activity as
select
  i.id as inquiry_id,
  i.campus_id,
  i.stage,
  i.assigned_staff_id,
  lf.last_contact_at,
  floor(
    extract(epoch from (now() - coalesce(lf.last_contact_at, i.created_at))) / 86400
  )::integer as days_since_contact,
  (lf.last_contact_at is null) as never_contacted
from inquiries i
left join lateral (
  select max(f.created_at) as last_contact_at
  from followups f
  where f.inquiry_id = i.id
) lf on true;

comment on view inquiry_activity is
  'Per-inquiry last_contact_at and days_since_contact (whole days, rounded down, since the latest followup, or since created_at if never contacted). Derived from followups so staleness updates automatically when a followup is logged.';

comment on column inquiry_activity.days_since_contact is
  'Whole days (rounded down) since the latest followup, or since created_at when never_contacted. The one definition of staleness; do not recompute it elsewhere.';
