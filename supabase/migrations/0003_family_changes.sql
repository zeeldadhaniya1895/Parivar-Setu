-- Family changes: an officer adds a member, separates members into a new family, or moves them
-- into an existing one. Run once in the Supabase SQL editor (after 0001 and 0002), then run the
-- pipeline (`npm run pipeline`). Safe to run again.
--
-- A change is an INPUT (a row in family_events, plus a source record for a brand-new member), so
-- it survives every rebuild of the derived tables and is re-applied by the engine each run.

-- Officer-entered records for new family members: source 'officer_entry', ids like USR-000001.
alter table source_records drop constraint if exists source_records_source_check;
alter table source_records add constraint source_records_source_check
  check (source in ('ration', 'pension', 'scholarship', 'death_registry', 'officer_entry'));

-- Two new kinds of event, with the reason and the supporting document.
alter table family_events drop constraint if exists family_events_type_check;
alter table family_events add constraint family_events_type_check
  check (type in ('death', 'marital_status_change', 'member_add', 'family_move'));

alter table family_events add column if not exists document_ref text;
alter table family_events add column if not exists reason text;

-- One document can authorise one change only. (Haryana: a single document reused to alter
-- thousands of family records.)
create unique index if not exists family_events_document_ref_unique
  on family_events (lower(document_ref)) where document_ref is not null;

-- A family left with no members is closed, not deleted, so its ID stays resolvable.
alter table families drop constraint if exists families_status_check;
alter table families add constraint families_status_check
  check (status in ('active', 'merged', 'closed'));

-- Membership history points at the change that started or ended it.
alter table family_members add column if not exists opened_by_event bigint;
alter table family_members add column if not exists closed_by_event bigint;
