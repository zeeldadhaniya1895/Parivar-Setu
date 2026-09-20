import Link from "next/link";
import { notFound } from "next/navigation";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { schemeFamilyLists } from "@/lib/db/queries";
import { number, rupees } from "@/lib/format";
import type { SchemeFamilyRow } from "@/lib/reports";
import { Download } from "lucide-react";

const STARTED = { records: "From records", automatic: "Started automatically", both: "Records and automatic" } as const;

function FamilyCell({ row }: { row: SchemeFamilyRow }) {
  return (
    <TableCell>
      <Link href={`/officer/families/${row.familyId}`} className="font-mono text-primary underline-offset-4 hover:underline">
        {row.familyId}
      </Link>
    </TableCell>
  );
}

export default async function SchemePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const lists = await schemeFamilyLists(code);
  if (!lists) notFound();
  const { scheme, receiving, pending } = lists;

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/officer/schemes" className="hover:text-foreground">Schemes</Link> /
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{scheme.name}</h1>
          <Badge variant={scheme.manualVerificationRequired ? "outline" : "secondary"}>
            {scheme.manualVerificationRequired ? "Manual verification required" : "Starts automatically"}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">Simplified demo criteria, not official scheme rules.</p>
      </div>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Families receiving this scheme</h2>
            <p className="text-sm text-muted-foreground">{number(receiving.length)} families</p>
          </div>
          <a
            href={`/api/reports?type=receiving&scheme=${scheme.code}`}
            download
            className={buttonVariants({ variant: "outline" })}
          >
            <Download className="mr-1 h-4 w-4" /> Download CSV
          </a>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Family ID</TableHead>
                <TableHead>Head</TableHead>
                <TableHead>Place</TableHead>
                <TableHead>Beneficiaries</TableHead>
                <TableHead className="text-right">Monthly</TableHead>
                <TableHead>Started</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {receiving.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No family is receiving this scheme yet.
                  </TableCell>
                </TableRow>
              )}
              {receiving.map((row) => (
                <TableRow key={row.familyId} className="align-top">
                  <FamilyCell row={row} />
                  <TableCell>{row.headName ?? "—"}</TableCell>
                  <TableCell>{row.village}, {row.taluka}</TableCell>
                  <TableCell className="max-w-xs whitespace-normal">{row.people.join(", ")}</TableCell>
                  <TableCell className="text-right tabular-nums">{row.monthlyAmount > 0 ? rupees(row.monthlyAmount) : "—"}</TableCell>
                  <TableCell>{row.started ? STARTED[row.started] : "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Eligible, waiting for manual verification</h2>
            <p className="text-sm text-muted-foreground">{number(pending.length)} families are eligible but not receiving</p>
          </div>
          {scheme.manualVerificationRequired && (
            <a
              href={`/api/reports?type=pending&scheme=${scheme.code}`}
              download
              className={buttonVariants({ variant: "outline" })}
            >
              <Download className="mr-1 h-4 w-4" /> Download CSV
            </a>
          )}
        </div>
        {!scheme.manualVerificationRequired ? (
          <Alert>
            <AlertTitle>No manual step</AlertTitle>
            <AlertDescription>
              Eligible families start receiving this scheme automatically, so nobody waits here.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Family ID</TableHead>
                  <TableHead>Head</TableHead>
                  <TableHead>Place</TableHead>
                  <TableHead>Eligible people</TableHead>
                  <TableHead>Rules met</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pending.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Nobody is waiting for verification.
                    </TableCell>
                  </TableRow>
                )}
                {pending.map((row) => (
                  <TableRow key={row.familyId} className="align-top">
                    <FamilyCell row={row} />
                    <TableCell>{row.headName ?? "—"}</TableCell>
                    <TableCell>{row.village}, {row.taluka}</TableCell>
                    <TableCell className="max-w-xs whitespace-normal">{row.people.join(", ")}</TableCell>
                    <TableCell className="max-w-sm whitespace-normal text-sm text-muted-foreground">{row.rulesMet}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </div>
  );
}
