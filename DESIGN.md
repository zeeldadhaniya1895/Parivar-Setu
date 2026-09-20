# Parivar Setu - Design Document

Working name. One verified Family ID for Gujarat that connects scattered scheme records, catches leakage, and tells every family what they are entitled to.

This document is the single source of truth for the build. Every module prompt to the coding agent should include Section 0 plus the section for that priority.

---

## 0. Rules for the coding agent

1. Build one priority at a time, in order. Do not start the next priority until the current one passes its "Done when" check.
2. Never modify a module that is already finished and tested unless the current task explicitly says so.
3. Everything in `lib/engine/` is pure TypeScript: no database, no network, no Next.js imports, no `Date.now()` inside logic (pass `asOfDate` in). Data in, data out.
4. Write unit tests for engine modules alongside the code (Vitest).
5. TypeScript strict mode. No `any`.
6. The browser never talks to Supabase directly. All reads happen in server components or server code, all writes go through route handlers. The service role key is server-only.
7. The LLM never decides anything. Eligibility, matching and flags are deterministic code. The LLM only phrases answers from facts we give it.
8. No real personal data anywhere. All data is synthetic.
9. Keep UI simple: shadcn/ui components, Tailwind defaults, no custom design work until P11.

---

## 1. Problem

Gujarat runs many welfare schemes, each with its own beneficiary database. The same family appears in several databases with different spellings, missing IDs and conflicting details. This causes three problems:

- **Leakage:** deceased people still receive pensions, the same person is enrolled twice, ineligible people receive benefits.
- **Exclusion:** eligible families never learn about schemes they qualify for.
- **No single view:** no officer can see a family as one unit.

Real precedent: Haryana's Parivar Pehchan Patra (8 digit family ID, operator-assisted registration, members added at birth and transferred on marriage). Its known failure: in Jhajjar, one document was reused to alter 3,485 family records. This design handles bootstrap (building families from existing records) and maintenance (changing them safely over time).

## 2. Users

Role is chosen with a toggle stored in a cookie. There is no authentication; the UI shows a visible "Demo mode" label.

- **Department officer:** dashboard, families, match lineage, flags, review queue, recording life events.
- **Citizen:** looks up a Family ID, sees eligible schemes, asks the assistant.

## 3. Scope

**In scope:** everything in the build plan (Section 10), P1 to P12.

**Out of scope (future work, mention in README):** real Aadhaar or eKYC, OCR on documents, real authentication, maker-checker approval UI, document hash fraud check, family split and member transfer UI, SMS notifications, Gujarati script transliteration of source data, integration with real department systems.

## 4. Tech stack

| Layer | Choice |
|---|---|
| App | Next.js (App Router), TypeScript strict |
| UI | Tailwind + shadcn/ui |
| Database | Supabase Postgres |
| LLM | Gemini API (free tier Flash model) via `@google/genai`, behind an adapter |
| Tests | Vitest |
| Hosting | Vercel |

**Environment variables** (also in `.env.example`):

```
NEXT_PUBLIC_SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
GEMINI_API_KEY=
GEMINI_MODEL=          # a free-tier Flash model name from AI Studio
AS_OF_DATE=            # optional, fixes "today" for age calculation, e.g. 2026-09-20
```

**Folder layout:**

```
app/                     pages and route handlers
  officer/               dashboard, families, flags, review
  citizen/               lookup and family view with assistant
  api/                   pipeline/run, review/[pairKey], events/death, assistant
components/              UI components
config/schemes.json      eligibility rules
lib/engine/              pure logic
  normalize.ts
  match.ts
  resolve.ts
  anomalies.ts
  eligibility.ts
  evaluate.ts
  types.ts
  __tests__/
lib/llm/                 provider interface, gemini adapter, fallback templates
lib/db/                  server-only Supabase queries
lib/pipeline.ts          orchestrates engine + persistence
scripts/seed.ts          deterministic synthetic data generator
supabase/migrations/     schema SQL
docs/                    DESIGN.md, ARCHITECTURE.md, diagram
```

