import { RecordCard } from "@/components/record-card";
import { ScoreBreakdown } from "@/components/score-breakdown";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { pendingReviews } from "@/lib/db/queries";
import { ReviewActions } from "@/components/review-actions";

export default async function ReviewPage() {
  const reviews = await pendingReviews();

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="border-b border-border/50 pb-6">
        <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-2">
          Review queue <span className="text-xl font-normal text-muted-foreground">(સમીક્ષા કતાર)</span>
        </h1>
        <p className="text-sm text-muted-foreground mt-2">
          {reviews.length} pair{reviews.length === 1 ? "" : "s"} scored between 0.75 and 0.90, or sent here by the chaining
          guard. Highest score first.
        </p>
      </div>


      {reviews.length === 0 && (
        <p className="py-8 text-center text-muted-foreground">
          Nothing is waiting for review. Run resolution from the dashboard if this is a fresh database.
        </p>
      )}

      {reviews.map(({ candidate, a, b }) => (
        <Card key={candidate.pair_key} className="hover-card border-l-4 border-l-amber-500/50 shadow-sm overflow-hidden">
          <CardHeader className="bg-muted/10 border-b border-border/50">
            <CardTitle className="font-mono text-sm flex items-center justify-between">
              <span>{candidate.record_a_id} | {candidate.record_b_id}</span>
              <Badge variant="outline" className="bg-background">Pair Key: {candidate.pair_key}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="grid gap-6 md:grid-cols-2">
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
          <CardFooter className="pt-4 border-t border-border/50 bg-muted/5 flex justify-end">
            <ReviewActions pairKey={candidate.pair_key} />
          </CardFooter>
        </Card>
      ))}
    </div>
  );
}
