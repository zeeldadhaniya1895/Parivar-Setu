import Link from "next/link";
import { RunButton } from "@/components/run-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { latestRun } from "@/lib/db/queries";
import { FLAG_LABELS, displayDateTime, number, percent, rupees } from "@/lib/format";
import { schemeName } from "@/lib/schemes";

function Stat({ title, value, hint }: { title: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="text-sm text-muted-foreground">{hint}</CardContent>}
    </Card>
  );
}

export default async function OfficerDashboard() {
  const run = await latestRun();
  const stats = run?.stats ?? null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            {run
              ? `Last run ${displayDateTime(run.finished_at ?? run.started_at)} · rules ${run.rules_version ?? "n/a"} · run #${run.id}`
              : "The pipeline has not run yet."}
          </p>
        </div>
        <RunButton />
      </div>

      {!stats ? (
        <Alert>
          <AlertTitle>No results yet</AlertTitle>
          <AlertDescription>
            Click &ldquo;Run resolution&rdquo; to build persons, families, flags and eligibility from the source
            records.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat title="Source records" value={number(stats.sourceRecords)} hint="Ration, pension, scholarship, death registry" />
            <Stat title="Persons resolved" value={number(stats.persons)} hint={`${number(stats.autoMerges)} record pairs auto-merged`} />
            <Stat
              title="Families"
              value={number(stats.families)}
              hint={`${number(stats.cardMerges)} duplicate ration cards merged · ${number(stats.unanchoredFamilies)} without a ration card`}
            />
            <Stat title="Est. monthly leakage" value={rupees(stats.estMonthlyLeakage)} hint="Each benefit counted once" />
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Flags</CardTitle>
                <CardDescription>Every flag stores the records and values that triggered it.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {Object.entries(stats.flagsByType).map(([type, count]) => (
                    <li key={type}>
                      <Link
                        href={`/officer/flags?type=${type}`}
                        className="flex items-center justify-between py-2 hover:text-primary"
                      >
                        <span>{FLAG_LABELS[type] ?? type}</span>
                        <Badge variant={count > 0 ? "default" : "outline"}>{count}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Eligible but not enrolled</CardTitle>
                <CardDescription>
                  {number(stats.eligibleNotEnrolled)} in total, under simplified demo criteria.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {Object.entries(stats.eligibleNotEnrolledByScheme).map(([code, count]) => (
                    <li key={code} className="flex items-center justify-between py-2">
                      <span>{schemeName(code)}</span>
                      <span className="tabular-nums">{number(count)}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-muted-foreground">
                  {number(stats.enrolledNotEligible)} enrollments are for people the demo rules mark ineligible.
                </p>
              </CardContent>
            </Card>
          </section>

          <section className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Match quality</CardTitle>
                <CardDescription>
                  Pairwise, against the synthetic ground truth (death registry excluded).
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-3 gap-4">
                  <div>
                    <dt className="text-sm text-muted-foreground">Precision</dt>
                    <dd className="text-2xl font-semibold tabular-nums">{percent(stats.precision)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">Recall</dt>
                    <dd className="text-2xl font-semibold tabular-nums">{percent(stats.recall)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-muted-foreground">F1</dt>
                    <dd className="text-2xl font-semibold tabular-nums">{percent(stats.f1)}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-sm text-muted-foreground">
                  {number(stats.correctPairs)} of {number(stats.truePairs)} true pairs found, {number(stats.predictedPairs)} predicted.
                  Pairs the engine is unsure about wait in the review queue.
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Review queue</CardTitle>
                <CardDescription>Pairs scored between 0.75 and 0.90 need an officer&rsquo;s decision.</CardDescription>
              </CardHeader>
              <CardContent className="flex items-center justify-between">
                <span className="text-3xl font-semibold tabular-nums">{number(stats.reviewPending)}</span>
                <Link href="/officer/review" className="text-sm text-primary underline-offset-4 hover:underline">
                  Open the queue
                </Link>
              </CardContent>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