---

## 5. Core principles

1. **Inputs are immutable, everything else is rebuildable.** Source records are never edited. Persons, families, flags and eligibility are outputs of the pipeline and can be wiped and rebuilt at any time.
2. **Human decisions are keyed to source record IDs.** Review decisions and life events reference immutable source record IDs, never derived person or family IDs, so they survive every rebuild.
3. **Determinism.** Same inputs always give the same outputs, including the same Family IDs. Seeded random data, sorted processing order, no hidden clock.
4. **Explainable decisions.** Every match stores its score breakdown. Every eligibility result stores which rules passed and failed. Every flag stores the evidence records.
5. **Auditability.** Every state-changing action writes to an append-only audit log, enforced by a database trigger.
6. **Privacy by design.** Only a hash and the last 4 digits of the national ID are stored. The UI masks IDs. The LLM only receives derived, non-identifying facts.

---

## 6. Data model

Tables fall into two groups:

- **Inputs (never truncated by the pipeline):** `source_records`, `review_decisions`, `family_events`, `audit_log`
- **Derived (truncated and rebuilt on every pipeline run):** `persons`, `match_candidates`, `families`, `family_members`, `enrollments`, `eligibility_results`, `anomaly_flags`, plus `pipeline_runs` which is appended

Enable Row Level Security on every table with no policies, so the anon key can read nothing. The server uses the service role key.

### Inputs

```
source_records
  id                text pk        -- e.g. 'RAT-000123', 'PEN-000045'
  source            text           -- ration | pension | scholarship | death_registry
  source_ref        text           -- department's own ID
  household_ref     text null      -- ration card number, ration source only
  full_name         text
  guardian_name     text null      -- father's name, scholarship source only
  dob               text null      -- raw string, formats vary on purpose
  gender            text null      -- M | F
  relation_to_head  text null      -- head | spouse | son | daughter | son_in_law |
                                   -- daughter_in_law | grandson | granddaughter |
                                   -- father | mother | other
  marital_status    text null      -- married | unmarried | widowed
  uid_hash          text null
  uid_last4         text null
  district, taluka, village, address  text
  income_declared   integer null   -- annual, rupees
  scheme_code       text null      -- pension: OLD_AGE_PENSION | WIDOW_ASSIST; scholarship: SCHOLARSHIP
  benefit_amount    integer null   -- monthly, rupees
  is_student        boolean null
  date_of_death     text null      -- death_registry only
  true_person_id    text           -- ground truth for evaluation only, never used by the engine

review_decisions
  pair_key          text pk        -- '<smaller record id>|<larger record id>'
  decision          text           -- approved | rejected
  decided_by        text
  reason            text null
  decided_at        timestamptz

family_events
  id                bigserial pk
  type              text           -- death | marital_status_change
  subject_record_id text           -- anchor source record of the person
  payload           jsonb          -- e.g. {"date_of_death": "2026-09-20"} or {"marital_status": "widowed"}
  source            text           -- officer | death_registry
  recorded_by       text
  created_at        timestamptz

audit_log                          -- append-only, trigger rejects UPDATE and DELETE
  id                bigserial pk
  actor             text           -- 'system' or 'officer:<name>'
  action            text           -- pipeline_run | review_decision | life_event | ...
  entity_type       text
  entity_id         text
  before            jsonb null
  after             jsonb null
  reason            text null
  created_at        timestamptz default now()
```

Audit trigger:

```sql
create or replace function forbid_audit_change() returns trigger as $$
begin
  raise exception 'audit_log is append-only';
end;
$$ language plpgsql;

create trigger audit_log_no_update before update or delete on audit_log
for each row execute function forbid_audit_change();
```

### Derived

