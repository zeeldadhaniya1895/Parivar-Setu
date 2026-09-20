import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoNotice } from "@/components/demo-notice";
import { Evidence } from "@/components/evidence";
import { RecordCard } from "@/components/record-card";
import { RecordDeathDialog } from "@/components/record-death-dialog";
import { ScoreBreakdown } from "@/components/score-breakdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { currentAsOfDate } from "@/lib/asof";
import { getFamilyDetail, type CandidateRow, type EligibilityRow, type PersonLineage } from "@/lib/db/queries";
import { ageFromDob } from "@/lib/engine/eligibility";
import { FLAG_LABELS, RELATION_LABELS, displayDob, maskUid, rupees } from "@/lib/format";
import { flagSentence } from "@/lib/flag-text";
import { schemeIsDiscoveryOnly, schemeName, schemeScope, schemesConfig } from "@/lib/schemes";

const SEVERITY_VARIANT = { high: "destructive", medium: "default", low: "secondary" } as const;

function pairLabel(pair: CandidateRow, lineage: PersonLineage): string {
  const name = (id: string) => `${lineage.lookup[id]?.full_name ?? "unknown"} (${id})`;
  return `${name(pair.record_a_id)} ↔ ${name(pair.record_b_id)}`;
}

function Reasons({ row }: { row: EligibilityRow }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
        {row.reasons.filter((r) => !r.passed).length === 0
          ? "All rules pass"
          : `${row.reasons.filter((r) => !r.passed).length} rule(s) fail`}
      </summary>
      <ul className="mt-1 space-y-0.5">
        {row.reasons.map((r) => (
          <li key={r.rule} className={r.passed ? "" : "text-destructive"}>
            {r.passed ? "✓" : "✗"} {r.rule} <span className="text-muted-foreground">(actual: {r.actual === null ? "unknown" : String(r.actual)})</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default async function FamilyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getFamilyDetail(id);
  if (!detail) notFound();

  const { family, members, enrollments, eligibility, flags } = detail;
  const asOf = currentAsOfDate();
  const nameOf = new Map(members.map((m) => [m.person.id, m.person.canonical_name]));
  const enrolledKeys = new Set(
    enrollments.map((e) => (schemeScope(e.scheme_code) === "family" ? `family|${e.scheme_code}` : `${e.person_id}|${e.scheme_code}`)),
  );
  const isEnrolled = (row: EligibilityRow) =>
    enrolledKeys.has(row.person_id === null ? `family|${row.scheme_code}` : `${row.person_id}|${row.scheme_code}`);
  const schemeOrder = schemesConfig.schemes.map((s) => s.code);
  const sortRows = (rows: EligibilityRow[]) =>
    [...rows].sort((a, b) => schemeOrder.indexOf(a.scheme_code) - schemeOrder.indexOf(b.scheme_code));
  const familyRows = sortRows(eligibility.filter((r) => r.person_id === null));
  const personRows = eligibility.filter((r) => r.person_id !== null);
  const memberOrder = new Map(members.map((m, i) => [m.person.id, i]));
  const sortedPersonRows = [...personRows].sort(
    (a, b) =>
      (memberOrder.get(a.person_id ?? "") ?? 0) - (memberOrder.get(b.person_id ?? "") ?? 0) ||
      schemeOrder.indexOf(a.scheme_code) - schemeOrder.indexOf(b.scheme_code),
  );

  const EnrolledCell = ({ row }: { row: EligibilityRow }) =>
    schemeIsDiscoveryOnly(row.scheme_code) ? (
      <span className="text-muted-foreground">no enrollment exists</span>
    ) : isEnrolled(row) ? (
      <Badge variant="secondary">Enrolled</Badge>
    ) : (
      <span className="text-muted-foreground">Not enrolled</span>
    );

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm text-muted-foreground">
          <Link href="/officer/families" className="hover:text-foreground">Families</Link> /
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{family.id}</h1>
          <Badge variant={family.is_anchored ? "secondary" : "outline"}>
            {family.is_anchored ? "Built from a ration card" : "No ration card"}
          </Badge>
          {family.status === "merged" && <Badge variant="destructive">Merged</Badge>}
        </div>
        <p className="mt-1 text-muted-foreground">
          {detail.headName ? `Head: ${detail.headName} · ` : ""}
          {family.village}, {family.taluka}, {family.district}
        </p>
      </div>

      {family.status === "merged" && detail.mergedInto && (
        <Alert>
          <AlertTitle>Duplicate ration card</AlertTitle>
          <AlertDescription>
            This card was merged into{" "}
            <Link className="font-mono underline" href={`/officer/families/${detail.mergedInto.id}`}>{detail.mergedInto.id}</Link>
            ; its members live there.
          </AlertDescription>
        </Alert>
      )}
      {detail.mergedFrom.length > 0 && (
        <Alert>
          <AlertTitle>Duplicate ration cards folded into this family</AlertTitle>
          <AlertDescription>
            {detail.mergedFrom.map((f) => f.id).join(", ")}: the same people were listed on more than one card.
          </AlertDescription>
        </Alert>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader>
            <CardDescription>Resolved income</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{rupees(family.resolved_income)}</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground">
            Highest of {family.income_sources.length} declared value(s), the conservative choice.
            <details className="mt-1">
              <summary className="cursor-pointer">Every declared value</summary>
              <ul className="mt-1">
                {family.income_sources.map((s) => (
                  <li key={s.recordId}><span className="font-mono">{s.recordId}</span> {rupees(s.value)}</li>
                ))}
              </ul>
            </details>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Members</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{members.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Flags</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{flags.length}</CardTitle>
          </CardHeader>
        </Card>
      </section>

      {flags.length > 0 && (
        <section className="space-y-4">
          <h2 className="text-xl font-bold tracking-tight">Flags <span className="text-base font-normal text-muted-foreground ml-1">(ફ્લેગ્સ)</span></h2>
          <div className="grid gap-4">
          {flags.map((flag) => (
            <Card key={flag.id} className="hover-card border-l-4" style={{ borderLeftColor: `var(--${flag.severity === "high" ? "destructive" : flag.severity === "medium" ? "primary" : "muted"})` }}>
              <CardHeader className="bg-muted/10 pb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={SEVERITY_VARIANT[flag.severity]}>{flag.severity}</Badge>
                  <CardTitle>{FLAG_LABELS[flag.type] ?? flag.type}</CardTitle>
                  <span className="font-mono text-xs text-muted-foreground">{flag.id}</span>
                </div>
                <CardDescription>{flagSentence(flag, flag.person_id ? (nameOf.get(flag.person_id) ?? null) : null)}</CardDescription>
              </CardHeader>
              <CardContent><Evidence value={flag.evidence} /></CardContent>
            </Card>
          ))}
          </div>
        </section>
      )}

      <section className="space-y-4">
        <h2 className="text-xl font-bold tracking-tight">Members <span className="text-base font-normal text-muted-foreground ml-1">(સભ્યો)</span></h2>
        <div className="overflow-hidden rounded-xl border shadow-sm">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent">
                <TableHead>Name <span className="text-xs text-muted-foreground font-normal block">નામ</span></TableHead>
                <TableHead>Relation <span className="text-xs text-muted-foreground font-normal block">સંબંધ</span></TableHead>
                <TableHead>Born <span className="text-xs text-muted-foreground font-normal block">જન્મ</span></TableHead>
                <TableHead>Age <span className="text-xs text-muted-foreground font-normal block">ઉંમર</span></TableHead>
                <TableHead>Marital <span className="text-xs text-muted-foreground font-normal block">વૈવાહિક</span></TableHead>
                <TableHead>Aadhaar <span className="text-xs text-muted-foreground font-normal block">આધાર</span></TableHead>
                <TableHead className="text-right">Records <span className="text-xs text-muted-foreground font-normal block">રેકોર્ડ્સ</span></TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map(({ member, person, lineage }) => (
                <TableRow key={person.id} className="transition-colors hover:bg-muted/50 group">
                  <TableCell>
                    <span className="font-medium group-hover:text-primary transition-colors">{person.canonical_name}</span>{" "}
                    <span className="font-mono text-xs text-muted-foreground">{person.id}</span>
                    {person.is_deceased && <Badge variant="destructive" className="ml-2">Deceased {person.deceased_on ?? ""}</Badge>}
                  </TableCell>
                  <TableCell>{member.relation_to_head ? (RELATION_LABELS[member.relation_to_head] ?? member.relation_to_head) : "—"}</TableCell>
                  <TableCell>{displayDob(person.dob)}</TableCell>
                  <TableCell>{ageFromDob(person.dob, asOf) ?? "—"}{person.gender ? ` · ${person.gender}` : ""}</TableCell>
                  <TableCell>{person.marital_status ?? "—"}</TableCell>
                  <TableCell className="font-mono text-xs">{maskUid(person.uid_last4)}</TableCell>
                  <TableCell className="text-right tabular-nums">{lineage.records.length}</TableCell>
                  <TableCell className="text-right">
                    {!person.is_deceased && (
                      <RecordDeathDialog
                        familyId={family.id}
                        anchorRecordId={person.anchor_record_id}
                        personName={person.canonical_name.split(" ")[0]}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold">Lineage</h2>
          <p className="text-sm text-muted-foreground">
            The messy source records behind each person, and the score breakdown that justified every merge.
          </p>
        </div>
        {members.map(({ person, lineage }) => (
          <details key={person.id} className="rounded-lg border p-3" open={lineage.records.length > 1 && members.length <= 2}>
            <summary className="cursor-pointer font-medium">
              {person.canonical_name}{" "}
              <span className="font-normal text-muted-foreground">
                &middot; {lineage.records.length} source record{lineage.records.length === 1 ? "" : "s"}
              </span>
            </summary>
            <div className="mt-3 space-y-4">
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                {lineage.records.map((r) => <RecordCard key={r.id} record={r} />)}
              </div>
              {lineage.mergedPairs.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Why these records are one person</h3>
                  {lineage.mergedPairs.map((pair) => (
                    <div key={pair.pair_key} className="space-y-1">
                      <p className="text-xs text-muted-foreground">{pairLabel(pair, lineage)}</p>
                      <ScoreBreakdown breakdown={pair.score_breakdown} score={pair.score} decision={pair.decision} reviewStatus={pair.review_status} />
                    </div>
                  ))}
                </div>
              )}
              {lineage.otherPairs.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-sm font-semibold">Kept apart or waiting for review</h3>
                  {lineage.otherPairs.map((pair) => (
                    <div key={pair.pair_key} className="space-y-1">
                      <p className="text-xs text-muted-foreground">{pairLabel(pair, lineage)}</p>
                      <ScoreBreakdown breakdown={pair.score_breakdown} score={pair.score} decision={pair.decision} reviewStatus={pair.review_status} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </details>
        ))}
      </section>

      <section className="space-y-4">
        <div>
          <h2 className="text-xl font-bold tracking-tight">Eligibility <span className="text-base font-normal text-muted-foreground ml-1">(લાયકાત)</span></h2>
          <DemoNotice />
        </div>

        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Family schemes</h3>
        <div className="overflow-hidden rounded-xl border shadow-sm">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent">
                <TableHead>Scheme <span className="text-xs text-muted-foreground font-normal block">યોજના</span></TableHead>
                <TableHead>Eligible <span className="text-xs text-muted-foreground font-normal block">લાયક</span></TableHead>
                <TableHead>Enrollment <span className="text-xs text-muted-foreground font-normal block">નોંધણી</span></TableHead>
                <TableHead>Why <span className="text-xs text-muted-foreground font-normal block">કારણ</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {familyRows.map((row) => (
                <TableRow key={row.scheme_code} className="transition-colors hover:bg-muted/50">
                  <TableCell className="font-medium">{schemeName(row.scheme_code)}</TableCell>
                  <TableCell><Badge variant={row.eligible ? "default" : "outline"}>{row.eligible ? "Eligible" : "Not eligible"}</Badge></TableCell>
                  <TableCell><EnrolledCell row={row} /></TableCell>
                  <TableCell><Reasons row={row} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mt-6">Schemes for each member</h3>
        <div className="overflow-hidden rounded-xl border shadow-sm">
          <Table>
            <TableHeader className="bg-muted/30">
              <TableRow className="hover:bg-transparent">
                <TableHead>Member <span className="text-xs text-muted-foreground font-normal block">સભ્ય</span></TableHead>
                <TableHead>Scheme <span className="text-xs text-muted-foreground font-normal block">યોજના</span></TableHead>
                <TableHead>Eligible <span className="text-xs text-muted-foreground font-normal block">લાયક</span></TableHead>
                <TableHead>Enrollment <span className="text-xs text-muted-foreground font-normal block">નોંધણી</span></TableHead>
                <TableHead>Why <span className="text-xs text-muted-foreground font-normal block">કારણ</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedPersonRows.map((row) => (
                <TableRow key={`${row.person_id}|${row.scheme_code}`} className="transition-colors hover:bg-muted/50 group">
                  <TableCell className="font-medium group-hover:text-primary transition-colors">{nameOf.get(row.person_id ?? "") ?? row.person_id}</TableCell>
                  <TableCell>{schemeName(row.scheme_code)}</TableCell>
                  <TableCell><Badge variant={row.eligible ? "default" : "outline"}>{row.eligible ? "Eligible" : "Not eligible"}</Badge></TableCell>
                  <TableCell><EnrolledCell row={row} /></TableCell>
                  <TableCell><Reasons row={row} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
