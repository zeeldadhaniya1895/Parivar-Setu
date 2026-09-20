import { runPipeline } from "@/lib/pipeline";

// A full run on the seed takes a few seconds; leave headroom on Vercel.
export const maxDuration = 60;

/** Rebuild every derived table from the input tables. Safe to repeat: the result is deterministic. */
export async function POST() {
  try {
    const summary = await runPipeline("system");
    return Response.json({ ok: true, ...summary });
  } catch (error) {
    console.error("pipeline run failed", error);
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : "Pipeline run failed" },
      { status: 500 },
    );
  }
}
