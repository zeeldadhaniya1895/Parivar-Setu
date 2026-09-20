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
let queued: Promise<PipelineSummary> | null = null;

/**
 * Run the pipeline. A request that has just saved something (a decision, an event, a family change)
 * passes `afterChange`: a run already under way may have read its inputs before that save, so one
 * more run is queued behind it instead of joining it.
 */
export function runPipeline(actor = "system", options: { afterChange?: boolean } = {}): Promise<PipelineSummary> {
  if (inFlight === null) {
    inFlight = execute(actor).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }
  if (!options.afterChange) return inFlight;
  if (queued === null) {
    queued = inFlight
      .catch(() => undefined)
      .then(() => {
        queued = null;
        return runPipeline(actor, options);
      });
  }
  return queued;
}

async function execute(actor: string): Promise<PipelineSummary> {
  const started = new Date();
  const asOfDate = resolveAsOfDate(process.env.AS_OF_DATE, started);

  const inputs = await loadInputs();
  const result = runEngine({
    records: inputs.records,
    decisions: inputs.decisions,
    events: inputs.events,
    familyChanges: inputs.familyChanges,
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