```
persons
  id                text pk        -- 'P-000001', deterministic
  anchor_record_id  text           -- smallest source record id in the cluster
  canonical_name, dob, gender, uid_last4
  marital_status    text null
  is_deceased       boolean
  deceased_on       text null

match_candidates
  pair_key          text pk
  record_a_id, record_b_id  text
  score             numeric
  score_breakdown   jsonb          -- {"name":0.92,"dob":1,"address":0.8,"uid":null,"rules":["..."]}
  decision          text           -- auto_merge | review | distinct
  review_status     text null      -- pending | approved | rejected

families
  id                text pk        -- 'GJ-FID-000001', deterministic
  head_person_id    text
  district, taluka, village  text
  resolved_income   integer        -- highest declared value (conservative)
  income_sources    jsonb          -- every declared value with its source record
  is_anchored       boolean        -- false when not built from a ration card
  status            text           -- active | merged
  merged_into       text null
  parent_family_id  text null

family_members
  family_id, person_id  text
  relation_to_head  text
  valid_from        text null
  valid_to          text null
  -- partial unique index: unique (person_id) where valid_to is null

enrollments
  person_id         text
  family_id         text
  scheme_code       text
  source_record_id  text
  monthly_amount    integer null

eligibility_results
  family_id         text
  person_id         text null      -- null for family-scope schemes
  scheme_code       text
  eligible          boolean
  reasons           jsonb          -- [{"rule":"age gte 60","actual":67,"passed":true}]
  rules_version     text
  evaluated_at      timestamptz

anomaly_flags
  id                text pk
  type              text           -- see Section 7.4
  severity          text           -- high | medium | low
  family_id         text null
  person_id         text null
  evidence          jsonb          -- source record ids and the values that triggered it
  est_monthly_leakage integer null
  status            text           -- open

pipeline_runs
  id                bigserial pk
  started_at, finished_at  timestamptz
  rules_version     text
  stats             jsonb          -- counts, leakage estimate, precision, recall, f1
```

---

## 7. Domain rules

### 7.1 Name normalization

Gujarati names follow **first name + father's or husband's name + surname**. "Ramesh Kantilal Patel" is Ramesh, son of Kantilal. The middle name is relationship evidence, not noise.

Steps, in order:

1. Lowercase, remove punctuation except spaces, collapse whitespace.
2. If the name contains `late`, `swargiya` or `sw.` as a title, record a `late_marker` flag, then remove it.
3. Remove titles: `shri`, `shree`, `smt`, `shrimati`, `kum`, `kumari`, `mr`, `mrs`, `ms`, `dr`.
4. Remove Gujarati honorific suffixes when attached to a token: `bhai`, `ben`, `behn` (rameshbhai becomes ramesh, savitaben becomes savita). Do not strip `kumar`, it is often a real name part.
5. Parse into `first`, `middle`, `last`. If the first token is a known surname (keep a list of about 30 common Gujarati surnames: patel, shah, desai, mehta, joshi, parmar, chauhan, solanki, rathod, chaudhary, thakor, prajapati, modi, trivedi, pandya, bhatt, vaghela, makwana, gohil, jadeja, zala, dave, vyas, raval, panchal, soni, mistry, barot, rabari, bharwad), treat the order as surname-first.
6. A single-letter middle token is an initial.

**Indic phonetic key**, applied to each name part, rules in this order:

```
aa->a  ee->i  ii->i  oo->u  uu->u  ou->u  au->o  ai->e
bh->b  dh->d  kh->k  gh->g  th->t  ph->f  jh->j  ch->c
sh->s  w->v   z->j   q->k   y at end -> i
collapse any repeated letter to one
drop a trailing 'a' if the word is longer than 3 letters
```

Examples that must produce equal keys: pooja / puja, bhavesh / bavesh, chaudhary / choudhari / chaudhari, patel / patal is not guaranteed by the key and is handled by Jaro-Winkler instead.

### 7.2 Other field normalization

- **DOB:** accept `dd/mm/yyyy`, `dd-mm-yyyy`, `yyyy-mm-dd`, year only (`1958`), and age strings (`age 67`, converted using `asOfDate`, marked approximate).
- **Address:** normalize village and taluka names with lowercase and phonetic key; extract a house number token if present.

