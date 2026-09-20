import Link from "next/link";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { STATUS_LABELS } from "@/lib/benefit-status";
import { listGrievances } from "@/lib/db/grievances";
import { personFirstNames } from "@/lib/db/queries";
import { displayDateTime } from "@/lib/format";
import type { GrievanceRow } from "@/lib/grievances";
import { describeRule } from "@/lib/rule-text";
import { schemeName } from "@/lib/schemes";
import { AnswerForm } from "./answer-form";

type Filter = "pending" | "resolved" | "all";

export default async function GrievancesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const filter: Filter = status === "resolved" || status === "all" ? status : "pending";

  let all: GrievanceRow[];
  try {
    all = await listGrievances(null);
  } catch (error) {
    console.error("grievances unavailable", error);
    return (
      <Alert>
        <AlertTitle>Grievances are not set up yet</AlertTitle>
        <AlertDescription>
          The grievances table is missing. Run supabase/migrations/0002_grievances.sql in the Supabase SQL editor, then reload.
        </AlertDescription>
      </Alert>
    );
  }

  const pendingCount = all.filter((g) => g.status === "pending").length;
  const shown = all.filter((g) => filter === "all" || g.status === filter);
  const names = await personFirstNames(shown.flatMap((g) => (g.person_id ? [g.person_id] : [])));
  const tab = (value: Filter, label: string) => (
    <Link
      key={value}
      href={`/officer/grievances?status=${value}`}
      className={buttonVariants({ variant: filter === value ? "default" : "outline", size: "sm" })}
    >
      {label}
    </Link>
  );

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Grievances <span className="text-lg font-normal text-muted-foreground">(ફરિયાદો)</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Questions from families about schemes they are not getting. Your answer appears on their page.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Filter grievances">
        {tab("pending", `Waiting for an answer (${pendingCount})`)}
        {tab("resolved", `Answered (${all.length - pendingCount})`)}
        {tab("all", `All (${all.length})`)}
      </nav>

      {shown.length === 0 && (
        <p className="rounded-lg border bg-muted/20 py-10 text-center text-muted-foreground">
          {filter === "pending" ? "Nothing is waiting for an answer." : "No grievances here."}
        </p>
      )}

      {shown.map((g) => {
        const snap = g.eligibility_snapshot;
        return (
          <Card key={g.id}>
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle>{schemeName(g.scheme_code)}</CardTitle>
                <Badge variant={g.status === "resolved" ? "secondary" : "default"}>
                  {g.status === "resolved" ? "Answered" : "Waiting"}
                </Badge>
              </div>
              <CardDescription>
                <Link href={`/officer/families/${g.family_id}`} className="font-mono text-primary underline-offset-4 hover:underline">
                  {g.family_id}
                </Link>
                {g.person_id ? ` · ${names.get(g.person_id) ?? g.person_id}` : " · whole family"}
                {" · filed "}{displayDateTime(g.created_at)}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Question</div>
                <p className="mt-1 whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">{g.message}</p>
              </div>

              {snap && (
                <details className="text-sm">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                    What the system said when this was filed: <strong>{STATUS_LABELS[snap.status].en}</strong>
                  </summary>
                  <ul className="mt-2 space-y-0.5 text-xs">
                    {snap.reasons.map((r) => (
                      <li key={r.rule} className={r.passed ? "" : "text-destructive"}>
                        {r.passed ? "✓" : "✗"} {describeRule(r.rule, "en")}{" "}
                        <span className="text-muted-foreground">(actual: {r.actual === null ? "unknown" : String(r.actual)})</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {g.status === "resolved" ? (
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Answer</div>
                  <p className="mt-1 whitespace-pre-wrap rounded-md border border-primary/20 bg-primary/5 p-3 text-sm">{g.officer_response}</p>
                  <p className="mt-1 text-right text-xs text-muted-foreground">
                    {g.answered_by ?? "Officer"} &middot; {displayDateTime(g.resolved_at)}
                  </p>
                </div>
              ) : (
                <AnswerForm id={g.id} />
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
