# Parivar Setu

One verified Family ID for Gujarat that connects scattered scheme records, catches leakage,
and tells every family what they are entitled to. **Demo project: all data is synthetic and
all eligibility thresholds are simplified demo values, not official criteria.**

The full spec is in [docs/DESIGN.md](docs/DESIGN.md); the architecture is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The build follows the priority order P1 to P12
in the design doc. This README is the P1 version and will be expanded at P7 and P12.

## Setup

Requirements: Node 22+, npm, a free [Supabase](https://supabase.com) project.

```bash
npm install
cp .env.example .env.local      # then fill in the values
```

1. In Supabase, create a project. From **Project Settings > API** copy the project URL into
   `NEXT_PUBLIC_SUPABASE_URL` and the `service_role` secret into `SUPABASE_SERVICE_ROLE_KEY`.
   The service role key is server-only: never expose it in browser code or commit it.
2. Create the schema: open the Supabase **SQL editor**, paste the contents of
   [supabase/migrations/0001_init.sql](supabase/migrations/0001_init.sql) and run it.
3. Load the synthetic source data:

   ```bash
   npm run seed
   ```

   `npm run seed -- --dry-run` prints a summary without touching the database.
4. `npm run dev`, then open http://localhost:3000.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the app locally |
| `npm run build` | Production build |
| `npm test` | Vitest unit tests (engine and seed generator) |
| `npm run typecheck` | TypeScript strict check |
| `npm run seed` | Deterministic synthetic data into `source_records` |

## Status

P1 (foundation): app scaffold, database schema, seed data. Engine, pipeline and UI are
built in the later priorities.
