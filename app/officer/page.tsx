import Link from "next/link";
import { RunButton } from "@/components/run-button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { latestRun } from "@/lib/db/queries";
import { FLAG_LABELS, displayDateTime, number, percent, rupees } from "@/lib/format";
import { schemeName } from "@/lib/schemes";
import { FileText, Users, Home, AlertTriangle, Flag, ShieldCheck, Activity, Target, Download, CheckCircle } from "lucide-react";

function Stat({ title, gujarati, value, hint, icon: Icon, colorClass }: { title: string; gujarati: string; value: string; hint?: string; icon: React.ElementType; colorClass: string }) {
  return (
    <Card className="hover-card border-l-4 border-l-transparent hover:border-l-primary overflow-hidden relative">
      <div className={`absolute -right-4 -top-4 opacity-5 ${colorClass}`}>
        <Icon size={120} />
      </div>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardDescription className="font-medium text-foreground">{title}</CardDescription>
            <CardDescription className="text-xs text-muted-foreground">{gujarati}</CardDescription>
          </div>
          <div className={`p-2 rounded-lg bg-background shadow-sm border ${colorClass}`}>
            <Icon size={18} />
          </div>
        </div>
        <CardTitle className="text-3xl tabular-nums pt-2">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="text-xs text-muted-foreground leading-relaxed">{hint}</CardContent>}
    </Card>
  );
}

