-- Grievances (citizen questions answered by officers) and automatic benefits.
--
-- Run this once in the Supabase SQL editor, after 0001_init.sql, then run the pipeline
-- (`npm run pipeline`) so enrollments are rebuilt with the new column.

-- ---------------------------------------------------------------------------
-- grievances: an input table, never truncated by the pipeline.
-- A citizen asks why a scheme is not reaching them; an officer answers.
-- ---------------------------------------------------------------------------

create table if not exists grievances (
  id                    bigserial primary key,
  family_id             text not null,
  person_id             text,                        -- null for family-scope schemes
  scheme_code           text not null,
  message               text not null,
  -- what the system said when the grievance was filed (status and eligibility reasons)
  eligibility_snapshot  jsonb,
  status                text not null default 'pending' check (status in ('pending', 'resolved')),
  officer_response      text,
  answered_by           text,
  created_at            timestamptz not null default now(),
  resolved_at           timestamptz
);

-- Databases that applied an earlier draft of this file get the new columns too.
alter table grievances add column if not exists eligibility_snapshot jsonb;
alter table grievances add column if not exists answered_by text;

create index if not exists grievances_family_idx on grievances (family_id);
create index if not exists grievances_status_idx on grievances (status);

alter table grievances enable row level security;

-- ---------------------------------------------------------------------------
-- enrollments: benefits that start automatically have no source record.
-- basis 'record' = backed by a source record; 'auto' = granted because the rules pass
-- for a scheme that needs no manual verification.
-- ---------------------------------------------------------------------------

alter table enrollments add column if not exists basis text not null default 'record'
  check (basis in ('record', 'auto'));
alter table enrollments alter column source_record_id drop not null;