### 7.3 Matching

**Blocking**, candidate pairs are the union of three passes:

1. same district + same surname phonetic key
2. same `uid_hash` (when present)
3. same birth year + same first letter of first name

Never compare records from the `death_registry` against each other.

**Field scores** return a number from 0 to 1, or `null` when either side is missing:

- **Name** = 0.5 x first + 0.3 x surname + 0.2 x middle, each by Jaro-Winkler on normalized text, with phonetic key equality counting as 1.0. Middle: full vs full uses Jaro-Winkler; initial vs full is 0.85 if the letter matches, else 0; missing is null. Nulls are dropped and remaining weights rescaled.
- **DOB:** exact 1.0, day and month swapped 0.8, same year only 0.6, within 1 year when either side is approximate 0.5, else 0.
- **Address:** same village 0.7 + same house number token 0.3; different village in same taluka 0.2; else 0.

**Weighted score** = 0.45 name + 0.35 DOB + 0.20 address, with null weights redistributed proportionally.

**Hard rules** (applied after the weighted score, recorded in `score_breakdown.rules`):

| Condition | Result |
|---|---|
| both `uid_hash` present and equal | score 0.99 |
| both `uid_hash` present and different | distinct |
| gender differs | distinct |
| DOB differs by more than 5 years | distinct (father and son case) |
| both have full middle names and their similarity is below 0.8 | score minus 0.25 (different fathers) |

**Classification:** score at or above 0.90 is `auto_merge`, 0.75 up to 0.90 is `review`, below 0.75 is `distinct`.

Existing `review_decisions` override the classification for their pair: approved counts as a match, rejected counts as distinct.

### 7.4 Clustering and families

**Person clustering:** union-find over all matched pairs. Then the **chaining guard**: if any two records in a cluster have different `uid_hash`, different gender, or DOBs more than 5 years apart, do not merge the cluster. Split it back into its original records and set every pair inside it to `review`.

**Survivorship** for the canonical person: name from the ration record if present, else the longest name; DOB from the record with a full date; `uid_last4` from any record; `is_deceased` if any death_registry record is in the cluster or a `death` event exists.

**Person IDs** are assigned in order of `anchor_record_id` so they are deterministic.

**Families:**

1. Each ration card (`household_ref`) is a candidate family.
2. Two ration cards are the same family if shared persons divided by the size of the smaller card is at least 0.5. Keep the card with more members (tie: smaller ref), merge the other into it, and raise `duplicate_enrollment` for scheme `NFSA_RATION`.
3. If one person appears on two cards that are not merged, keep them in the card with the larger ref number (treated as more recent) and raise `multi_household`.
4. A person from pension or scholarship attaches to the family of the ration member they matched.
5. **(P10)** An unmatched scholarship person attaches to a family where a member matches their guardian name or middle name as a first name, in the same village, and is between 18 and 50 years older. Otherwise go to step 6.
6. Anyone still unattached gets a single-person family with `is_anchored = false`.
7. **Family IDs** are assigned in order of the family's smallest ration card ref, then unanchored families by anchor record id.
8. Head of family: the ration card's `head` member.
9. `resolved_income` is the highest declared income across all members' records; all values are kept in `income_sources`.

### 7.5 Anomalies

| Type | Rule | Severity | Leakage estimate |
|---|---|---|---|
| `deceased_beneficiary` | person is deceased and has an enrollment with a benefit | high | that benefit amount |
| `duplicate_enrollment` | same person has two enrollments in the same scheme, or duplicate ration cards (7.4 rule 2) | high | the extra benefit amount |
| `multi_household` | person on two unmerged ration cards | medium | none |
| `income_mismatch` | family's highest declared income is more than 1.5x the lowest and the difference exceeds 50,000 | medium | none |
| `unanchored_beneficiary` | person with an enrollment in a family where `is_anchored = false` | low | none |

