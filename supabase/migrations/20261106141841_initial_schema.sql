-- Admissions Desk — initial schema
--
-- Access model this schema is designed to enforce (enforced in a later step,
-- at the data-access layer — not here, since there is no auth yet):
--   counsellor    -> own campus only,  no sensitive child fields
--   campus_head   -> own campus only,  including sensitive child fields
--   leadership    -> all campuses,     aggregates only, never individual child records
--
-- The key structural decision supporting that: every sensitive child field
-- (DOB, learning support, medical) lives in applicant_private, a single
-- table that can be included or excluded from a query wholesale, instead of
-- being scattered across applicants where it would need per-column checks.

create extension if not exists pgcrypto;

-- Enums -----------------------------------------------------------------

create type staff_role as enum ('counsellor', 'campus_head', 'leadership');

create type inquiry_source as enum (
  'website',
  'referral',
  'walk_in',
  'agent',
  'event',
  'phone',
  'social_media'
);

create type inquiry_stage as enum (
  'new',
  'contacted',
  'tour_booked',
  'applied',
  'assessment',
  'offered',
  'enrolled',
  'withdrawn',
  'lost'
);

create type followup_channel as enum ('email', 'phone', 'whatsapp', 'meeting');

-- Campuses ----------------------------------------------------------------
-- id is plain text, not an enum: new campuses are a data change (INSERT),
-- not a schema migration. The three current campuses are seeded, not baked
-- into a type.

create table campuses (
  id text primary key,
  name text not null,
  city text not null,
  country text not null,
  timezone text not null
);

-- Staff ---------------------------------------------------------------------

create table staff (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null unique,
  role staff_role not null,
  campus_id text references campuses (id),
  constraint staff_campus_matches_role check (
    (role in ('counsellor', 'campus_head') and campus_id is not null)
    or (role = 'leadership' and campus_id is null)
  )
);

create index idx_staff_campus_id on staff (campus_id);

-- Guardians & applicants ----------------------------------------------------

create table guardians (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null,
  preferred_language text not null
);

create table applicants (
  id uuid primary key default gen_random_uuid(),
  guardian_id uuid not null references guardians (id),
  first_name text not null,
  last_name text not null,
  entry_grade text not null,
  entry_year integer not null,
  current_school text
);

create index idx_applicants_guardian_id on applicants (guardian_id);

-- Sensitive child data, isolated in its own table on purpose (see header
-- comment): restricting access to counsellors is "don't join this table in",
-- not "filter these columns out of every query that touches applicants".
create table applicant_private (
  applicant_id uuid primary key references applicants (id) on delete cascade,
  date_of_birth date not null,
  learning_support_notes text,
  medical_notes text
);

comment on table applicant_private is
  'Sensitive child fields. counsellor role must never be granted access to this table.';

-- Inquiries & followups -----------------------------------------------------

create table inquiries (
  id uuid primary key default gen_random_uuid(),
  campus_id text not null references campuses (id),
  applicant_id uuid not null references applicants (id),
  guardian_id uuid not null references guardians (id),
  assigned_staff_id uuid references staff (id) on delete set null,
  source inquiry_source not null,
  stage inquiry_stage not null default 'new',
  created_at timestamptz not null default now()
);

create index idx_inquiries_campus_stage on inquiries (campus_id, stage);
create index idx_inquiries_applicant_id on inquiries (applicant_id);
create index idx_inquiries_guardian_id on inquiries (guardian_id);
create index idx_inquiries_assigned_staff_id on inquiries (assigned_staff_id);

create table followups (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references inquiries (id) on delete cascade,
  staff_id uuid not null references staff (id),
  channel followup_channel not null,
  note text not null,
  created_at timestamptz not null default now()
);

create index idx_followups_inquiry_created on followups (inquiry_id, created_at desc);

-- Derived "last contact" / staleness, instead of a stored last_contact_at
-- column: a stored column would need every followup-insert path to
-- remember to update it. Deriving it means logging a followup can't ever
-- leave staleness out of date.
create view inquiry_activity as
select
  i.id as inquiry_id,
  i.campus_id,
  i.stage,
  i.assigned_staff_id,
  lf.last_contact_at,
  case
    when lf.last_contact_at is null then null
    else (now()::date - lf.last_contact_at::date)
  end as days_since_contact
from inquiries i
left join lateral (
  select max(f.created_at) as last_contact_at
  from followups f
  where f.inquiry_id = i.id
) lf on true;

comment on view inquiry_activity is
  'Per-inquiry last_contact_at and days_since_contact, derived from followups so staleness updates automatically when a followup is logged.';

-- Audit log -------------------------------------------------------------
-- append-only: every tool call gets logged, including denied ones, and
-- nothing is ever allowed to edit or remove that record afterwards.

create table audit_log (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references staff (id),
  tool_name text not null,
  arguments jsonb not null default '{}'::jsonb,
  allowed boolean not null,
  result_count integer,
  created_at timestamptz not null default now()
);

create index idx_audit_log_staff_created on audit_log (staff_id, created_at desc);

create function reject_audit_log_mutation() returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only: % is not permitted', tg_op;
end;
$$;

create trigger audit_log_no_update
  before update on audit_log
  for each row execute function reject_audit_log_mutation();

create trigger audit_log_no_delete
  before delete on audit_log
  for each row execute function reject_audit_log_mutation();
