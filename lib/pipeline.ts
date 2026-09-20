// Orchestrates one run: load inputs, run the pure engine in memory, persist, record the run.
import schemesJson from "../config/schemes.json";
import { resolveAsOfDate } from "./asof";
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