Every flag stores its evidence: the source record IDs and the values that triggered it.

### 7.6 Eligibility

Rules live in `config/schemes.json` with a `version` field. **All thresholds are simplified demo values, not official criteria, and the UI and README must say so.**

Rule format: `all` and `any` groups containing conditions `{ "field", "op", "value" }`. Operators: `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `in`, `on_or_after`, `on_or_before`.

Evaluation context: person fields (`age`, `gender`, `marital_status`, `is_student`, `dob`) plus family fields prefixed `family.` (`family.resolved_income`, `family.size`). Family-scope schemes see only family fields.

Global rule before any scheme: deceased persons are never eligible.

| Code | Name | Scope | Demo rule | Enrollment source |
|---|---|---|---|---|
| `NFSA_RATION` | Food security ration | family | family.resolved_income lte 120000 | ration card exists |
| `OLD_AGE_PENSION` | Old age pension | person | age gte 60 and family.resolved_income lte 120000 | pension records |
| `WIDOW_ASSIST` | Ganga Swarupa widow assistance | person | gender eq F and marital_status eq widowed and age gte 18 | pension records |
| `SCHOLARSHIP` | Student scholarship | person | is_student eq true and family.resolved_income lte 250000 | scholarship records |
| `VAHLI_DIKRI` | Vahli Dikri Yojana | person | gender eq F and dob on_or_after 2019-08-02 and family.resolved_income lte 200000 | none (discovery only) |
| `PMJAY_MA` | PMJAY-MA health cover | family | family.resolved_income lte 500000 | none (discovery only) |

Each result stores every condition with its actual value and pass or fail.

**Gap analysis:**
- **Eligible not enrolled:** eligible result with no matching enrollment. For discovery-only schemes, every eligible result counts.
- **Enrolled not eligible:** enrollment with an ineligible result. Adds that benefit to the leakage estimate.

### 7.7 Life events (P8)

Recording a death for a person:

1. Write a `family_events` row of type `death` keyed to the person's `anchor_record_id`.
2. If the person has a current spouse in the family (relation `spouse` when the deceased is `head`, or the `head` when the deceased is `spouse`), write a `marital_status_change` event to `widowed` for that spouse.
3. Write an audit log entry.
4. Rerun the pipeline.

The pipeline applies events after clustering and before anomalies, so the result is: the deceased person's pension raises `deceased_beneficiary`, and the spouse becomes eligible for `WIDOW_ASSIST` if she meets the rule.

### 7.8 Pipeline order

```
load inputs
  -> normalize all source records
  -> block, compare, score, classify pairs
  -> apply review decisions
  -> cluster with chaining guard, build persons
  -> build families
  -> apply family events
  -> derive enrollments
  -> detect anomalies
  -> evaluate eligibility and gaps
  -> evaluate precision and recall against true_person_id
  -> truncate derived tables, insert results in batches of 500
  -> write pipeline_runs row and audit entry
