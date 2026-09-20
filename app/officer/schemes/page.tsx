import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { latestRun } from "@/lib/db/queries";
import { number, rupees } from "@/lib/format";
import { schemesConfig } from "@/lib/schemes";

export default async function SchemesPage() {
  const run = await latestRun();
  const stats = run?.stats ?? null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Schemes <span className="text-lg font-normal text-muted-foreground">(યોજનાઓ)</span>
        </h1>
        <p className="text-sm text-muted-foreground">
          Who is receiving each scheme, and who is eligible but waiting for manual verification. Criteria are simplified demo values.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {schemesConfig.schemes.map((scheme) => {
          const receiving = stats?.receivingByScheme?.[scheme.code];
          const pending = stats?.pendingVerificationByScheme?.[scheme.code];
          const manual = scheme.manualVerificationRequired || scheme.enrollment === "none";
          return (
            <Link key={scheme.code} href={`/officer/schemes/${scheme.code}`} className="group">
              <Card className="h-full transition-shadow group-hover:shadow-md">
                <CardHeader>
                  <div className="flex flex-wrap items-center gap-2">
                    <CardTitle>{scheme.name}</CardTitle>
                    <Badge variant={manual ? "outline" : "secondary"}>
                      {manual ? "Manual verification" : "Starts automatically"}
                    </Badge>
                  </div>
                  <CardDescription>{scheme.nameGu}</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-2xl font-semibold tabular-nums">{number(receiving?.families ?? 0)}</div>
                    <div className="text-muted-foreground">families receiving</div>
                    {receiving && receiving.monthlyAmount > 0 && (
                      <div className="text-xs text-muted-foreground">{rupees(receiving.monthlyAmount)} a month</div>
                    )}
                  </div>
                  <div>
                    <div className="text-2xl font-semibold tabular-nums">{number(pending?.families ?? 0)}</div>
                    <div className="text-muted-foreground">eligible, waiting</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>
      {(!stats || !stats.receivingByScheme) && (
        <p className="text-sm text-muted-foreground">
          {stats
            ? "These counts are from a run before the benefits update. Click Run resolution on the dashboard to refresh them."
            : "No results yet. Run resolution from the dashboard."}
        </p>
      )}
    </div>
  );
}
