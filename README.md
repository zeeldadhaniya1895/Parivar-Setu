# Parivar Setu

One verified Family ID for Gujarat that connects scattered scheme records, catches leakage,
and tells every family what they are entitled to. **Demo project: all data is synthetic and
all eligibility thresholds are simplified demo values, not official criteria.**

## What it does

Gujarat runs many welfare schemes — ration cards, pensions, scholarships — each with its own
beneficiary database. The same family appears across databases with different spellings,
missing IDs, and conflicting details. This causes:

- **Leakage:** deceased people still receive pensions, duplicate enrollments, ineligible
  beneficiaries.
- **Exclusion:** eligible families never learn about schemes they qualify for.
- **No single view:** no officer can see a family as one unit.

Parivar Setu ingests source records from four departments, resolves messy identities into one
Family ID per household using a deterministic matching engine, detects anomalies, evaluates
eligibility for six welfare schemes, and provides a bilingual AI assistant for citizens.

## Architecture

The full architecture is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). At a glance:

| Layer | What | Where |
|---|---|---|
| **Domain engine** | Normalization, matching, clustering, anomalies, eligibility — all pure TypeScript, no I/O | `lib/engine/` |
| **Pipeline** | Loads inputs → runs the engine in memory → persists results | `lib/pipeline.ts` |
| **LLM layer** | Gemini adapter with fallback templates, strips identifying data | `lib/llm/` |
| **Data access** | Server-only Supabase queries | `lib/db/` |
| **UI** | Next.js App Router: officer dashboard + citizen assistant | `app/` |
| **Scheme rules** | Versioned JSON, no code changes to add a scheme | `config/schemes.json` |

![System architecture](docs/architecture.png)

## Setup

**Requirements:** Node 22+, npm, a free [Supabase](https://supabase.com) project.

```bash
npm install
cp .env.example .env.local      # then fill in the values
```

### Environment variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only service role key (never expose in browser) |
| `GEMINI_API_KEY` | No | Google AI Studio API key. Without it, the assistant uses fallback templates. |
| `GEMINI_MODEL` | No | Defaults to `gemini-2.0-flash` (free tier) |
| `AS_OF_DATE` | No | Fixes "today" for age calculation, e.g. `2026-09-20` |

### Database setup

1. In Supabase, create a project. From **Project Settings > API** copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY`
2. Open the Supabase **SQL editor**, paste the contents of
   [`supabase/migrations/0001_init.sql`](supabase/migrations/0001_init.sql) and run it.

### Seed data

```bash
npm run seed            # loads ~1,100 synthetic records with ground truth labels
npm run seed -- --dry-run   # prints a summary without touching the database
```

### Run

```bash
npm run dev             # start locally at http://localhost:3000
```

1. Choose **Officer** or **Citizen** role (demo toggle, no authentication).
2. As officer: click **Run resolution** to build families from source records.
3. Explore families, flags, match lineage, eligibility, and the review queue.
4. As citizen: enter a Family ID (e.g. `GJ-FID-000001`), see eligible schemes, ask the assistant.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app locally |
| `npm run build` | Production build |
| `npm test` | Vitest unit tests (engine, seed, and assistant) |
| `npm run typecheck` | TypeScript strict check |
| `npm run seed` | Deterministic synthetic data into `source_records` |
| `npm run pipeline` | Run the resolution pipeline from the command line |

## Design decisions

| Decision | Why |
|---|---|
| **Deterministic rules for eligibility, LLM only phrases answers** | Government decisions must be reproducible and explainable; an LLM is neither |
| **Weighted heuristic matcher with hard rules** | No labeled data; every score must be explainable. Weights can later be calibrated with Fellegi-Sunter. |
| **Custom Indic phonetic key** | Soundex and Metaphone are tuned for English and fail on transliterated Gujarati names |
| **Ration card as household anchor** | Ration cards legally define households; one address often holds many families |
| **Rebuild derived data on every run** | Simpler, deterministic, safe to rerun; incremental resolution is the scale path |
| **Rules as JSON config** | Adding a scheme needs no code change; the version is stored with every result |
| **LLM behind a provider interface** | Provider can be swapped by adding one file; fallback lives in one place |
| **Privacy: LLM sees only derived facts** | Never names, IDs, villages, or addresses. Free-tier inputs may be used by the provider. |

## Eligibility schemes (demo criteria)

| Code | Name | Scope | Key rule |
|---|---|---|---|
| `NFSA_RATION` | Food security ration | Family | Income ≤ ₹1,20,000 |
| `OLD_AGE_PENSION` | Old age pension | Person | Age ≥ 60, income ≤ ₹1,20,000 |
| `WIDOW_ASSIST` | Ganga Swarupa widow assistance | Person | Female, widowed, age ≥ 18 |
| `SCHOLARSHIP` | Student scholarship | Person | Student, income ≤ ₹2,50,000 |
| `VAHLI_DIKRI` | Vahli Dikri Yojana | Person | Female, born on/after 2019-08-02, income ≤ ₹2,00,000 |
| `PMJAY_MA` | PMJAY-MA health cover | Family | Income ≤ ₹5,00,000 |

All thresholds are simplified demo values, not official criteria.

## Anomaly types

| Type | Severity | What it catches |
|---|---|---|
| `deceased_beneficiary` | High | Dead person still receiving a pension or benefit |
| `duplicate_enrollment` | High | Same person enrolled twice in the same scheme |
| `multi_household` | Medium | Person listed on two unmerged ration cards |
| `income_mismatch` | Medium | Family's highest declared income > 1.5× lowest, difference > ₹50,000 |
| `unanchored_beneficiary` | Low | Person with benefits but no ration card |

## Tests

191 tests covering the engine modules, seed data generator, pipeline integration, and assistant logic:

```bash
npm test                # run all
npm run test:watch      # watch mode
```

## Limitations

- Eligibility thresholds are simplified demo values, not official scheme criteria.
- Match weights are hand-set, not calibrated. They can be learned with the Fellegi-Sunter
  model once labeled pairs exist.
- No authentication or maker-checker approval in the demo.
- Source data is Latin script only.
- The pipeline truncates and reinserts derived tables without a single transaction.

## Future work

- Real Aadhaar or eKYC integration
- OCR on documents
- Real authentication and maker-checker approval
- Document hash fraud check
- Family split and member transfer UI
- SMS notifications
- Gujarati script transliteration of source data
- Integration with real department systems

## Docs

- [DESIGN.md](docs/DESIGN.md) — the single source of truth for the build
- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — system architecture, data model, design decisions
