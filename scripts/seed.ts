// Seeds `source_records` with deterministic synthetic data.
//
//   npm run seed                 generate and insert into Supabase
//   npm run seed -- --dry-run    generate and print a summary, touch nothing
//   npm run seed -- --out f.json also write the generated rows to a file
//
// Only `source_records` is written. Derived tables are rebuilt by the pipeline (P3).
import { config } from "dotenv";
import { writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { generateSeed } from "./seed/generate";

config({ path: ".env.local" });

const BATCH_SIZE = 500;

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const outFile = argValue("--out");
  const seed = generateSeed();

  console.log(`Households: ${seed.stats.households}, people: ${seed.stats.persons}`);
  console.log("Source records:", seed.stats.recordsBySource, `(total ${seed.records.length})`);
  console.log("Noise applied:", seed.stats.noiseTags);
  const p = seed.planted;
  console.log("Planted cases:", {
    deceasedPension: p.deceasedPension.length,
    doubleEnrollment: p.doubleEnrollment.length,
    duplicateCards: p.duplicateCards.length,
    twoCards: p.twoCards.length,
    incomeMismatch: p.incomeMismatch.length,
    noCardBenefit: p.noCardBenefit.length,
    fatherSon: p.fatherSon.length,
    sameName: p.sameName.length,
  });
  console.log("Showcase family:", p.showcase);

  if (outFile) {
    writeFileSync(outFile, JSON.stringify({ records: seed.records, planted: p, truth: seed.truth }, null, 2));
    console.log(`Wrote ${outFile}`);
  }
  if (dryRun) {
    console.log("Dry run: nothing written to the database.");
    return;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error("Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (see .env.example).");
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { error: deleteError } = await supabase.from("source_records").delete().neq("id", "");
  if (deleteError) throw new Error(`Clearing source_records failed: ${deleteError.message}`);

  for (let i = 0; i < seed.records.length; i += BATCH_SIZE) {
    const batch = seed.records.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from("source_records").insert(batch);
    if (error) throw new Error(`Insert failed at row ${i}: ${error.message}`);
  }

  const { count, error: countError } = await supabase
    .from("source_records")
    .select("*", { count: "exact", head: true });
  if (countError) throw new Error(`Count failed: ${countError.message}`);
  console.log(`Inserted ${seed.records.length} rows; source_records now has ${count}.`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
