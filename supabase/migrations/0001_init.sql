-- Parivar Setu: initial schema (DESIGN.md Section 6)
--
-- Inputs (never truncated by the pipeline):
--   source_records, review_decisions, family_events, audit_log
-- Derived (truncated and rebuilt on every pipeline run):
--   persons, match_candidates, families, family_members, enrollments,
--   eligibility_results, anomaly_flags; pipeline_runs is appended to.
--
-- Derived tables deliberately have no foreign keys between them: the pipeline
-- truncates and reinserts them in batches, and they can be wiped and rebuilt at
-- any time. Human decisions reference source_records ids, never derived ids.

-- ---------------------------------------------------------------------------
-- Inputs
-- ---------------------------------------------------------------------------

create table source_records (
  id                text primary key,            -- e.g. 'RAT-000123', 'PEN-000045'
  source            text not null check (source in ('ration', 'pension', 'scholarship', 'death_registry')),
  source_ref        text not null,               -- department's own ID
  household_ref     text,                        -- ration card number, ration source only
  full_name         text not null,
  guardian_name     text,                        -- father's name, scholarship source only
  dob               text,                        -- raw string, formats vary on purpose
  gender            text check (gender in ('M', 'F')),
  relation_to_head  text check (relation_to_head in (
                      'head', 'spouse', 'son', 'daughter', 'son_in_law',
                      'daughter_in_law', 'grandson', 'granddaughter',
                      'father', 'mother', 'other')),
  marital_status    text check (marital_status in ('married', 'unmarried', 'widowed')),
  uid_hash          text,
  uid_last4         text,
  district          text not null,
  taluka            text not null,
  village           text not null,
  address           text not null,
  income_declared   integer,                     -- annual, rupees
  scheme_code       text check (scheme_code in ('OLD_AGE_PENSION', 'WIDOW_ASSIST', 'SCHOLARSHIP')),
  benefit_amount    integer,                     -- monthly, rupees
  is_student        boolean,
  date_of_death     text,                        -- death_registry only
  true_person_id    text not null                -- ground truth for evaluation only, never used by the engine
);

create index source_records_source_idx        on source_records (source);
create index source_records_household_ref_idx on source_records (household_ref);
create index source_records_uid_hash_idx      on source_records (uid_hash);
create index source_records_true_person_idx   on source_records (true_person_id);

create table review_decisions (
  pair_key    text primary key,                  -- '<smaller record id>|<larger record id>'
  decision    text not null check (decision in ('approved', 'rejected')),
  decided_by  text not null,
  reason      text,
  decided_at  timestamptz not null default now()
);

create table family_events (
  id                 bigserial primary key,
  type               text not null check (type in ('death', 'marital_status_change')),
  subject_record_id  text not null,              -- anchor source record of the person
  payload            jsonb not null,             -- {"date_of_death": "..."} or {"marital_status": "widowed"}
  source             text not null check (source in ('officer', 'death_registry')),
  recorded_by        text not null,
  created_at         timestamptz not null default now()
);

create index family_events_subject_idx on family_events (subject_record_id);

create table audit_log (
  id           bigserial primary key,
  actor        text not null,                    -- 'system' or 'officer:<name>'
  action       text not null,                    -- pipeline_run | review_decision | life_event | ...
  entity_type  text not null,
  entity_id    text not null,
  before       jsonb,
  after        jsonb,
  reason       text,
  created_at   timestamptz not null default now()
);

-- Append-only: reject UPDATE and DELETE on rows, and TRUNCATE on the table.
create or replace function forbid_audit_change() returns trigger as $$
begin
  raise exception 'audit_log is append-only';
end;
$$ language plpgsql;

create trigger audit_log_no_update before update or delete on audit_log
for each row execute function forbid_audit_change();

create trigger audit_log_no_truncate before truncate on audit_log
for each statement execute function forbid_audit_change();

-- ---------------------------------------------------------------------------
-- Derived
-- ---------------------------------------------------------------------------

