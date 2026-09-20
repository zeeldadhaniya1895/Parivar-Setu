import Link from "next/link";
import { Evidence } from "@/components/evidence";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { flagCountsByType, listFlags } from "@/lib/db/queries";
import { flagSentence } from "@/lib/flag-text";
import { FLAG_LABELS, rupees } from "@/lib/format";

const SEVERITY_VARIANT = { high: "destructive", medium: "default", low: "secondary" } as const;

export default async function FlagsPage({ searchParams }: { searchParams: Promise<{ type?: string }> }) {
  const { type } = await searchParams;
  const selected = type && type in FLAG_LABELS ? type : null;
  const [flags, counts] = await Promise.all([listFlags(selected), flagCountsByType()]);
  const total = Object.values(counts).reduce((t, n) => t + n, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Flags</h1>
        <p className="text-sm text-muted-foreground">
          {flags.length} {selected ? FLAG_LABELS[selected].toLowerCase() : "open"} flag{flags.length === 1 ? "" : "s"}, highest severity first.
        </p>
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Filter by type">
        <Link href="/officer/flags" className={buttonVariants({ variant: selected === null ? "default" : "outline", size: "sm" })}>
          All ({total})
        </Link>
        {Object.entries(FLAG_LABELS).map(([key, label]) => (
          <Link
            key={key}
            href={`/officer/flags?type=${key}`}
            className={buttonVariants({ variant: selected === key ? "default" : "outline", size: "sm" })}
          >
            {label} ({counts[key] ?? 0})
          </Link>
        ))}
      </nav>

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Severity</TableHead>
              <TableHead>Flag</TableHead>
              <TableHead>What happened</TableHead>
              <TableHead>Family</TableHead>
              <TableHead className="text-right">Monthly leakage</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {flags.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                  No flags. Run resolution from the dashboard if this is a fresh database.
                </TableCell>
              </TableRow>
            )}
            {flags.map((flag) => (
              <TableRow key={flag.id} className="align-top">
                <TableCell><Badge variant={SEVERITY_VARIANT[flag.severity]}>{flag.severity}</Badge></TableCell>
                <TableCell>
                  <div>{FLAG_LABELS[flag.type] ?? flag.type}</div>
                  <div className="font-mono text-xs text-muted-foreground">{flag.id}</div>
                </TableCell>
                <TableCell className="max-w-md whitespace-normal">
                  <p className="mb-1">{flagSentence(flag, flag.personName)}</p>
                  <Evidence value={flag.evidence} />
                </TableCell>
                <TableCell>
                  {flag.family_id ? (
                    <Link href={`/officer/families/${flag.family_id}`} className="font-mono text-primary underline-offset-4 hover:underline">
                      {flag.family_id}
                    </Link>
                  ) : "—"}
                </TableCell>
                <TableCell className="text-right tabular-nums">{flag.est_monthly_leakage ? rupees(flag.est_monthly_leakage) : "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
