// Run the pipeline from the command line.
//
//   npm run pipeline               one run, prints the run stats
//   npm run pipeline -- --check    two runs, then compare every derived table row for row
import { config } from "dotenv";
import { createHash } from "node:crypto";

config({ path: [".env.local", ".env"], quiet: true });

// Ids from bigserial columns and evaluated_at change between runs by design; everything else must not.
const TABLES: readonly (readonly [table: string, orderBy: string, ignore: readonly string[]])[] = [
  ["persons", "id", []],
  ["match_candidates", "pair_key", []],
  ["families", "id", []],
  ["family_members", "person_id", ["id"]],
  ["enrollments", "source_record_id", ["id"]],
  ["eligibility_results", "id", ["id", "evaluated_at"]],
  ["anomaly_flags", "id", []],
];

async function snapshot(): Promise<Map<string, string>> {
  const { fetchAll } = await import("../lib/db/client");
  const result = new Map<string, string>();
  for (const [table, orderBy, ignore] of TABLES) {
    const rows = await fetchAll<Record<string, unknown>>(table, orderBy);
    const cleaned = rows.map((row) => {
      const copy = { ...row };
      for (const key of ignore) delete copy[key];
      return JSON.stringify(copy, Object.keys(copy).sort());
    });
    // eligibility_results and family_members have no natural unique key to order by, so sort the text
    cleaned.sort();
    result.set(table, `${rows.length} rows, sha256 ${createHash("sha256").update(cleaned.join("\n")).digest("hex")}`);
  }
  return result;
}

async function main() {
  const { runPipeline } = await import("../lib/pipeline");
  const check = process.argv.includes("--check");

  const first = await runPipeline("system");
  console.log(`Run ${first.runId} (rules ${first.rulesVersion}, as of ${first.asOfDate}) took ${first.durationMs} ms`);
  console.log(JSON.stringify(first.stats, null, 2));
  if (!check) return;

  const before = await snapshot();
  const second = await runPipeline("system");
  console.log(`\nRun ${second.runId} took ${second.durationMs} ms`);
  const after = await snapshot();

  let identical = JSON.stringify(first.stats) === JSON.stringify(second.stats);
  console.log(`stats identical: ${identical}`);
  for (const [table] of TABLES) {
    const same = before.get(table) === after.get(table);
    identical &&= same;
    console.log(`${same ? "same     " : "DIFFERENT"} ${table}: ${after.get(table)}`);
  }
  console.log(identical ? "\nTwo consecutive runs are identical." : "\nRuns differ!");
  if (!identical) process.exit(1);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