export default async function OfficerDashboard() {
  const run = await latestRun();
  const stats = run?.stats ?? null;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border/50 pb-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary flex items-center gap-2">
            Dashboard <span className="text-xl font-normal text-muted-foreground">(ડેશબોર્ડ)</span>
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {run
              ? `Last run ${displayDateTime(run.finished_at ?? run.started_at)} · rules ${run.rules_version ?? "n/a"} · run #${run.id}`
              : "The pipeline has not run yet."}
          </p>
        </div>
        <RunButton />
      </div>

      {!stats ? (
        <Alert className="border-primary/20 bg-primary/5">
          <Activity className="h-4 w-4 text-primary" />
          <AlertTitle>No results yet</AlertTitle>
          <AlertDescription>
            Click &ldquo;Run resolution&rdquo; to build persons, families, flags and eligibility from the source records.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {!stats.receivingByScheme && (
            <Alert className="border-amber-500/40 bg-amber-500/5">
              <AlertTitle>These results are from before the benefits update</AlertTitle>
              <AlertDescription>
                Run supabase/migrations/0002_grievances.sql in Supabase if you have not, then click
                &ldquo;Run resolution&rdquo; to fill in who is receiving each scheme and who is waiting for verification.
              </AlertDescription>
            </Alert>
          )}
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Stat 
              title="Source records" 
              gujarati="સ્ત્રોત રેકોર્ડ્સ"
              value={number(stats.sourceRecords)} 
              hint="Ration, pension, scholarship, death registry" 
              icon={FileText}
              colorClass="text-blue-500"
            />
            <Stat 
              title="Persons resolved" 
              gujarati="વ્યક્તિઓ ઉકેલાઈ"
              value={number(stats.persons)} 
              hint={`${number(stats.autoMerges)} record pairs auto-merged`} 
              icon={Users}
              colorClass="text-emerald-500"
            />
            <Stat
              title="Families"
              gujarati="પરિવારો"
              value={number(stats.families)}
              hint={`${number(stats.cardMerges)} duplicate ration cards merged · ${number(stats.unanchoredFamilies)} without a ration card`}
              icon={Home}
              colorClass="text-violet-500"
            />
            <Stat 
              title="Est. monthly leakage" 
              gujarati="અંદાજિત માસિક લીકેજ"
              value={rupees(stats.estMonthlyLeakage)} 
              hint="Each benefit counted once" 
              icon={AlertTriangle}
              colorClass="text-rose-500"
            />
          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <Card className="hover-card">
              <CardHeader className="border-b border-border/50 bg-muted/20">
                <div className="flex items-center gap-2">
                  <Flag className="h-5 w-5 text-rose-500" />
                  <CardTitle>Flags <span className="text-muted-foreground font-normal text-sm ml-1">(ફ્લેગ્સ)</span></CardTitle>
                </div>
                <CardDescription>Every flag stores the records and values that triggered it.</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border/50">
                  {Object.entries(stats.flagsByType).map(([type, count]) => (
                    <li key={type}>
                      <Link
                        href={`/officer/flags?type=${type}`}
                        className="flex items-center justify-between p-4 transition-colors hover:bg-muted/50 group"
                      >
                        <span className="font-medium group-hover:text-primary transition-colors">{FLAG_LABELS[type] ?? type}</span>
                        <Badge variant={count > 0 ? "destructive" : "secondary"} className="shadow-sm">{count}</Badge>
                      </Link>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="hover-card">
              <CardHeader className="border-b border-border/50 bg-muted/20">
                <div className="flex items-center gap-2">
                  <CheckCircle className="h-5 w-5 text-blue-500" />
                  <CardTitle>Families receiving benefits <span className="text-muted-foreground font-normal text-sm ml-1">(લાભ મેળવતા પરિવારો)</span></CardTitle>
                </div>
                <CardDescription>
                  From records, plus benefits that started automatically. Open a scheme for its family list.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border/50">
                  {Object.entries(stats.receivingByScheme ?? {}).map(([code, t]) => (
                    <li key={code} className="flex items-center justify-between gap-3 p-4">
                      <Link href={`/officer/schemes/${code}`} className="group min-w-0">
                        <span className="font-medium group-hover:text-primary transition-colors">{schemeName(code)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {number(t.families)} families &middot; {number(t.beneficiaries)} people
                          {t.monthlyAmount > 0 ? ` · ${rupees(t.monthlyAmount)} a month` : ""}
                          {t.automatic > 0 ? ` · ${number(t.automatic)} started automatically` : ""}
                        </span>
                      </Link>
                      <a
                        href={`/api/reports?type=receiving&scheme=${code}`}
                        download
                        title="Download CSV of families receiving this scheme"
                        aria-label={`Download CSV of families receiving ${schemeName(code)}`}
                        className={buttonVariants({ variant: "ghost", size: "icon" })}
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="hover-card">
              <CardHeader className="border-b border-border/50 bg-muted/20">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-amber-500" />
                  <CardTitle>Eligible, waiting for verification <span className="text-muted-foreground font-normal text-sm ml-1">(ચકાસણી બાકી)</span></CardTitle>
                </div>
                <CardDescription>
                  These schemes need manual verification, so these families are eligible but not receiving yet.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <ul className="divide-y divide-border/50">
                  {Object.entries(stats.pendingVerificationByScheme ?? {}).map(([code, t]) => (
                    <li key={code} className="flex items-center justify-between gap-3 p-4">
                      <Link href={`/officer/schemes/${code}`} className="group min-w-0">
                        <span className="font-medium group-hover:text-primary transition-colors">{schemeName(code)}</span>
                        <span className="block text-xs text-muted-foreground">
                          {number(t.families)} families &middot; {number(t.beneficiaries)} people
                        </span>
                      </Link>
                      <a
                        href={`/api/reports?type=pending&scheme=${code}`}
                        download
                        title="Download CSV of families waiting for verification"
                        aria-label={`Download CSV of families waiting for ${schemeName(code)}`}
                        className={buttonVariants({ variant: "ghost", size: "icon" })}
                      >
                        <Download className="h-4 w-4" />
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="border-t border-border/50 p-4 text-xs text-muted-foreground">
                  {number(stats.enrolledNotEligible)} enrollments in source records are for people the demo rules mark ineligible.
                </p>
              </CardContent>
            </Card>

          </section>

          <section className="grid gap-6 lg:grid-cols-2">
            <Card className="hover-card">
              <CardHeader className="border-b border-border/50 bg-muted/20">
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 text-blue-500" />
                  <CardTitle>Match quality <span className="text-muted-foreground font-normal text-sm ml-1">(મેચ ગુણવત્તા)</span></CardTitle>
                </div>
                <CardDescription>
                  Pairwise, against the synthetic ground truth (death registry excluded).
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6">
                <dl className="grid grid-cols-3 gap-4 text-center">
                  <div className="p-4 rounded-xl bg-background border border-border/50 shadow-sm">
                    <dt className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">Precision</dt>
                    <dd className="text-3xl font-bold tabular-nums text-primary">{percent(stats.precision)}</dd>
                  </div>
                  <div className="p-4 rounded-xl bg-background border border-border/50 shadow-sm">
                    <dt className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">Recall</dt>
                    <dd className="text-3xl font-bold tabular-nums text-primary">{percent(stats.recall)}</dd>
                  </div>
                  <div className="p-4 rounded-xl bg-background border border-border/50 shadow-sm">
                    <dt className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-1">F1 Score</dt>
                    <dd className="text-3xl font-bold tabular-nums text-primary">{percent(stats.f1)}</dd>
                  </div>
                </dl>
                <div className="mt-4 text-xs text-muted-foreground bg-muted/30 p-3 rounded-lg border border-border/50">
                  <span className="font-medium text-foreground">{number(stats.correctPairs)}</span> of {number(stats.truePairs)} true pairs found, {number(stats.predictedPairs)} predicted.
                  Pairs the engine is unsure about wait in the review queue.
                </div>
              </CardContent>
            </Card>

            <Card className="hover-card relative overflow-hidden bg-gradient-to-br from-background to-primary/5">
              <CardHeader>
                <CardTitle>Review queue <span className="text-muted-foreground font-normal text-sm ml-1">(સમીક્ષા કતાર)</span></CardTitle>
                <CardDescription>Pairs scored between 0.75 and 0.90 need an officer&rsquo;s decision.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center justify-center py-8">
                <div className="bg-background rounded-full h-32 w-32 flex items-center justify-center shadow-lg border border-primary/20 mb-6 relative">
                  <div className="absolute inset-0 rounded-full border-4 border-primary/20 animate-[spin_10s_linear_infinite]" />
                  <span className="text-5xl font-bold tabular-nums text-primary">{number(stats.reviewPending)}</span>
                </div>
                <Link 
                  href="/officer/review" 
                  className="px-6 py-3 bg-primary text-primary-foreground rounded-full font-medium text-sm transition-all hover:shadow-lg hover:bg-primary/90 hover:-translate-y-0.5"
                >
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