create table persons (
  id                text primary key,            -- 'P-000001', deterministic
  anchor_record_id  text not null,               -- smallest source record id in the cluster
  canonical_name    text not null,
  dob               text,
  gender            text check (gender in ('M', 'F')),
  uid_last4         text,
  marital_status    text check (marital_status in ('married', 'unmarried', 'widowed')),
  is_deceased       boolean not null default false,
  deceased_on       text
);

create table match_candidates (
  pair_key         text primary key,
  record_a_id      text not null,
  record_b_id      text not null,
  score            numeric not null,
  score_breakdown  jsonb not null,               -- {"name":0.92,"dob":1,"address":0.8,"uid":null,"rules":["..."]}
  decision         text not null check (decision in ('auto_merge', 'review', 'distinct')),
  review_status    text check (review_status in ('pending', 'approved', 'rejected'))
);

create table families (
  id                text primary key,            -- 'GJ-FID-000001', deterministic
  head_person_id    text,
  district          text not null,
  taluka            text not null,
  village           text not null,
  resolved_income   integer,                     -- highest declared value (conservative)
  income_sources    jsonb not null default '[]',  -- every declared value with its source record
  is_anchored       boolean not null,            -- false when not built from a ration card
  status            text not null default 'active' check (status in ('active', 'merged')),
  merged_into       text,
  parent_family_id  text
);

create table family_members (
  id                bigserial primary key,
  family_id         text not null,
  person_id         text not null,
  relation_to_head  text,
  valid_from        text,
  valid_to          text
);

-- A person has at most one current family; closed rows keep membership history.
create unique index family_members_one_current_family
  on family_members (person_id) where valid_to is null;
create index family_members_family_idx on family_members (family_id);

create table enrollments (
  id                bigserial primary key,
  person_id         text not null,
  family_id         text not null,
  scheme_code       text not null,
  source_record_id  text not null,
  monthly_amount    integer
);

create index enrollments_person_idx on enrollments (person_id);
create index enrollments_family_idx on enrollments (family_id);

create table eligibility_results (
  id             bigserial primary key,
  family_id      text not null,
  person_id      text,                           -- null for family-scope schemes
  scheme_code    text not null,
  eligible       boolean not null,
  reasons        jsonb not null,                 -- [{"rule":"age gte 60","actual":67,"passed":true}]
  rules_version  text not null,
  evaluated_at   timestamptz not null default now()
);

create index eligibility_results_family_idx on eligibility_results (family_id);

create table anomaly_flags (
  id                   text primary key,
  type                 text not null check (type in (
                         'deceased_beneficiary', 'duplicate_enrollment', 'multi_household',
                         'income_mismatch', 'unanchored_beneficiary')),
  severity             text not null check (severity in ('high', 'medium', 'low')),
  family_id            text,
  person_id            text,
  evidence             jsonb not null,           -- source record ids and the values that triggered it
  est_monthly_leakage  integer,
  status               text not null default 'open'
);

create index anomaly_flags_type_idx   on anomaly_flags (type);
create index anomaly_flags_family_idx on anomaly_flags (family_id);

create table pipeline_runs (
  id             bigserial primary key,
  started_at     timestamptz not null,
  finished_at    timestamptz,
  rules_version  text,
  stats          jsonb                           -- counts, leakage estimate, precision, recall, f1
);

-- ---------------------------------------------------------------------------
-- Row Level Security: enabled on every table with no policies, so the anon key
-- can read nothing. The server uses the service role key, which bypasses RLS.
-- ---------------------------------------------------------------------------

alter table source_records      enable row level security;
alter table review_decisions    enable row level security;
alter table family_events       enable row level security;
alter table audit_log           enable row level security;
alter table persons             enable row level security;
alter table match_candidates    enable row level security;
alter table families            enable row level security;
alter table family_members      enable row level security;
alter table enrollments         enable row level security;
alter table eligibility_results enable row level security;
alter table anomaly_flags       enable row level security;
alter table pipeline_runs       enable row level security;
