// Orchestrates one run: load inputs, run the pure engine in memory, persist, record the run.
import schemesJson from "../config/schemes.json";
import { loadInputs } from "./db/inputs";
import { recordRun, replaceDerived } from "./db/persist";
import { parseSchemesConfig } from "./engine/eligibility";
import { runEngine, type EngineResult } from "./engine/run";

const config = parseSchemesConfig(schemesJson);

export interface PipelineSummary {
  runId: number;
  rulesVersion: string;
  asOfDate: string;
  durationMs: number;
  stats: EngineResult["stats"];
}

/** "Today" for age calculations: AS_OF_DATE when set, otherwise the current date. */
export function resolveAsOfDate(env: string | undefined, now: Date): string {
  if (env === undefined || env.trim() === "") return now.toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(env.trim())) {
    throw new Error(`AS_OF_DATE must look like 2026-09-20, got "${env}"`);
  }
  return env.trim();
}

// Concurrent requests (a double click) share one run instead of interleaving deletes and inserts.
let inFlight: Promise<PipelineSummary> | null = null;

export function runPipeline(actor = "system"): Promise<PipelineSummary> {
  if (inFlight) return inFlight;
  inFlight = execute(actor).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function execute(actor: string): Promise<PipelineSummary> {
  const started = new Date();
  const asOfDate = resolveAsOfDate(process.env.AS_OF_DATE, started);

  const inputs = await loadInputs();
  const result = runEngine({
    records: inputs.records,
    decisions: inputs.decisions,
    asOfDate,
    config,
    truth: inputs.truth,
  });
  await replaceDerived(result);

  const finished = new Date();
  const runId = await recordRun(
    {
      startedAt: started.toISOString(),
      finishedAt: finished.toISOString(),
      rulesVersion: config.version,
      stats: result.stats,
    },
    actor,
  );
  return {
    runId,
    rulesVersion: config.version,
    asOfDate,
    durationMs: finished.getTime() - started.getTime(),
    stats: result.stats,
  };
}