```

The engine part runs fully in memory and returns one result object. Persistence is a separate step.

### 7.9 Assistant

- Route: `POST /api/assistant` with `{ familyId, question, lang }` where lang is `gu` or `en`.
- Facts sent to the LLM: family size, each member's relation, age band (0-17, 18-59, 60+), gender, income band, eligibility results with reasons, current enrollments. **Never names, IDs, village or addresses.**
- System prompt: answer only from the given facts; if the answer is not in the facts, say so; reply in the requested language; under 120 words; no promises of payment.
- Timeout 8 seconds, one retry after 1 second on 429 or 5xx, then fallback.
- Fallback: a template in Gujarati and English that lists eligible schemes and the main reason for each, built directly from eligibility results.
- Response includes `source: "gemini" | "fallback"`, shown as a small badge in the UI.
- The adapter implements a `LLMProvider` interface so another provider can be swapped in by adding one file.

### 7.10 Evaluation

Pairwise over source records (excluding death registry): a pair is a true match if both records share `true_person_id`, and a predicted match if they end up in the same person.

- precision = true predicted pairs / all predicted pairs
- recall = true predicted pairs / all true pairs
- F1

Stored in `pipeline_runs.stats` and shown on the dashboard. A perfect score is a warning sign that the seed data lacks hard negatives.

---

## 8. Non-functional requirements

| Attribute | Requirement |
|---|---|
| Explainability | Every match, flag and eligibility result shows why |
| Determinism | Same inputs give identical outputs, including IDs |
| Auditability | Append-only audit log enforced by trigger |
| Privacy | Hashed IDs, masked display, derived facts only to LLM, synthetic data only |
| Reliability | Assistant always answers via fallback; pipeline rerun is safe |
| Performance | Pipeline on the full seed completes within a few seconds |
| Scalability | Blocking avoids comparing all pairs; designed for state scale |
| Maintainability | Pure engine, rules as config, LLM behind an adapter |
| Testability | Unit tests on every engine module, ground-truth evaluation |
| Security | Secrets server-only, RLS denies anon, no browser DB access |
| Deployability | One seed command, `.env.example`, README setup steps |

---

## 9. Seed data specification

Deterministic, using a small seeded random generator (mulberry32 with a fixed seed). No external API calls.

**Volume:** 200 households, 2 to 7 members each, across 3 districts (Mehsana, Anand, Banaskantha), a few talukas and 4 to 6 villages per taluka. Roughly 800 people and 1,100 source records.

**Sources:**
- **ration:** one record per member, shared `household_ref`, relation, marital status, household income. About 90 percent of households have a ration card.
- **pension:** old age pension for some people 60+, widow assistance for some widows.
- **scholarship:** some students aged 10 to 22, with `guardian_name` set to the father's first name.
- **death_registry:** recent deaths.

**Identity:** about 70 percent of records carry `uid_hash` and `uid_last4`; the rest are missing.

**Noise applied to non-ration records** (and a little to ration records), each tagged internally so evaluation can be broken down by type later:
spelling variants (vowel and aspiration changes), bhai or ben suffixes, titles, initials instead of middle names, surname-first order, year-only DOB, age string instead of DOB, day and month swapped, missing UID, village spelling variation.

**Planted cases:**
- 10 deceased people still receiving a pension
- 6 people enrolled twice in the same scheme
- 5 duplicate ration cards
- 5 people on two ration cards (married daughter or son who moved out)
- 10 families with income mismatch
- 10 people with benefits but no ration card
- 15 hard negatives: father and son with near-identical names in the same household, and same-name different people in the same village
- natural eligible-not-enrolled cases, including young girls for Vahli Dikri
- at least one showcase family matching the demo story: head aged about 67 on ration and pension with a spelling variant, spouse alive and married, a granddaughter born after 2019, a scholarship grandchild with only the father's name as a link

---

## 10. Build plan

Move to the next priority only when the current one passes "Done when" and is deployed. If a priority runs 50 percent over its time, ship a simpler version and move on.

### P1 - Foundation (0:00 to 0:45)
**Build:** Next.js app with the folder layout, Supabase migration for all tables, RLS, partial unique index and audit trigger, Vercel deploy, `scripts/seed.ts` per Section 9.
**Done when:** the live link loads, the database has seeded records, and a planted duplicate and a father-son pair can be found by querying.

### P2 - Engine core (0:45 to 2:15)
**Build:** `normalize.ts`, `match.ts`, `resolve.ts` per Sections 7.1 to 7.4 (P10 attaching rule excluded).
**Tests:** phonetic key equivalences, suffix and title stripping, late marker, surname-first parsing, missing fields return null and do not penalize, father-son stays distinct, UID mismatch forces distinct, middle name penalty, chaining guard splits a contradictory cluster, duplicate ration card merge, multi-household detection, deterministic IDs across two runs.
**Done when:** all tests pass.

### P3 - Outcomes and pipeline (2:15 to 3:05)
**Build:** `anomalies.ts`, `eligibility.ts` with `config/schemes.json`, gap analysis, `evaluate.ts`, `lib/pipeline.ts` per Section 7.8, `POST /api/pipeline/run`.
**Tests:** each anomaly type, each operator, deceased never eligible, reasons recorded, gap analysis both directions.
**Done when:** one pipeline run rebuilds everything, two consecutive runs produce identical results, deployed.

### P4 - Officer UI (3:05 to 3:55)
**Build:**
- `/` role toggle with demo mode label
- `/officer` dashboard: source records, persons, families, merges, flags by type, estimated monthly leakage, eligible-not-enrolled count, precision/recall/F1, last run time, "Run resolution" button
- `/officer/families` searchable list
- `/officer/families/[id]` members, lineage to source records, match score breakdowns, eligibility with reasons, flags
- `/officer/flags` filterable by type
- `/officer/review` pending pairs side by side with score breakdown (read-only in this priority)
- masked UIDs everywhere, "demo criteria" notice on eligibility
**Done when:** the demo story can be walked on the live link.

### P5 - Citizen assistant (3:55 to 4:15)
**Build:** `/citizen` Family ID lookup, `/citizen/[familyId]` with eligible schemes and chat, `lib/llm/` per Section 7.9. Build the fallback first.
**Done when:** answers in Gujarati, and still answers with `GEMINI_API_KEY` removed.

### P6 - Evaluation (4:15 to 4:25)
**Build:** wire Section 7.10 results into the dashboard.
**Done when:** real, imperfect numbers show.

### P7 - Safe submission (4:25 to 4:40)
**Build:** `docs/ARCHITECTURE.md` and diagram updated to match the code, README v1 (overview, setup, design decisions, limitations, future work), zip without `node_modules` and `.env` but with `.env.example`.
**Done when:** unzipping into a fresh folder and following the README works.

### P8 - Death event (4:40 to 5:00)
**Build:** "Record death" action on a member in family detail, `POST /api/events/death` per Section 7.7.
**Done when:** on the live link, recording a death raises the deceased flag for their pension and makes the spouse eligible for widow assistance.

### P9 - Review queue actions (5:00 to 5:15)
**Build:** approve and reject on `/officer/review`, `POST /api/review/[pairKey]` writing `review_decisions` and audit log, then rerun.
**Done when:** a decision survives a pipeline rerun.

### P10 - Relationship attaching (5:15 to 5:30)
**Build:** Section 7.4 rule 5. Record precision, recall and unanchored count before and after.
**Done when:** unanchored families drop and the before and after numbers are in the README.

### P11 - Bilingual labels and polish (5:30 to 5:45)
**Build:** Gujarati labels on key screens, spacing and consistency fixes, mobile check.
**Done when:** nothing looks broken on a phone.

### P12 - Final submission (5:45 to 6:00)
**Build:** update README, ARCHITECTURE.md and diagram for everything after P7, final deploy, incognito test, final zip.

---

## 11. Demo script (3 minutes)

1. The problem in one line: one family scattered across schemes, leakage on one side, exclusion on the other.
2. Dashboard numbers after one "Run resolution" click.
3. The showcase family: messy records from four sources become one Family ID, with the score breakdown explaining each merge.
4. A flag with its evidence.
5. Eligible schemes with reasons, including one they are not enrolled in.
6. Record a death live: the pension flag appears, the spouse becomes eligible for widow assistance.
7. Citizen asks the assistant in Gujarati.
8. Close on precision and recall, and the design choices: deterministic engine, LLM only for language, audit trail, built against the known failure of existing systems.

## 12. Known limitations

- Eligibility thresholds are simplified demo values, not official scheme criteria.
- Match weights are hand-set, not calibrated. They can be learned with the Fellegi-Sunter model once labeled pairs exist.
- No authentication or maker-checker approval in the demo.
- Source data is Latin script only.
- The pipeline truncates and reinserts derived tables without a single transaction.
