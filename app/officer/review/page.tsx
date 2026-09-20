import { RecordCard } from "@/components/record-card";
import { ScoreBreakdown } from "@/components/score-breakdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pendingReviews } from "@/lib/db/queries";

export default async function ReviewPage() {
  const reviews = await pendingReviews();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
        <p className="text-sm text-muted-foreground">
          {reviews.length} pair{reviews.length === 1 ? "" : "s"} scored between 0.75 and 0.90, or sent here by the chaining
          guard. Highest score first.
        </p>
      </div>

      <Alert>
        <AlertTitle>Read-only for now</AlertTitle>
        <AlertDescription>
          Approve and reject arrive in a later step. Until then this shows exactly what an officer would compare.
        </AlertDescription>
      </Alert>

      {reviews.length === 0 && (
        <p className="py-8 text-center text-muted-foreground">
          Nothing is waiting for review. Run resolution from the dashboard if this is a fresh database.
        </p>
      )}

      {reviews.map(({ candidate, a, b }) => (
        <Card key={candidate.pair_key}>
          <CardHeader>
            <CardTitle className="font-mono text-sm">{candidate.pair_key}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              {a ? <RecordCard record={a} /> : <p className="text-sm text-muted-foreground">{candidate.record_a_id} not found</p>}
              {b ? <RecordCard record={b} /> : <p className="text-sm text-muted-foreground">{candidate.record_b_id} not found</p>}
            </div>
            <ScoreBreakdown
              breakdown={candidate.score_breakdown}
              score={candidate.score}
              decision={candidate.decision}
              reviewStatus={candidate.review_status}
            />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
