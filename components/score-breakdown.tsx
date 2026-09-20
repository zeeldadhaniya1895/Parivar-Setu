import { Badge } from "@/components/ui/badge";
import type { ScoreBreakdown as Breakdown } from "@/lib/engine/types";

const fmt = (n: number | null) => (n === null ? "n/a" : n.toFixed(2));

const DECISION_VARIANT = {
  auto_merge: "default",
  review: "secondary",
  distinct: "outline",
} as const;

/** Why a pair was merged, sent to review, or kept apart: every field score, hard rule and the result. */
export function ScoreBreakdown({
  breakdown, score, decision, reviewStatus,
}: {
  breakdown: Breakdown;
  score: number;
  decision: keyof typeof DECISION_VARIANT;
  reviewStatus?: string | null;
}) {
  const cells: [string, string][] = [
    ["Name", fmt(breakdown.name)],
    ["DOB", fmt(breakdown.dob)],
    ["Address", fmt(breakdown.address)],
    ["UID", breakdown.uid === null ? "n/a" : breakdown.uid === 1 ? "equal" : "different"],
  ];
  return (
    <div className="rounded-lg bg-muted/40 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={DECISION_VARIANT[decision]}>{decision.replace("_", " ")}</Badge>
        {reviewStatus && <Badge variant="outline">{reviewStatus}</Badge>}
        <span className="font-medium">Score {score.toFixed(2)}</span>
        <span className="text-muted-foreground">(weighted {breakdown.weighted.toFixed(2)} before rules)</span>
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
        {cells.map(([label, value]) => (
          <div key={label}>
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="font-mono">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-muted-foreground">
        Name parts &middot; first {fmt(breakdown.nameParts.first)}, middle {fmt(breakdown.nameParts.middle)}, surname{" "}
        {fmt(breakdown.nameParts.last)}
      </p>
      {breakdown.rules.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs">
          {breakdown.rules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
